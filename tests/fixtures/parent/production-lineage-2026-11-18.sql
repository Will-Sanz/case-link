-- TEST FIXTURE ONLY: observed production schema lineage, no data/activation/login SQL.

-- Never apply this fixture to production. Native runner requires its disposable loopback cluster.

set search_path=public;

alter table parent_private.provider_capabilities add column execution_kind text default 'live' not null;

alter table parent_private.provider_capabilities add constraint provider_capabilities_execution_kind_check CHECK (execution_kind = ANY (ARRAY['live'::text, 'sinch_emulation'::text]));

alter table public.parent_requests add column controlled_test boolean default false not null;

alter table public.parent_operations add column controlled_test boolean default false not null;

create table parent_private.snap_controlled_tests(
  "request_id" uuid not null,
  "owner_id" uuid not null,
  "snapshot_id" uuid not null,
  "snapshot_hash" text not null,
  "project_id" text not null,
  "service_id" text not null,
  "from_number" text not null,
  "enabled" boolean default false not null,
  "evidence_reference" text not null,
  "created_at" timestamp with time zone default clock_timestamp() not null,
  "expires_at" timestamp with time zone not null,
  constraint "snap_controlled_tests_check" CHECK (expires_at > created_at),
  constraint "snap_controlled_tests_evidence_reference_check" CHECK (length(btrim(evidence_reference)) >= 1 AND length(btrim(evidence_reference)) <= 2000),
  constraint "snap_controlled_tests_from_number_check" CHECK (from_number ~ '^\+1[2-9][0-9]{9}$'::text AND from_number <> '+19898989898'::text),
  constraint "snap_controlled_tests_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES parent_accounts(id) ON DELETE CASCADE,
  constraint "snap_controlled_tests_pkey" PRIMARY KEY (request_id),
  constraint "snap_controlled_tests_project_id_check" CHECK (project_id ~ '^[A-Za-z0-9_-]{1,100}$'::text),
  constraint "snap_controlled_tests_request_id_fkey" FOREIGN KEY (request_id) REFERENCES parent_requests(id) ON DELETE CASCADE,
  constraint "snap_controlled_tests_service_id_check" CHECK (service_id ~ '^[A-Za-z0-9_-]{1,100}$'::text),
  constraint "snap_controlled_tests_snapshot_hash_check" CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'::text),
  constraint "snap_controlled_tests_snapshot_id_fkey" FOREIGN KEY (snapshot_id) REFERENCES parent_snap_application_details(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX parent_one_snap_controlled_test ON parent_private.snap_controlled_tests USING btree (enabled) WHERE enabled;

CREATE OR REPLACE FUNCTION public.parent_authorization_window()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_now timestamptz:=now();
begin
  if not public.is_parent_session() then
    raise exception 'verified parent session required' using errcode='42501';
  end if;
  return jsonb_build_object('issuedAt',v_now,'expiresAt',least(v_now+interval '30 days',v_now+interval '720 hours'));
end $function$;

CREATE OR REPLACE FUNCTION public.parent_capability_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_parent_session() then raise exception 'parent session required' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('programId',p.program_id,'actions',p.actions,'enabled',jsonb_array_length(p.actions)>0)),'[]') from (
    select program_id,coalesce(jsonb_agg(action) filter(where execution_kind='live' and enabled and transport_verified and requires_form is not null and required_acts is not null and verified_until>now()),'[]') actions from parent_private.provider_capabilities group by program_id
  ) p);
end $function$;

CREATE OR REPLACE FUNCTION parent_private.current_grant(p_request uuid, p_version integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select parent_private.processing_enabled() and exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id
    where r.id=p_request and r.version=p_version and r.status='active' and r.mandate_revoked_at is null
      and a.status='active' and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')) and (u.banned_until is null or u.banned_until<now())
      and parent_private.existing_account_available(a.id)
      and (r.mandate->>'expiresAt')::timestamptz>now());
$function$;

CREATE OR REPLACE FUNCTION parent_private.parent_authorize_storage(p_job_id uuid, p_lease_token uuid, p_bucket text, p_object_path text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_job public.parent_jobs; v_document public.parent_documents; v_form public.parent_form_artifacts; v_template parent_private.form_templates;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_mode is null or p_mode not in ('download','upload') or p_object_path is null or length(p_object_path) not between 1 and 300 then raise exception 'invalid storage purpose' using errcode='42501'; end if;
  if p_bucket='parent-documents' and p_mode='download' then
    select * into v_document from public.parent_documents where request_id=v_job.request_id and upload_confirmed_at is not null and object_path=p_object_path and status in ('uploaded','processing','validated') and expires_at>now() and consent_version='2026-10-25'
      and exists(select 1 from public.parent_requests r where r.id=v_job.request_id and r.mandate->'allowedData' ? 'documents' and r.mandate->'allowedActions' ?| array['research','prepare']);
    if not found then raise exception 'document purpose unavailable' using errcode='42501'; end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType',v_document.media_type,'maxBytes',v_document.size_bytes);
  elsif p_bucket='parent-form-artifacts' then
    select * into v_form from public.parent_form_artifacts where request_id=v_job.request_id and request_version=v_job.request_version and object_path=p_object_path and status in ('registered','stored') and expires_at>now();
    if not found or (p_mode='upload' and v_form.status<>'registered') then raise exception 'form purpose unavailable' using errcode='42501'; end if;
    if v_form.snap_snapshot_id is not null then perform parent_private.validate_snap_preview_artifact(v_form); end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType','application/pdf','maxBytes',10485760,'expectedSha256',v_form.content_sha256);
  elsif p_bucket='parent-known-forms' and p_mode='download' then
    select t.* into v_template from parent_private.form_templates t join public.parent_requests r on r.id=v_job.request_id
      where t.object_path=p_object_path and t.active and t.verified_until>now() and r.mandate->'recipientIds' ? t.program_id;
    if not found then raise exception 'verified template purpose unavailable' using errcode='42501'; end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType','application/pdf','maxBytes',10485760,'expectedSha256',v_template.content_sha256);
  end if;
  raise exception 'unsupported storage purpose' using errcode='42501';
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_claim_assistant()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_request uuid; v_message public.parent_assistant_messages; v_token uuid:=gen_random_uuid();
begin
  update public.parent_assistant_messages m set status='failed',error='This question expired or the request changed. Send it again with the latest information.',lease_token=null,lease_until=null,updated_at=now()
    where m.status in ('queued','running') and (m.expires_at<=now() or not parent_private.assistant_owner_available(m.request_id,m.request_version) or (m.status='running' and m.lease_until<=now()));
  if not exists(select 1 from parent_private.worker_health h where h.singleton and h.assistant_ready and h.expires_at>now()) then return null; end if;
  select r.id into v_request from public.parent_requests r join public.parent_assistant_messages m on m.request_id=r.id where m.status='queued' and m.expires_at>now() and parent_private.assistant_owner_available(r.id,m.request_version) order by m.created_at for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_message from public.parent_assistant_messages where request_id=v_request and status='queued' for update;
  if not found or not parent_private.assistant_owner_available(v_request,v_message.request_version) then return null; end if;
  update public.parent_assistant_messages set status='running',lease_token=v_token,lease_until=least(expires_at,now()+interval '2 minutes'),updated_at=now() where id=v_message.id;
  return jsonb_build_object('messageId',v_message.id,'leaseToken',v_token,'question',v_message.question,'request',
    (select jsonb_build_object('id',r.id,'household_id',r.household_id,'version',r.version,'status',r.status,'intake',r.intake,'mandate',r.mandate,'plan',r.plan,'required_actions',r.required_actions,'facts',r.facts,'account_changed_at',r.account_changed_at,'intake_confirmed_at',r.intake_confirmed_at,'intake_need_scoped_fields',r.intake_need_scoped_fields,'created_at',r.created_at,'updated_at',r.updated_at,'next_actor',r.next_actor,'next_trigger',r.next_trigger,'next_run_at',r.next_run_at) from public.parent_requests r where r.id=v_request),
    'account',(select jsonb_build_object('language',a.preferences->'language','contactPreference',a.preferences->'contactPreference','quietHoursStart',a.preferences->'quietHoursStart','quietHoursEnd',a.preferences->'quietHoursEnd','updatedAt',a.updated_at) from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id where r.id=v_request),
    'operations',(select coalesce(jsonb_agg(v),'[]') from (select id,program_id,need,state,evidence,updated_at from public.parent_operations o where request_id=v_request and parent_private.current_account_evidence(o.request_id,o.need,o.created_at) order by created_at desc limit 50) v),
    'reports',(select coalesce(jsonb_agg(v),'[]') from (select evidence->>'need' need,evidence->>'outcome' outcome,created_at from public.parent_events where request_id=v_request and parent_private.current_account_evidence(request_id,evidence->>'need',created_at) and kind='parent.outcome_reported' and actor='parent' and evidence->>'attribution'='parent_reported' order by created_at desc limit 10) v),
    'documents',(select coalesce(jsonb_agg(v),'[]') from (select status,count(*) total from public.parent_documents where request_id=v_request and status not in ('deleted','deletion_pending') group by status) v),
    'history',(select coalesce(jsonb_agg(v),'[]') from (select request_version,question,answer from public.parent_assistant_messages where request_id=v_request and request_version=v_message.request_version and status='answered' order by created_at desc limit 4) v),
    'progress',parent_private.request_progress(v_request),
    'runtime',(select jsonb_build_object('planningReady',planning_ready and expires_at>now(),'assistantReady',assistant_ready and expires_at>now()) from parent_private.worker_health where singleton));
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_claim_cleanup(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_artifacts uuid[]; v_docs uuid[]; v_accounts uuid[]; v_requests uuid[]; v_batch parent_private.cleanup_batches; v_request uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid cleanup batch limit' using errcode='23514'; end if;
  -- Expiry erases reusable values; immutable attempted packets and receipts keep their own retention rules.
  for v_request in select r.id from public.parent_requests r where exists(select 1 from public.parent_documents d where d.request_id=r.id and d.facts_valid_until<=now() and d.facts<>'[]'::jsonb) order by r.id for update skip locked limit p_limit loop
    update public.parent_documents set facts='[]',source_observed_at=null,facts_valid_until=null where request_id=v_request and facts_valid_until<=now();
  end loop;
  -- Reapply deletion intent after a restore before any worker can obtain a current grant.
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id
    join parent_private.deletion_tombstones t on t.subject_hash=encode(sha256(convert_to('parent-account:'||h.owner_id::text,'UTF8')),'hex')
    where r.status<>'cancelled' order by r.id for update of r skip locked limit 100 loop
    perform parent_private.invalidate_work(v_request,'A prior account deletion was reapplied after restore.');
    update public.parent_requests set status='cancelled',mandate_revoked_at=now(),version=version+1,updated_at=now() where id=v_request;
  end loop;
  update public.parent_accounts a set status='deletion_requested',updated_at=now()
    where a.status<>'deletion_requested' and exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex'));
  select coalesce(array_agg(id),'{}') into v_docs from (
    select d.id from public.parent_documents d join public.parent_requests r on r.id=d.request_id join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id
    where ((d.status not in ('deleted','raw_deleted') and (d.status='deletion_pending' or d.expires_at<=now())) or (a.status='deletion_requested' and d.status not in ('deleted','raw_deleted')))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and d.id=any(b.document_ids))
    order by d.expires_at for update of d skip locked limit p_limit
  ) expired;
  select coalesce(array_agg(id),'{}') into v_artifacts from (
    select f.id from public.parent_form_artifacts f join public.parent_requests r on r.id=f.request_id join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id
    where f.status<>'deleted' and (a.status='deletion_requested' or (r.status in ('closed','cancelled') and r.updated_at<now()-interval '90 days') or (f.status='registered' and f.created_at<now()-interval '1 day'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and f.id=any(b.artifact_ids))
    order by f.created_at for update of f skip locked limit p_limit
  ) expired;
  select coalesce(array_agg(id),'{}') into v_accounts from (
    select a.id from public.parent_accounts a where a.status='deletion_requested'
      and not exists(select 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id join public.parent_documents d on d.request_id=r.id where h.owner_id=a.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and a.id=any(b.account_ids))
      and not exists(select 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id join public.parent_form_artifacts f on f.request_id=r.id where h.owner_id=a.id and f.status<>'deleted')
    order by a.updated_at limit p_limit
  ) eligible;
  select coalesce(array_agg(id),'{}') into v_requests from (
    select r.id from public.parent_requests r where r.status in ('closed','cancelled') and r.updated_at<now()-interval '90 days'
      and not exists(select 1 from public.parent_documents d where d.request_id=r.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and r.id=any(b.request_ids))
      and not exists(select 1 from public.parent_form_artifacts f where f.request_id=r.id and f.status<>'deleted')
    order by r.updated_at limit p_limit
  ) eligible;
  delete from parent_private.cleanup_batches where expires_at<now()-interval '1 day';
  delete from parent_private.retained_evidence where expires_at<now();
  delete from parent_private.deletion_tombstones where expires_at<now();
  if cardinality(v_docs)+cardinality(v_accounts)+cardinality(v_requests)+cardinality(v_artifacts)=0 then return null; end if;
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=any(v_accounts) order by r.id for update of r loop
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'mandate',encode(sha256(convert_to(mandate::text,'UTF8')),'hex'),created_at from public.parent_requests where id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'operation.'||state,packet_hash,coalesce(executed_at,created_at) from public.parent_operations where request_id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at) select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'form',content_sha256,created_at from public.parent_form_artifacts where request_id=v_request on conflict do nothing;
  end loop;
  insert into parent_private.cleanup_batches(document_ids,account_ids,request_ids,artifact_ids) values(v_docs,v_accounts,v_requests,v_artifacts) returning * into v_batch;
  return jsonb_build_object('batchId',v_batch.id,'leaseToken',v_batch.lease_token,
    'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'objectPath',d.object_path)),'[]') from public.parent_documents d where d.id=any(v_docs)),
    'artifacts',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'objectPath',f.object_path)),'[]') from public.parent_form_artifacts f where f.id=any(v_artifacts)),
    'accountIds',v_accounts,'requestIds',v_requests);
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_claim_job(p_lease_seconds integer, p_continuation_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_job public.parent_jobs; v_token uuid:=gen_random_uuid(); v_request jsonb; v_request_id uuid;
begin
  if p_continuation_only is null then raise exception 'invalid continuation mode' using errcode='23514'; end if;
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'invalid lease duration' using errcode='23514'; end if;
  select r.id into v_request_id from public.parent_requests r join public.parent_jobs j on j.request_id=r.id
    where ((j.state in ('queued','waiting') and j.run_at<=now()) or (j.state='leased' and j.lease_until<now()))
      and j.attempts<48 and parent_private.current_grant(r.id,j.request_version)
      and (not p_continuation_only or (r.intake->'needs' ? 'snap_new' and exists(select 1 from public.parent_operations o
        where o.request_id=r.id and o.need='snap_new' and o.program_id='snap-pa' and o.action='submit'
          and o.artifact_id is null and cardinality(o.document_ids)=0
          and o.packet=jsonb_build_object('protectedSnapPacket',o.packet->'protectedSnapPacket')
          and jsonb_typeof(o.packet->'protectedSnapPacket')='object'
          and o.idempotency_key='snap-final:'||(o.packet#>>'{protectedSnapPacket,packetId}')
          and o.packet_hash=encode(sha256(convert_to(o.packet::text,'UTF8')),'hex')
          and (o.state in ('executing','delivery_unknown') or (o.state='prepared' and o.request_version=j.request_version
            and parent_private.snap_protected_packet_current(o) and parent_private.snap_protected_parent_submit_ready(o)
            and (not parent_private.snap_submission_authorized(o.id) or parent_private.personal_acts_complete(o)))))))
    order by j.run_at for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_job from public.parent_jobs where request_id=v_request_id for update;
  if not parent_private.current_grant(v_request_id,v_job.request_version) then return null; end if;
  -- Lock order is request, job, operation for claims, cancellation and dispatch alike.
  update public.parent_operations set state='delivery_unknown',updated_at=now()
    where request_id=v_request_id and state='executing';
  update public.parent_jobs set state='leased',lease_token=v_token,lease_until=now()+make_interval(secs=>p_lease_seconds),lease_started_at=now(),attempts=attempts+1,updated_at=now() where id=v_job.id;
  select to_jsonb(r)-'mandate_revoked_at'-'start_key' into v_request from public.parent_requests r where r.id=v_request_id;
  return jsonb_build_object('jobId',v_job.id,'leaseToken',v_token,'request',v_request,
    'documents',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('object_path',case when d.status='raw_deleted' or d.expires_at<=now() then null else d.object_path end,'raw_available',d.status in ('uploaded','processing','validated') and d.expires_at>now())),'[]') from public.parent_documents d where d.request_id=v_request_id and d.upload_confirmed_at is not null and d.status not in ('deleted','deletion_pending') and (d.expires_at>now() or (d.status in ('validated','raw_deleted') and d.facts_valid_until>now()))),
    'unknownOperations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.parent_operations o where o.request_id=v_request_id and o.state='delivery_unknown'));
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_claim_job(p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select parent_private.parent_claim_job(p_lease_seconds,false);
$function$;

CREATE OR REPLACE FUNCTION parent_private.parent_get_operations(p_job_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('personalActsComplete',parent_private.personal_acts_complete(o),
    'snapSubmissionAuthorized',parent_private.snap_submission_authorized(o.id),
    'protectedParentSubmitReady',case when o.packet ? 'protectedSnapPacket' then parent_private.snap_protected_parent_submit_ready(o) else false end,
    'protectedPacketCurrent',case when o.packet ? 'protectedSnapPacket' then parent_private.snap_protected_packet_current(o) else false end)
    order by o.created_at),'[]') from public.parent_operations o where o.request_id=v_job.request_id);
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_reserve_snap_delivery(p_intent jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION parent_private.processing_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select enabled and length(coalesce(approval_reference,''))>0 and approved_until>now() from parent_private.processing_controls where singleton),false);
$function$;

CREATE OR REPLACE FUNCTION parent_private.request_progress(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.parent_requests; j public.parent_jobs; h parent_private.worker_health;
  v_state text; v_summary text; v_running boolean:=false; v_next timestamptz;
begin
  select * into r from public.parent_requests where id=p_request;
  if not found then return null; end if;
  select * into j from public.parent_jobs where request_id=p_request;
  select * into h from parent_private.worker_health where singleton;
  v_running:=coalesce(h.planning_ready and h.expires_at>now() and parent_private.current_grant(r.id,r.version),false);
  if r.status='cancelled' then
    v_state:='cancelled';v_summary:='You cancelled this request. Future work is stopped.';
  elsif r.status='paused' then
    v_state:='paused';v_summary:='You paused this request. Resume when you are ready.';
  elsif r.status='closed' then
    v_state:='closed';v_summary:='This request is closed. Check the recorded outcomes below.';
  elsif (r.mandate->>'expiresAt')::timestamptz<=now() then
    v_state:='needs_parent';v_summary:='Your permission has expired. Review and renew it before background work can continue.';
  elsif not v_running then
    v_state:='service_offline';v_summary:='Your request is saved. Background planning is unavailable right now; no application submission is implied.';
  elsif j.state='leased' and j.lease_until>now() then
    v_state:='running';v_summary:='CaseLink is working on an authorized planning step. Only recorded receipts confirm an external action.';
  elsif j.state='failed' then
    v_state:='failed';v_summary:='A background step could not finish. Your saved information is safe; CaseLink needs to resolve the issue.';
  elsif exists(select 1 from jsonb_array_elements(r.required_actions) a where coalesce(a->>'resolver','parent')='parent' and a->>'resolved' is distinct from 'true') then
    v_state:='needs_parent';v_summary:='A step needs you. See the specific question or permission below; only affected work waits.';
  elsif j.state in ('queued','waiting') and j.run_at<=now() then
    v_state:='queued';v_summary:='Your next planning step is queued for the background service.';
  else
    v_state:='waiting';
    v_summary:=case when r.next_actor='service_operator' then 'CaseLink needs to finish connecting this program before it can send anything. Preparation is saved.'
      when r.next_actor in ('partner','agency') then 'Waiting for the next recorded program update. Check the activity below for what was actually sent.'
      else 'Preparation is saved. The next permitted check will run when it is due.' end;
  end if;
  if v_running and j.state in ('queued','waiting') and isfinite(j.run_at) then v_next:=j.run_at;end if;
  return jsonb_build_object('state',v_state,'summary',v_summary,
    'updatedAt',greatest(r.updated_at,j.updated_at),'nextRunAt',v_next,
    'canContinueAfterClosing',coalesce(v_running and j.state in ('queued','waiting','leased'),false));
end $function$;

CREATE OR REPLACE FUNCTION parent_private.reserve_model_capacity()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_start timestamptz; v_limit integer;
begin
  perform pg_advisory_xact_lock(627281901);
  select model_budget_started_at,model_call_limit into v_start,v_limit from parent_private.processing_controls where singleton;
  if v_start>now() then return false; end if;
  if v_limit is not null and greatest(
    (select count(*) from parent_private.model_call_reservations where created_at>=v_start),
    (select count(*) from parent_private.ai_calls where created_at>=v_start)+(select count(*) from parent_private.assistant_calls where created_at>=v_start)
  )>=v_limit then return false; end if;
  insert into parent_private.model_call_reservations default values;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION parent_private.snap_delivery_check_route(o parent_operations, a parent_private.snap_delivery_intents)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION parent_private.snap_details_collection_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select parent_private.processing_enabled() and coalesce((select
    snap_details_enabled and length(btrim(coalesce(snap_details_approval_reference,'')))>0
    and snap_details_approved_until>now()
    and snap_details_notice_version='snap-application-details-2026-11-03.v1'
    from parent_private.processing_controls where singleton),false)
    and now()>='2026-11-03T00:00:00Z'::timestamptz and now()<'2026-12-03T05:00:00Z'::timestamptz;
$function$;

CREATE OR REPLACE FUNCTION parent_private.snap_direct_acquisition_authority(p_acquisition uuid, p_request uuid, p_version integer, p_snapshot uuid, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.parent_snap_application_collection()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_snap boolean;
begin
  if not public.is_parent_session() then raise exception 'verified parent session required' using errcode='42501'; end if;
  v_snap:=parent_private.snap_details_collection_enabled();
  return jsonb_build_object('collectionEnabled',v_snap,'noticeVersion',case when v_snap then 'snap-application-details-2026-11-03.v1' else null end);
end $function$;

CREATE OR REPLACE FUNCTION parent_private.guard_snap_test_authorization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION parent_private.guard_snap_test_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 new.controlled_test:=(tg_op='UPDATE' and old.controlled_test) or exists(select 1 from public.parent_requests where id=new.request_id and controlled_test);
 if new.controlled_test
   and new.state in ('agency_submitted','assistance_approved','support_received','partner_received','partner_accepted') then
   raise exception 'fictional tests cannot establish real outcomes' using errcode='42501';
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_recheck_snap_test_delivery(p_intent jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.parent_operations; a parent_private.snap_delivery_intents;
begin
  o:=parent_private.snap_delivery_context(p_intent,true);
  select * into a from parent_private.snap_delivery_intents where operation_id=o.id for update;
  if not found or a.intent is distinct from p_intent or a.dispatch_authorized_at is not null or a.dispatch_expires_at<=clock_timestamp()
    then raise exception 'SNAP delivery dispatch unavailable' using errcode='42501'; end if;
  perform parent_private.snap_test_delivery_check_route(o,a);
  update parent_private.snap_delivery_intents set dispatch_authorized_at=clock_timestamp(),updated_at=clock_timestamp() where operation_id=o.id returning * into a;
  return parent_private.snap_delivery_attempt(a,a.dispatch_expires_at);
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_reserve_snap_test_delivery(p_intent jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION parent_private.parent_resume_snap_test_delivery(p_intent jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION parent_private.preserve_snap_test_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if old.controlled_test and not new.controlled_test then raise exception 'fictional test classification is permanent' using errcode='42501'; end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION parent_private.snap_controlled_test_binding(p_request uuid, p_snapshot uuid, p_hash text)
 RETURNS parent_private.snap_controlled_tests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION parent_private.snap_test_delivery_check_route(o parent_operations, a parent_private.snap_delivery_intents)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t parent_private.snap_controlled_tests; expected jsonb;
begin
 t:=parent_private.snap_controlled_test_binding(o.request_id,(a.intent#>>'{protectedPacket,snapshotId}')::uuid,a.intent#>>'{protectedPacket,snapshotHash}');
 expected:=jsonb_build_object('kind','sinch_emulation','requestId',t.request_id,'snapshotHash',t.snapshot_hash,
   'projectId',t.project_id,'serviceId',t.service_id,'from',t.from_number,'to','+19898989898',
   'destinationId','sinch-free-emulator','destinationVersion','controlled-test-v1');
 if a.route is distinct from expected or not exists(select 1 from parent_private.provider_capabilities
   where program_id='snap-pa' and action='submit' and execution_kind='sinch_emulation' and enabled and verified_until>clock_timestamp()) then
   raise exception 'controlled SNAP test route changed' using errcode='42501'; end if;
end $function$;

CREATE TRIGGER parent_snap_test_authorization BEFORE INSERT ON parent_private.snap_final_packet_authorizations FOR EACH ROW EXECUTE FUNCTION parent_private.guard_snap_test_authorization();

CREATE TRIGGER parent_snap_test_outcome BEFORE INSERT OR UPDATE ON parent_operations FOR EACH ROW EXECUTE FUNCTION parent_private.guard_snap_test_outcome();

CREATE TRIGGER parent_preserve_snap_test_request BEFORE UPDATE ON parent_requests FOR EACH ROW EXECUTE FUNCTION parent_private.preserve_snap_test_request();

alter table "parent_private"."snap_controlled_tests" owner to postgres;

alter table "parent_private"."snap_controlled_tests" enable row level security;

alter table "parent_private"."snap_controlled_tests" no force row level security;

revoke all on table "parent_private"."snap_controlled_tests" from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on table "parent_private"."snap_controlled_tests" from %I',r);end loop;end $fixture$;

grant all on table "parent_private"."snap_controlled_tests" to postgres;

alter table "parent_private"."snap_delivery_intents" owner to postgres;

alter table "parent_private"."snap_delivery_intents" enable row level security;

alter table "parent_private"."snap_delivery_intents" no force row level security;

revoke all on table "parent_private"."snap_delivery_intents" from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on table "parent_private"."snap_delivery_intents" from %I',r);end loop;end $fixture$;

grant all on table "parent_private"."snap_delivery_intents" to postgres;

alter table "public"."parent_operations" owner to postgres;

alter table "public"."parent_operations" enable row level security;

alter table "public"."parent_operations" no force row level security;

revoke all on table "public"."parent_operations" from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on table "public"."parent_operations" from %I',r);end loop;end $fixture$;

grant all on table "public"."parent_operations" to postgres;

grant select on table "public"."parent_operations" to "authenticated";

alter table "public"."parent_requests" owner to postgres;

alter table "public"."parent_requests" enable row level security;

alter table "public"."parent_requests" no force row level security;

revoke all on table "public"."parent_requests" from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on table "public"."parent_requests" from %I',r);end loop;end $fixture$;

grant all on table "public"."parent_requests" to postgres;

grant select on table "public"."parent_requests" to "authenticated";

alter function parent_authorization_window() owner to postgres;

revoke all on function parent_authorization_window() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_authorization_window() from %I',r);end loop;end $fixture$;

grant execute on function parent_authorization_window() to "postgres";

grant execute on function parent_authorization_window() to "authenticated";

alter function parent_capability_summary() owner to postgres;

revoke all on function parent_capability_summary() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_capability_summary() from %I',r);end loop;end $fixture$;

grant execute on function parent_capability_summary() to "postgres";

grant execute on function parent_capability_summary() to "authenticated";

alter function parent_private.current_grant(uuid,integer) owner to postgres;

revoke all on function parent_private.current_grant(uuid,integer) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.current_grant(uuid,integer) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.current_grant(uuid,integer) to "postgres";

alter function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) owner to postgres;

revoke all on function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) to "postgres";

grant execute on function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) to "parent_storage_broker";

alter function parent_private.parent_claim_assistant() owner to postgres;

revoke all on function parent_private.parent_claim_assistant() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_claim_assistant() from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_claim_assistant() to "postgres";

grant execute on function parent_private.parent_claim_assistant() to "parent_worker";

alter function parent_private.parent_claim_cleanup(integer) owner to postgres;

revoke all on function parent_private.parent_claim_cleanup(integer) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_claim_cleanup(integer) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_claim_cleanup(integer) to "postgres";

grant execute on function parent_private.parent_claim_cleanup(integer) to "parent_retention_worker";

alter function parent_private.parent_claim_job(integer,boolean) owner to postgres;

revoke all on function parent_private.parent_claim_job(integer,boolean) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_claim_job(integer,boolean) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_claim_job(integer,boolean) to "postgres";

grant execute on function parent_private.parent_claim_job(integer,boolean) to "parent_worker";

alter function parent_private.parent_claim_job(integer) owner to postgres;

revoke all on function parent_private.parent_claim_job(integer) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_claim_job(integer) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_claim_job(integer) to "postgres";

grant execute on function parent_private.parent_claim_job(integer) to "parent_worker";

alter function parent_private.parent_get_operations(uuid,uuid) owner to postgres;

revoke all on function parent_private.parent_get_operations(uuid,uuid) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_get_operations(uuid,uuid) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_get_operations(uuid,uuid) to "postgres";

grant execute on function parent_private.parent_get_operations(uuid,uuid) to "parent_worker";

alter function parent_private.parent_reserve_snap_delivery(jsonb) owner to postgres;

revoke all on function parent_private.parent_reserve_snap_delivery(jsonb) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_reserve_snap_delivery(jsonb) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_reserve_snap_delivery(jsonb) to "postgres";

grant execute on function parent_private.parent_reserve_snap_delivery(jsonb) to "parent_snap_sender";

alter function parent_private.processing_enabled() owner to postgres;

revoke all on function parent_private.processing_enabled() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.processing_enabled() from %I',r);end loop;end $fixture$;

grant execute on function parent_private.processing_enabled() to "postgres";

alter function parent_private.request_progress(uuid) owner to postgres;

revoke all on function parent_private.request_progress(uuid) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.request_progress(uuid) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.request_progress(uuid) to "postgres";

alter function parent_private.reserve_model_capacity() owner to postgres;

revoke all on function parent_private.reserve_model_capacity() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.reserve_model_capacity() from %I',r);end loop;end $fixture$;

grant execute on function parent_private.reserve_model_capacity() to "postgres";

alter function parent_private.snap_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) owner to postgres;

revoke all on function parent_private.snap_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.snap_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.snap_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) to "postgres";

alter function parent_private.snap_details_collection_enabled() owner to postgres;

revoke all on function parent_private.snap_details_collection_enabled() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.snap_details_collection_enabled() from %I',r);end loop;end $fixture$;

grant execute on function parent_private.snap_details_collection_enabled() to "postgres";

grant execute on function parent_private.snap_details_collection_enabled() to "authenticated";

alter function parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text) owner to postgres;

revoke all on function parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text) to "postgres";

alter function parent_snap_application_collection() owner to postgres;

revoke all on function parent_snap_application_collection() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_snap_application_collection() from %I',r);end loop;end $fixture$;

grant execute on function parent_snap_application_collection() to "postgres";

grant execute on function parent_snap_application_collection() to "authenticated";

alter function parent_private.guard_snap_test_authorization() owner to postgres;

revoke all on function parent_private.guard_snap_test_authorization() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.guard_snap_test_authorization() from %I',r);end loop;end $fixture$;

grant execute on function parent_private.guard_snap_test_authorization() to "postgres";

alter function parent_private.guard_snap_test_outcome() owner to postgres;

revoke all on function parent_private.guard_snap_test_outcome() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.guard_snap_test_outcome() from %I',r);end loop;end $fixture$;

grant execute on function parent_private.guard_snap_test_outcome() to "postgres";

alter function parent_private.parent_recheck_snap_test_delivery(jsonb) owner to postgres;

revoke all on function parent_private.parent_recheck_snap_test_delivery(jsonb) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_recheck_snap_test_delivery(jsonb) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_recheck_snap_test_delivery(jsonb) to "postgres";

grant execute on function parent_private.parent_recheck_snap_test_delivery(jsonb) to "parent_snap_sender";

alter function parent_private.parent_reserve_snap_test_delivery(jsonb) owner to postgres;

revoke all on function parent_private.parent_reserve_snap_test_delivery(jsonb) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_reserve_snap_test_delivery(jsonb) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_reserve_snap_test_delivery(jsonb) to "postgres";

grant execute on function parent_private.parent_reserve_snap_test_delivery(jsonb) to "parent_snap_sender";

alter function parent_private.parent_resume_snap_test_delivery(jsonb) owner to postgres;

revoke all on function parent_private.parent_resume_snap_test_delivery(jsonb) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.parent_resume_snap_test_delivery(jsonb) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.parent_resume_snap_test_delivery(jsonb) to "postgres";

grant execute on function parent_private.parent_resume_snap_test_delivery(jsonb) to "parent_snap_sender";

alter function parent_private.preserve_snap_test_request() owner to postgres;

revoke all on function parent_private.preserve_snap_test_request() from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.preserve_snap_test_request() from %I',r);end loop;end $fixture$;

grant execute on function parent_private.preserve_snap_test_request() to "postgres";

alter function parent_private.snap_controlled_test_binding(uuid,uuid,text) owner to postgres;

revoke all on function parent_private.snap_controlled_test_binding(uuid,uuid,text) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.snap_controlled_test_binding(uuid,uuid,text) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.snap_controlled_test_binding(uuid,uuid,text) to "postgres";

alter function parent_private.snap_test_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) owner to postgres;

revoke all on function parent_private.snap_test_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) from public;

do $fixture$ declare r text;begin for r in select rolname from pg_roles where rolname !~ '^pg_' loop execute format('revoke all on function parent_private.snap_test_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) from %I',r);end loop;end $fixture$;

grant execute on function parent_private.snap_test_delivery_check_route(parent_operations,parent_private.snap_delivery_intents) to "postgres";
