-- Closed exact-fax delivery authority. No route, collection, provider or login is activated.
create role parent_snap_sender nologin noinherit;
grant usage on schema parent_private to parent_snap_sender;

-- Scheduling can read the existing work limit without exposing or renewing any application authority.
create function parent_private.parent_get_snap_delivery_job_attempts(p_job uuid,p_lease uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare j public.parent_jobs;
begin
  select * into j from public.parent_jobs where id=p_job;
  j:=parent_private.require_lease(p_job,p_lease,j.request_version);
  if not parent_private.processing_enabled() or j.lease_until<=clock_timestamp() or j.attempts not between 1 and 48
    or not exists(select 1 from public.parent_requests r where r.id=j.request_id and r.intake->'needs' ? 'snap_new')
    then raise exception 'SNAP delivery work unavailable' using errcode='42501'; end if;
  return j.attempts;
end $$;
revoke execute on function parent_private.parent_get_snap_delivery_job_attempts(uuid,uuid)
  from public,anon,authenticated,service_role,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_snap_sender;
grant execute on function parent_private.parent_get_snap_delivery_job_attempts(uuid,uuid) to parent_worker;

create table parent_private.snap_delivery_destinations (
  id text primary key check(id~'^[a-z0-9][a-z0-9_-]{0,79}$'),
  version text not null check(length(btrim(version)) between 1 and 160),
  enabled boolean not null default false,
  permission_version text not null check(length(btrim(permission_version)) between 1 and 160),
  project_id text not null check(project_id~'^[A-Za-z0-9_-]{1,100}$'),
  service_id text not null check(service_id~'^[A-Za-z0-9_-]{1,100}$'),
  from_number text not null check(from_number~'^\+[1-9][0-9]{7,14}$'),
  to_number text not null check(to_number~'^\+[1-9][0-9]{7,14}$' and to_number<>'+19898989898'),
  zip_codes text[] not null check(cardinality(zip_codes) between 1 and 100 and array_position(zip_codes,null) is null
    and array_to_string(zip_codes,',')~'^191[0-9]{2}(,191[0-9]{2})*$'),
  evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 2000),
  verified_until timestamptz not null
);
alter table parent_private.snap_delivery_destinations enable row level security;

-- The existing operation is the sole send key. Raw packets/keys are never stored in this ledger.
create table parent_private.snap_delivery_intents (
  operation_id uuid primary key references public.parent_operations(id) on delete cascade,
  intent jsonb not null,
  route jsonb not null,
  reserved_lease_token uuid not null,
  attempted_at timestamptz not null default clock_timestamp(),
  dispatch_authorized_at timestamptz,
  dispatch_expires_at timestamptz not null,
  provider_id text check(provider_id~'^[A-Za-z0-9_-]{1,100}$'),
  provider_status text not null default 'UNKNOWN' check(provider_status in ('QUEUED','IN_PROGRESS','COMPLETED','FAILURE','UNKNOWN')),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index parent_snap_delivery_carrier_id on parent_private.snap_delivery_intents
  ((route->>'projectId'),(route->>'serviceId'),provider_id) where provider_id is not null;
alter table parent_private.snap_delivery_intents enable row level security;
revoke all on parent_private.snap_delivery_destinations,parent_private.snap_delivery_intents
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_snap_sender;

-- Dispatch needs current packet/personal acts. Metadata-only recovery deliberately survives raw-file expiry.
create function parent_private.snap_delivery_context(p_intent jsonb,p_dispatch boolean,p_resume boolean default false) returns public.parent_operations
language plpgsql volatile security definer set search_path='' as $$
declare o public.parent_operations; j public.parent_jobs; r public.parent_requests; c parent_private.provider_capabilities; expected jsonb;
begin
  if jsonb_typeof(p_intent) is distinct from 'object' or p_dispatch is null or p_resume is null or (p_resume and not p_dispatch)
    then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
  if (select count(*) from jsonb_object_keys(p_intent))<>8 then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
  select * into o from public.parent_operations where id=(p_intent->>'operationId')::uuid;
  if not found or o.need<>'snap_new' or o.program_id<>'snap-pa' or o.action<>'submit'
    or not(o.packet ? 'protectedSnapPacket') or o.artifact_id is not null
    then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=o.request_id for update;
  select * into j from public.parent_jobs where id=(p_intent->>'jobId')::uuid;
  if not found or j.request_id is distinct from o.request_id then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
  j:=parent_private.require_lease(j.id,(p_intent->>'leaseToken')::uuid,j.request_version);
  select * into o from public.parent_operations where id=o.id for update;
  select * into r from public.parent_requests where id=o.request_id;
  expected:=jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'operationId',o.id,'requestId',o.request_id,
    'requestVersion',o.request_version,'idempotencyKey',o.idempotency_key,'packetHash',o.packet_hash,'protectedPacket',o.packet->'protectedSnapPacket');
  if p_intent is distinct from expected or not parent_private.processing_enabled() or j.lease_until<=clock_timestamp()
    or j.lease_started_at<clock_timestamp()-interval '15 minutes' or (r.mandate->>'expiresAt')::timestamptz<=clock_timestamp()
    or (r.mandate->'recipientIds' ? 'snap-pa') is distinct from true or (r.mandate->'allowedData' ? 'household') is distinct from true
    or o.state not in ('executing','delivery_unknown','sent')
    then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
  if p_dispatch then
    if o.state not in ('executing','delivery_unknown') or o.request_version<>j.request_version or r.mandate->>'mode' is distinct from 'full'
      or (r.mandate->'allowedActions' ? 'submit') is distinct from true
      or parent_private.operation_allowed(o.request_id,o.request_version,o.program_id,o.action,o.data_categories,o.document_ids,o.packet,o.need) is distinct from true
      or not exists(select 1 from parent_private.snap_submission_authorizations a
        join public.parent_households h on h.id=r.household_id
        where a.operation_id=o.id and a.authorized_by=h.owner_id
          and a.authorized_at<=o.executed_at and a.authorized_at<=clock_timestamp())
      or not parent_private.personal_acts_complete(o)
      or (not p_resume and not exists(select 1 from parent_private.receipt_authority a where a.operation_id=o.id and a.job_id=j.id
        and a.lease_token=j.lease_token and a.packet_hash=o.packet_hash and a.valid_until>clock_timestamp()))
      then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
    perform parent_private.validate_operation_artifact(o);
    select * into c from parent_private.provider_capabilities where program_id='snap-pa' and action='submit';
    if c.permission_version is distinct from o.permission_version then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
  else
    select * into c from parent_private.provider_capabilities where program_id='snap-pa' and action='follow_up';
    if (r.mandate->'allowedActions' ? 'follow_up') is distinct from true or not coalesce(c.enabled and c.transport_verified and c.verified_until>clock_timestamp(),false)
      or length(btrim(coalesce(c.permission_reference,'')))=0
      or not exists(select 1 from jsonb_each_text(c.field_categories) e where e.key=any(c.allowed_fields) and e.value='household')
      then raise exception 'SNAP delivery follow-up unavailable' using errcode='42501'; end if;
  end if;
  return o;
exception when invalid_text_representation then raise exception 'SNAP delivery unavailable' using errcode='42501';
end $$;

create function parent_private.snap_delivery_attempt(a parent_private.snap_delivery_intents,p_expires timestamptz) returns jsonb
language sql stable set search_path='' as $$
  select a.route||jsonb_build_object('operationId',a.operation_id,'packetId',a.intent#>>'{protectedPacket,packetId}',
    'contentSha256',a.intent#>>'{protectedPacket,contentSha256}','operationRef',encode(sha256(convert_to(a.intent->>'idempotencyKey','UTF8')),'hex'),
    'attemptedAt',to_char(a.attempted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'dispatchAuthorizedAt',to_char(a.dispatch_authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(p_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'pageCount',12,'providerId',a.provider_id,'providerStatus',a.provider_status);
$$;

create function parent_private.parent_reserve_snap_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents; d parent_private.snap_delivery_destinations;
  p parent_private.snap_final_packets; c parent_private.provider_capabilities; zip text; routes integer; expiry timestamptz; envelope jsonb; route jsonb;
begin
  o:=parent_private.snap_delivery_context(p_intent,true);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
  if found then
    if a.intent-'jobId'-'leaseToken' is distinct from p_intent-'jobId'-'leaseToken' then raise exception 'SNAP delivery changed' using errcode='42501'; end if;
    return jsonb_build_object('state','reconcile_only','attempt',parent_private.snap_delivery_attempt(a,a.dispatch_expires_at));
  end if;
  if o.state<>'executing' then raise exception 'SNAP delivery reservation unavailable' using errcode='42501'; end if;
  select * into p from parent_private.snap_final_packets where id=(p_intent#>>'{protectedPacket,packetId}')::uuid and operation_id=o.id;
  select details->>'zip' into zip from public.parent_snap_application_details where id=p.snapshot_id;
  lock table parent_private.snap_delivery_destinations in share mode;
  select count(*) into routes from parent_private.snap_delivery_destinations x where x.enabled and x.verified_until>clock_timestamp()
    and x.permission_version=o.permission_version and zip=any(x.zip_codes);
  if routes<>1 then raise exception 'SNAP delivery destination unavailable' using errcode='42501'; end if;
  select * into d from parent_private.snap_delivery_destinations x where x.enabled and x.verified_until>clock_timestamp()
    and x.permission_version=o.permission_version and zip=any(x.zip_codes) for share;
  select * into c from parent_private.provider_capabilities where program_id='snap-pa' and action='submit';
  expiry:=date_trunc('milliseconds',least(p.expires_at,d.verified_until,c.verified_until,
    (select (mandate->>'expiresAt')::timestamptz from public.parent_requests where id=o.request_id)));
  if expiry is null or expiry<=clock_timestamp() then raise exception 'SNAP delivery unavailable' using errcode='42501'; end if;
  route:=jsonb_build_object('projectId',d.project_id,'serviceId',d.service_id,'from',d.from_number,'to',d.to_number,
    'destinationId',d.id,'destinationVersion',d.version);
  insert into parent_private.snap_delivery_intents(operation_id,intent,route,reserved_lease_token,dispatch_expires_at)
    values(o.id,p_intent,route,(p_intent->>'leaseToken')::uuid,expiry) returning * into a;
  envelope:=parent_private.parent_read_snap_final_packet(p.id,p.request_id,p.request_version,p.authorization_id,p.snapshot_id,p.snapshot_hash);
  return jsonb_build_object('state','dispatch_allowed','attempt',parent_private.snap_delivery_attempt(a,expiry),'envelope',envelope);
end $$;

create function parent_private.snap_delivery_check_route(o public.parent_operations,a parent_private.snap_delivery_intents) returns void
language plpgsql volatile set search_path='' as $$
declare d parent_private.snap_delivery_destinations; routes integer;
begin
  lock table parent_private.snap_delivery_destinations in share mode;
  select count(*) into routes from parent_private.snap_delivery_destinations x
    join parent_private.snap_final_packets p on p.id=(a.intent#>>'{protectedPacket,packetId}')::uuid
    join public.parent_snap_application_details s on s.id=p.snapshot_id
    where x.enabled and x.verified_until>clock_timestamp() and x.permission_version=o.permission_version and s.details->>'zip'=any(x.zip_codes);
  if routes<>1 then raise exception 'SNAP delivery destination changed' using errcode='42501'; end if;
  select * into d from parent_private.snap_delivery_destinations where id=a.route->>'destinationId' for share;
  if not found or not d.enabled or d.verified_until<=clock_timestamp() or d.permission_version<>o.permission_version
    or a.route is distinct from jsonb_build_object('projectId',d.project_id,'serviceId',d.service_id,'from',d.from_number,'to',d.to_number,
      'destinationId',d.id,'destinationVersion',d.version)
    or not exists(select 1 from parent_private.snap_final_packets p join public.parent_snap_application_details s on s.id=p.snapshot_id
      where p.id=(a.intent#>>'{protectedPacket,packetId}')::uuid and s.details->>'zip'=any(d.zip_codes))
    then raise exception 'SNAP delivery destination changed' using errcode='42501'; end if;
end $$;

-- A committed reservation is not a transmission. Re-open only before the sole dispatch gate was ever crossed.
create function parent_private.parent_resume_snap_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents; envelope jsonb;
begin
  o:=parent_private.snap_delivery_context(p_intent,true,true);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
  if not found or a.intent-'jobId'-'leaseToken' is distinct from p_intent-'jobId'-'leaseToken'
    or a.dispatch_authorized_at is not null or a.provider_id is not null or a.provider_status<>'UNKNOWN'
    or a.dispatch_expires_at<=clock_timestamp()
    then raise exception 'SNAP delivery resume unavailable' using errcode='42501'; end if;
  perform parent_private.snap_delivery_check_route(o,a);
  envelope:=parent_private.parent_read_snap_final_packet((a.intent#>>'{protectedPacket,packetId}')::uuid,o.request_id,o.request_version,
    (a.intent#>>'{protectedPacket,authorizationId}')::uuid,(a.intent#>>'{protectedPacket,snapshotId}')::uuid,a.intent#>>'{protectedPacket,snapshotHash}');
  insert into parent_private.receipt_authority(operation_id,job_id,lease_token,packet_hash,valid_until)
    values(o.id,(p_intent->>'jobId')::uuid,(p_intent->>'leaseToken')::uuid,o.packet_hash,least(a.dispatch_expires_at,clock_timestamp()+interval '10 minutes'))
    on conflict(operation_id) do update set job_id=excluded.job_id,lease_token=excluded.lease_token,packet_hash=excluded.packet_hash,valid_until=excluded.valid_until;
  update parent_private.snap_delivery_intents set intent=p_intent,reserved_lease_token=(p_intent->>'leaseToken')::uuid,updated_at=clock_timestamp()
    where operation_id=o.id returning * into a;
  return jsonb_build_object('state','dispatch_allowed','attempt',parent_private.snap_delivery_attempt(a,a.dispatch_expires_at),'envelope',envelope);
end $$;

create function parent_private.parent_recheck_snap_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents;
begin
  o:=parent_private.snap_delivery_context(p_intent,true);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
  if not found or a.intent is distinct from p_intent or a.dispatch_authorized_at is not null or a.dispatch_expires_at<=clock_timestamp()
    then raise exception 'SNAP delivery dispatch unavailable' using errcode='42501'; end if;
  perform parent_private.snap_delivery_check_route(o,a);
  update parent_private.snap_delivery_intents set dispatch_authorized_at=clock_timestamp(),updated_at=clock_timestamp() where operation_id=o.id returning * into a;
  return parent_private.snap_delivery_attempt(a,a.dispatch_expires_at);
end $$;

create function parent_private.parent_read_snap_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents; expiry timestamptz;
begin
  select * into a from parent_private.snap_delivery_intents where operation_id=(p_intent->>'operationId')::uuid;
  o:=parent_private.snap_delivery_context(p_intent,a.operation_id is not null and a.dispatch_authorized_at is null,
    a.operation_id is not null and a.dispatch_authorized_at is null);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id;
  if not found then return null; end if;
  -- The request lock may have waited behind the first dispatch; recheck the authority required by its current state.
  if a.dispatch_authorized_at is not null then perform parent_private.snap_delivery_context(p_intent,false); end if;
  if a.intent-'jobId'-'leaseToken' is distinct from p_intent-'jobId'-'leaseToken' then raise exception 'SNAP delivery changed' using errcode='42501'; end if;
  expiry:=case when a.dispatch_authorized_at is null then a.dispatch_expires_at else date_trunc('milliseconds',least((select lease_until from public.parent_jobs where id=(p_intent->>'jobId')::uuid),
    (select verified_until from parent_private.provider_capabilities where program_id='snap-pa' and action='follow_up'),
    (select (mandate->>'expiresAt')::timestamptz from public.parent_requests where id=o.request_id))) end;
  return parent_private.snap_delivery_attempt(a,expiry);
end $$;

create function parent_private.parent_record_snap_delivery(p_intent jsonb,p_provider_id text,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents; initial boolean; expiry timestamptz;
begin
  select * into a from parent_private.snap_delivery_intents where operation_id=(p_intent->>'operationId')::uuid;
  if not found or a.dispatch_authorized_at is null then raise exception 'SNAP delivery result unavailable' using errcode='42501'; end if;
  initial:=a.reserved_lease_token::text=p_intent->>'leaseToken' and exists(select 1 from public.parent_operations where id=a.operation_id and state in ('executing','delivery_unknown'));
  o:=parent_private.snap_delivery_context(p_intent,initial);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
  if a.intent-'jobId'-'leaseToken' is distinct from p_intent-'jobId'-'leaseToken'
    or p_status is null or p_status not in ('QUEUED','IN_PROGRESS','COMPLETED','FAILURE','UNKNOWN')
    or (p_provider_id is null and p_status<>'UNKNOWN') or (p_provider_id is not null and p_provider_id!~'^[A-Za-z0-9_-]{1,100}$')
    or (a.provider_id is not null and p_provider_id is not null and a.provider_id<>p_provider_id)
    then raise exception 'SNAP delivery result changed' using errcode='42501'; end if;
  if a.provider_status in ('COMPLETED','FAILURE') then
    if p_status not in ('UNKNOWN',a.provider_status) then raise exception 'SNAP delivery terminal result changed' using errcode='42501'; end if;
  else
    update parent_private.snap_delivery_intents set provider_id=coalesce(provider_id,p_provider_id),provider_status=p_status,updated_at=clock_timestamp()
      where operation_id=o.id returning * into a;
    if p_status='FAILURE' then
      insert into public.parent_events(request_id,kind,actor,summary,evidence) values(o.request_id,'snap_delivery.carrier_failed','caselink',
        'The fax service reported a failed transmission. Some pages may have arrived; agency receipt is still unconfirmed.',
        jsonb_build_object('operationId',o.id,'source','provider_api','reference','sinch-fax:'||a.provider_id,'transportStatus','FAILURE'));
    end if;
  end if;
  expiry:=case when initial then a.dispatch_expires_at else least(
    (select lease_until from public.parent_jobs where id=(p_intent->>'jobId')::uuid),
    (select verified_until from parent_private.provider_capabilities where program_id='snap-pa' and action='follow_up'),
    (select (mandate->>'expiresAt')::timestamptz from public.parent_requests where id=o.request_id)) end;
  return parent_private.snap_delivery_attempt(a,date_trunc('milliseconds',expiry));
exception when invalid_text_representation or unique_violation then raise exception 'SNAP delivery result unavailable' using errcode='42501';
end $$;

revoke execute on function parent_private.snap_delivery_context(jsonb,boolean,boolean),parent_private.snap_delivery_attempt(parent_private.snap_delivery_intents,timestamptz),
  parent_private.snap_delivery_check_route(public.parent_operations,parent_private.snap_delivery_intents),parent_private.parent_resume_snap_delivery(jsonb),
  parent_private.parent_reserve_snap_delivery(jsonb),parent_private.parent_recheck_snap_delivery(jsonb),parent_private.parent_read_snap_delivery(jsonb),parent_private.parent_record_snap_delivery(jsonb,text,text)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_snap_sender;
grant execute on function parent_private.parent_reserve_snap_delivery(jsonb),parent_private.parent_recheck_snap_delivery(jsonb),
  parent_private.parent_resume_snap_delivery(jsonb),parent_private.parent_read_snap_delivery(jsonb),parent_private.parent_record_snap_delivery(jsonb,text,text) to parent_snap_sender;
