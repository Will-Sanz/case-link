-- Explicit, single-request rehearsal. Production fax destinations and their emulator exclusion stay unchanged.
alter table public.parent_requests add column controlled_test boolean not null default false;
alter table public.parent_operations add column controlled_test boolean not null default false;
alter table parent_private.provider_capabilities add column execution_kind text not null default 'live'
  check(execution_kind in ('live','sinch_emulation'));
create table parent_private.snap_controlled_tests (
 request_id uuid primary key references public.parent_requests(id) on delete cascade,
 owner_id uuid not null references public.parent_accounts(id) on delete cascade,
 snapshot_id uuid not null references public.parent_snap_application_details(id) on delete cascade,
 snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
 project_id text not null check(project_id~'^[A-Za-z0-9_-]{1,100}$'),
 service_id text not null check(service_id~'^[A-Za-z0-9_-]{1,100}$'),
 from_number text not null check(from_number~'^\+1[2-9][0-9]{9}$' and from_number<>'+19898989898'),
 enabled boolean not null default false, evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 2000),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null check(expires_at>created_at)
);
create unique index parent_one_snap_controlled_test on parent_private.snap_controlled_tests(enabled) where enabled;
alter table parent_private.snap_controlled_tests enable row level security;
revoke all on parent_private.snap_controlled_tests from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_snap_sender;

create function parent_private.snap_controlled_test_binding(p_request uuid,p_snapshot uuid,p_hash text)
returns parent_private.snap_controlled_tests language plpgsql volatile security definer set search_path='' as $$
declare t parent_private.snap_controlled_tests; b jsonb;
begin
 select t0.* into t from parent_private.snap_controlled_tests t0 join public.parent_requests r on r.id=t0.request_id
   join public.parent_households h on h.id=r.household_id
   where t0.request_id=p_request and t0.snapshot_id=p_snapshot and t0.snapshot_hash=p_hash and t0.enabled
     and t0.expires_at>clock_timestamp() and r.controlled_test and r.intake->'needs'='["snap_new"]'::jsonb
     and h.owner_id=t0.owner_id for share of t0;
 if not found then raise exception 'controlled SNAP test unavailable' using errcode='42501'; end if;
 b:=parent_private.snap_application_binding(p_request,(select version from public.parent_requests where id=p_request),p_snapshot,p_hash);
 if b is null or not parent_private.snap_snapshot_provenance_current(b->'snapshot') then
   raise exception 'controlled SNAP test changed' using errcode='42501'; end if;
 return t;
end $$;

-- An emulator capability never authorizes another request or the older upload-only signing path.
create function parent_private.guard_snap_test_authorization() returns trigger
language plpgsql security definer set search_path='' as $$
declare t parent_private.snap_controlled_tests;
begin
 if exists(select 1 from public.parent_requests where id=new.request_id and controlled_test)
   or exists(select 1 from parent_private.provider_capabilities where program_id='snap-pa' and action='submit' and execution_kind='sinch_emulation') then
   if not exists(select 1 from parent_private.provider_capabilities where program_id='snap-pa' and action='submit' and execution_kind='sinch_emulation') then
     raise exception 'fictional tests cannot use live authority' using errcode='42501'; end if;
   t:=parent_private.snap_controlled_test_binding(new.request_id,new.snapshot_id,new.snapshot_hash);
   if new.owner_id<>t.owner_id or (new.authorization_kind='packet' and new.acquisition_authorization_id is null) then
     raise exception 'controlled SNAP test authority unavailable' using errcode='42501'; end if;
 end if;
 return new;
end $$;
create trigger parent_snap_test_authorization before insert on parent_private.snap_final_packet_authorizations
 for each row execute function parent_private.guard_snap_test_authorization();

-- Test observations can never become agency registration, approval or actual support.
create function parent_private.guard_snap_test_outcome() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.controlled_test:=(tg_op='UPDATE' and old.controlled_test) or exists(select 1 from public.parent_requests where id=new.request_id and controlled_test);
 if new.controlled_test
   and new.state in ('agency_submitted','assistance_approved','support_received','partner_received','partner_accepted') then
   raise exception 'fictional tests cannot establish real outcomes' using errcode='42501';
 end if;
 return new;
end $$;
create trigger parent_snap_test_outcome before insert or update on public.parent_operations
 for each row execute function parent_private.guard_snap_test_outcome();

create or replace function parent_private.snap_direct_acquisition_authority(p_acquisition uuid,p_request uuid,p_version integer,p_snapshot uuid,p_hash text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a parent_private.snap_final_packet_authorizations; r public.parent_requests; c parent_private.processing_controls;
  b jsonb; v_owner uuid; subjects uuid[]; expires timestamptz;
begin
  if exists(select 1 from public.parent_requests where id=p_request and controlled_test)
    or exists(select 1 from parent_private.provider_capabilities where program_id='snap-pa' and action='submit' and execution_kind='sinch_emulation') then
    if not exists(select 1 from parent_private.provider_capabilities where program_id='snap-pa' and action='submit' and execution_kind='sinch_emulation') then
      raise exception 'fictional tests cannot use live authority' using errcode='42501'; end if;
    perform parent_private.snap_controlled_test_binding(p_request,p_snapshot,p_hash);
  end if;
  select * into c from parent_private.processing_controls where singleton;
  if not coalesce(c.snap_protected_enabled,false) or not parent_private.processing_enabled()
    or c.approved_until<=clock_timestamp() or not parent_private.snap_details_collection_enabled() or c.snap_details_approved_until<=clock_timestamp()
    or length(btrim(coalesce(c.snap_protected_approval_reference,'')))=0 or c.snap_protected_approved_until is null or c.snap_protected_approved_until<=clock_timestamp()
    or c.snap_protected_policy_version is null or c.snap_protected_retention_policy_version is null or c.snap_protected_max_retention_seconds is null
    or clock_timestamp()<'2026-11-03T00:00:00Z'::timestamptz or clock_timestamp()>='2026-12-03T05:00:00Z'::timestamptz
    then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  if not parent_private.snap_protected_route_verified('pa600fs-direct-completion-2026-11-05.v1')
    then raise exception 'protected SNAP route unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request;
  select h.owner_id into v_owner from public.parent_households h where h.id=r.household_id;
  if p_version is null or p_snapshot is null or p_hash is null or not parent_private.current_grant(p_request,p_version)
    or (r.mandate->>'expiresAt')::timestamptz<=clock_timestamp()
    then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_application_binding(p_request,p_version,p_snapshot,p_hash);
  if b is null or not parent_private.snap_snapshot_provenance_current(b->'snapshot')
    or jsonb_array_length(b#>'{snapshot,details,household}')>8
    or jsonb_array_length(coalesce(b#>'{snapshot,details,income,entries}','[]'::jsonb))>5
    or b#>'{snapshot,details,authorizedRepresentative}' is not null
    or exists(select 1 from jsonb_array_elements(b#>'{snapshot,details,household}') person where person->>'requestingSnap'='true' and person->>'citizen' is distinct from 'true')
    then raise exception 'protected SNAP acquisition route unavailable' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects
    from jsonb_array_elements(b#>'{snapshot,details,household}') person where person->>'requestingSnap'='true';
  if subjects is null then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  if p_acquisition is null then
    select x.* into a from parent_private.snap_final_packet_authorizations x join public.parent_snap_application_details original on original.id=x.snapshot_id
      where x.request_id=p_request and x.owner_id=v_owner and x.authorization_kind='direct_entry'
        and x.subject_ids=subjects and x.recipient='snap-pa' and x.need='snap_new' and x.purpose='snap_final_application_packet'
        and x.policy_version=c.snap_protected_policy_version and x.retention_policy_version=c.snap_protected_retention_policy_version
        and x.revoked_at is null and x.expires_at>clock_timestamp() and x.consented_at<=clock_timestamp()
        and original.source=b#>'{snapshot,source}' order by x.consented_at,x.id limit 1;
  else
    select x.* into a from parent_private.snap_final_packet_authorizations x where x.id=p_acquisition and x.request_id=p_request and x.owner_id=v_owner and x.authorization_kind='direct_entry';
    if not found then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  end if;
  if a.id is not null and (a.owner_id is distinct from v_owner or a.request_id is distinct from p_request
    or a.authorization_kind<>'direct_entry' or a.acquisition_authorization_id is not null or a.packet_id is not null
    or a.subject_ids is distinct from subjects or a.recipient<>'snap-pa' or a.need<>'snap_new' or a.purpose<>'snap_final_application_packet'
    or a.policy_version is distinct from c.snap_protected_policy_version or a.retention_policy_version is distinct from c.snap_protected_retention_policy_version
    or a.authorization_session_id is null or a.authority_declaration is distinct from 'parent_declared_household_data_authority'
    or a.revoked_at is not null or a.expires_at<=clock_timestamp() or a.consented_at>clock_timestamp() or a.consented_at>a.created_at
    or not exists(select 1 from public.parent_snap_application_details original where original.id=a.snapshot_id and original.request_id=p_request and original.source=b#>'{snapshot,source}'))
    then raise exception 'protected SNAP acquisition changed' using errcode='42501'; end if;
  expires:=date_trunc('milliseconds',least(c.approved_until,c.snap_details_approved_until,c.snap_protected_approved_until,
    (r.mandate->>'expiresAt')::timestamptz,'2026-12-03T05:00:00Z'::timestamptz,
    a.expires_at,coalesce(a.consented_at,clock_timestamp())+make_interval(secs=>c.snap_protected_max_retention_seconds)));
  if expires is null or expires<=clock_timestamp() then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  return b||jsonb_build_object('acquisition',case when a.id is null then null else to_jsonb(a) end,'ownerId',v_owner,'expiresAt',expires,
    'metadata',jsonb_build_object('state',case when a.id is null then 'permission_needed' else 'authorized' end,
      'acquisitionId',a.id,'ownerId',v_owner,'requestId',p_request,'requestVersion',p_version,'snapshotId',p_snapshot,'snapshotHash',p_hash,
      'recipient','snap-pa','need','snap_new','purpose','snap_final_application_packet','method','pa600fs-direct-completion-2026-11-05.v1',
      'fieldScope',jsonb_build_array('applicant_ssn','applicant_signature_printed_page_1','applicant_signature_date_printed_page_1','rights_certification_printed_page_5','rights_certification_date_printed_page_5'),
      'source',b#>'{snapshot,source}','subjectIds',to_jsonb(subjects),'policyVersion',c.snap_protected_policy_version,'retentionPolicyVersion',c.snap_protected_retention_policy_version,
      'authorityDeclaration',a.authority_declaration,'consentedAt',case when a.id is null then null else to_char(a.consented_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'expiresAt',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end $$;

create function parent_private.snap_test_delivery_check_route(o public.parent_operations,a parent_private.snap_delivery_intents) returns void
language plpgsql volatile set search_path='' as $$
declare t parent_private.snap_controlled_tests; expected jsonb;
begin
 t:=parent_private.snap_controlled_test_binding(o.request_id,(a.intent#>>'{protectedPacket,snapshotId}')::uuid,a.intent#>>'{protectedPacket,snapshotHash}');
 expected:=jsonb_build_object('kind','sinch_emulation','requestId',t.request_id,'snapshotHash',t.snapshot_hash,
   'projectId',t.project_id,'serviceId',t.service_id,'from',t.from_number,'to','+19898989898',
   'destinationId','sinch-free-emulator','destinationVersion','controlled-test-v1');
 if a.route is distinct from expected or not exists(select 1 from parent_private.provider_capabilities
   where program_id='snap-pa' and action='submit' and execution_kind='sinch_emulation' and enabled and verified_until>clock_timestamp()) then
   raise exception 'controlled SNAP test route changed' using errcode='42501'; end if;
end $$;

create function parent_private.parent_reserve_snap_test_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents; t parent_private.snap_controlled_tests;
 p parent_private.snap_final_packets; expiry timestamptz; envelope jsonb; route jsonb;
begin
 o:=parent_private.snap_delivery_context(p_intent,true);
 t:=parent_private.snap_controlled_test_binding(o.request_id,(p_intent#>>'{protectedPacket,snapshotId}')::uuid,p_intent#>>'{protectedPacket,snapshotHash}');
 if not exists(select 1 from parent_private.provider_capabilities where program_id='snap-pa' and action='submit' and execution_kind='sinch_emulation' and enabled) then
   raise exception 'controlled SNAP test unavailable' using errcode='42501'; end if;
 select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
 if found then
   if a.intent-'jobId'-'leaseToken' is distinct from p_intent-'jobId'-'leaseToken' then raise exception 'controlled SNAP test changed' using errcode='42501'; end if;
   perform parent_private.snap_test_delivery_check_route(o,a);
   return jsonb_build_object('state','reconcile_only','attempt',parent_private.snap_delivery_attempt(a,a.dispatch_expires_at));
 end if;
 if o.state<>'executing' then raise exception 'controlled SNAP test unavailable' using errcode='42501'; end if;
 select * into p from parent_private.snap_final_packets where id=(p_intent#>>'{protectedPacket,packetId}')::uuid and operation_id=o.id;
 expiry:=date_trunc('milliseconds',least(p.expires_at,t.expires_at,
   (select verified_until from parent_private.provider_capabilities where program_id='snap-pa' and action='submit'),
   (select (mandate->>'expiresAt')::timestamptz from public.parent_requests where id=o.request_id)));
 if expiry is null or expiry<=clock_timestamp() then raise exception 'controlled SNAP test expired' using errcode='42501'; end if;
 route:=jsonb_build_object('kind','sinch_emulation','requestId',t.request_id,'snapshotHash',t.snapshot_hash,
   'projectId',t.project_id,'serviceId',t.service_id,'from',t.from_number,'to','+19898989898',
   'destinationId','sinch-free-emulator','destinationVersion','controlled-test-v1');
 insert into parent_private.snap_delivery_intents(operation_id,intent,route,reserved_lease_token,dispatch_expires_at)
   values(o.id,p_intent,route,(p_intent->>'leaseToken')::uuid,expiry) returning * into a;
 envelope:=parent_private.parent_read_snap_final_packet(p.id,p.request_id,p.request_version,p.authorization_id,p.snapshot_id,p.snapshot_hash);
 return jsonb_build_object('state','dispatch_allowed','attempt',parent_private.snap_delivery_attempt(a,expiry),'envelope',envelope);
end $$;

create function parent_private.parent_resume_snap_test_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents; envelope jsonb;
begin
  o:=parent_private.snap_delivery_context(p_intent,true,true);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
  if not found or a.intent-'jobId'-'leaseToken' is distinct from p_intent-'jobId'-'leaseToken'
    or a.dispatch_authorized_at is not null or a.provider_id is not null or a.provider_status<>'UNKNOWN'
    or a.dispatch_expires_at<=clock_timestamp()
    then raise exception 'SNAP delivery resume unavailable' using errcode='42501'; end if;
  perform parent_private.snap_test_delivery_check_route(o,a);
  envelope:=parent_private.parent_read_snap_final_packet((a.intent#>>'{protectedPacket,packetId}')::uuid,o.request_id,o.request_version,
    (a.intent#>>'{protectedPacket,authorizationId}')::uuid,(a.intent#>>'{protectedPacket,snapshotId}')::uuid,a.intent#>>'{protectedPacket,snapshotHash}');
  insert into parent_private.receipt_authority(operation_id,job_id,lease_token,packet_hash,valid_until)
    values(o.id,(p_intent->>'jobId')::uuid,(p_intent->>'leaseToken')::uuid,o.packet_hash,least(a.dispatch_expires_at,clock_timestamp()+interval '10 minutes'))
    on conflict(operation_id) do update set job_id=excluded.job_id,lease_token=excluded.lease_token,packet_hash=excluded.packet_hash,valid_until=excluded.valid_until;
  update parent_private.snap_delivery_intents set intent=p_intent,reserved_lease_token=(p_intent->>'leaseToken')::uuid,updated_at=clock_timestamp()
    where operation_id=o.id returning * into a;
  return jsonb_build_object('state','dispatch_allowed','attempt',parent_private.snap_delivery_attempt(a,a.dispatch_expires_at),'envelope',envelope);
end $$;

create function parent_private.parent_recheck_snap_test_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents;
begin
  o:=parent_private.snap_delivery_context(p_intent,true);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
  if not found or a.intent is distinct from p_intent or a.dispatch_authorized_at is not null or a.dispatch_expires_at<=clock_timestamp()
    then raise exception 'SNAP delivery dispatch unavailable' using errcode='42501'; end if;
  perform parent_private.snap_test_delivery_check_route(o,a);
  update parent_private.snap_delivery_intents set dispatch_authorized_at=clock_timestamp(),updated_at=clock_timestamp() where operation_id=o.id returning * into a;
  return parent_private.snap_delivery_attempt(a,a.dispatch_expires_at);
end $$;

revoke execute on function parent_private.snap_controlled_test_binding(uuid,uuid,text),parent_private.guard_snap_test_authorization(),parent_private.guard_snap_test_outcome(),parent_private.snap_test_delivery_check_route(public.parent_operations,parent_private.snap_delivery_intents),parent_private.parent_reserve_snap_test_delivery(jsonb),parent_private.parent_resume_snap_test_delivery(jsonb),parent_private.parent_recheck_snap_test_delivery(jsonb)
 from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_snap_sender;
grant execute on function parent_private.parent_reserve_snap_test_delivery(jsonb),parent_private.parent_resume_snap_test_delivery(jsonb),parent_private.parent_recheck_snap_test_delivery(jsonb) to parent_snap_sender;

-- Rehearsal access is never advertised as a live program connection during new intake.
create or replace function public.parent_capability_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_parent_session() then raise exception 'parent session required' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('programId',p.program_id,'actions',p.actions,'enabled',jsonb_array_length(p.actions)>0)),'[]') from (
    select program_id,coalesce(jsonb_agg(action) filter(where execution_kind='live' and enabled and transport_verified and requires_form is not null and required_acts is not null and verified_until>now()),'[]') actions from parent_private.provider_capabilities group by program_id
  ) p);
end $$;

-- A rehearsal is permanent evidence classification, not a switch into a government application.
create function parent_private.preserve_snap_test_request() returns trigger language plpgsql set search_path='' as $$
begin
 if old.controlled_test and not new.controlled_test then raise exception 'fictional test classification is permanent' using errcode='42501'; end if;
 return new;
end $$;
create trigger parent_preserve_snap_test_request before update on public.parent_requests
 for each row execute function parent_private.preserve_snap_test_request();
revoke execute on function parent_private.preserve_snap_test_request() from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_snap_sender;

create or replace function parent_private.parent_reserve_snap_delivery(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.parent_operations; a parent_private.snap_delivery_intents; d parent_private.snap_delivery_destinations;
  p parent_private.snap_final_packets; c parent_private.provider_capabilities; zip text; routes integer; expiry timestamptz; envelope jsonb; route jsonb;
begin
  o:=parent_private.snap_delivery_context(p_intent,true);
  if o.controlled_test or exists(select 1 from public.parent_requests where id=o.request_id and controlled_test) then
    raise exception 'fictional tests cannot use production delivery' using errcode='42501'; end if;
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

create or replace function parent_private.snap_delivery_check_route(o public.parent_operations,a parent_private.snap_delivery_intents) returns void
language plpgsql volatile set search_path='' as $$
declare d parent_private.snap_delivery_destinations; routes integer;
begin
  if o.controlled_test or exists(select 1 from public.parent_requests where id=o.request_id and controlled_test) then
    raise exception 'fictional tests cannot use production delivery' using errcode='42501'; end if;
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
