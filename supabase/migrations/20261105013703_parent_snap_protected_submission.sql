-- Parent reports retain honest attribution and can satisfy only the exact protected SNAP acts below.
alter table parent_private.personal_act_evidence
  add column attribution text check(attribution in ('parent_reported','partner_reported','operator_confirmed')),
  add column protected_packet_id uuid,
  add column protected_content_sha256 text check(protected_content_sha256~'^[a-f0-9]{64}$'),
  add constraint parent_act_protected_binding check((protected_packet_id is null)=(protected_content_sha256 is null)
    and (attribution is distinct from 'parent_reported' or protected_packet_id is not null));

-- Legacy/missing applicability metadata fails readiness rather than assuming every household needs only two acts.
create function parent_private.valid_snap_required_acts(acts text[]) returns boolean language sql immutable set search_path='' as $$
  select acts is not null and cardinality(acts) between 2 and 20 and array_position(acts,null) is null
    and acts@>array['applicant_signature_printed_page_1','rights_certification_printed_page_5']::text[]
    and (select count(*)=count(distinct act) and bool_and(act~'^[a-z][a-z0-9_]{0,99}$') from unnest(acts) act);
$$;
alter table parent_private.snap_final_packet_verifications add column required_personal_acts text[]
  check(required_personal_acts is null or parent_private.valid_snap_required_acts(required_personal_acts));

-- The opaque canonical PDF still carries exactly the data categories the recipient is allowed to receive.
create or replace function parent_private.snap_protected_operation_context(p_request uuid,p_version integer,p_packet jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p parent_private.snap_final_packets; v parent_private.snap_final_packet_verifications; b jsonb; r public.parent_requests; c parent_private.provider_capabilities;
begin
  if jsonb_typeof(p_packet) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_packet))<>1
    or jsonb_typeof(p_packet->'protectedSnapPacket') is distinct from 'object'
    then raise exception 'protected SNAP operation unavailable' using errcode='42501'; end if;
  select * into p from parent_private.snap_final_packets where id=(p_packet#>>'{protectedSnapPacket,packetId}')::uuid and request_id=p_request;
  if not found or p.request_version is distinct from p_version or p.state<>'stored' or p.expires_at<=clock_timestamp()
    then raise exception 'protected SNAP operation unavailable' using errcode='42501'; end if;
  select * into v from parent_private.snap_final_packet_verifications where packet_id=p.id;
  if not found or v.id::text is distinct from p_packet#>>'{protectedSnapPacket,verificationId}'
    or v.snapshot_id<>p.snapshot_id or v.snapshot_hash<>p.snapshot_hash or v.content_sha256<>p.content_sha256
    or v.verified_at<p.created_at or v.verified_at>clock_timestamp() or v.expires_at<=clock_timestamp() or v.expires_at>p.expires_at
    or p_packet is distinct from parent_private.snap_protected_operation_packet(p,v)
    then raise exception 'protected SNAP content verification unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_final_packet_authority(p.authorization_id,p_request,p_version,p.snapshot_id,p.snapshot_hash);
  select * into r from public.parent_requests where id=p_request;
  select * into c from parent_private.provider_capabilities where program_id='snap-pa' and action='submit';
  if v.source is distinct from b#>'{snapshot,source}' or coalesce(b#>>'{snapshot,details,zip}','')!~'^191[0-9]{2}$'
    or r.mandate->>'mode' is distinct from 'full' or not(r.mandate->'allowedActions' ? 'submit')
    or not coalesce(c.enabled and c.transport_verified and c.requires_form and c.verified_until>clock_timestamp(),false)
    or c.required_acts is null or not('protectedSnapPacket'=any(c.allowed_fields)) or c.field_categories->>'protectedSnapPacket' is distinct from 'household'
    or not(array(select jsonb_array_elements_text(b->'dataCategories'))<@array(select value from jsonb_each_text(c.field_categories) where key=any(c.allowed_fields)))
    then raise exception 'protected SNAP execution permission unavailable' using errcode='42501'; end if;
  return jsonb_build_object('packetId',p.id,'verificationId',v.id,'dataCategories',b->'dataCategories','permissionVersion',c.permission_version);
exception when invalid_text_representation then raise exception 'protected SNAP operation unavailable' using errcode='42501';
end $$;

-- The ordinary route stays byte-for-byte intact behind this single narrow dispatcher.
alter function parent_private.operation_allowed(uuid,integer,text,text,text[],uuid[],jsonb,text) rename to ordinary_operation_allowed;
create function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;
begin
  if not(p_packet ? 'protectedSnapPacket') then
    return parent_private.ordinary_operation_allowed(p_request,p_version,p_program,p_action,p_data,p_documents,p_packet,p_need);
  end if;
  if p_need is distinct from 'snap_new' or p_program is distinct from 'snap-pa' or p_action is distinct from 'submit'
    or p_documents is null or cardinality(p_documents)<>0 then return false; end if;
  context:=parent_private.snap_protected_operation_context(p_request,p_version,p_packet);
  return p_data is not distinct from array(select jsonb_array_elements_text(context->'dataCategories'));
exception when others then return false;
end $$;

create function parent_private.validate_operation_artifact(o public.parent_operations) returns void
language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
  if not(o.packet ? 'protectedSnapPacket') then
    perform parent_private.validate_form_artifact(o.request_id,o.request_version,o.need,o.program_id,o.action,o.packet,o.artifact_id);
    return;
  end if;
  context:=parent_private.snap_protected_operation_context(o.request_id,o.request_version,o.packet);
  if o.need<>'snap_new' or o.program_id<>'snap-pa' or o.action<>'submit' or o.artifact_id is not null
    or o.permission_version is distinct from context->>'permissionVersion'
    or o.data_categories is distinct from array(select jsonb_array_elements_text(context->'dataCategories')) or cardinality(o.document_ids)<>0
    or not exists(select 1 from parent_private.snap_final_packets p where p.id=(context->>'packetId')::uuid and p.operation_id=o.id)
    then raise exception 'protected SNAP canonical operation changed' using errcode='42501'; end if;
end $$;

create function parent_private.required_personal_acts(o public.parent_operations) returns text[]
language plpgsql volatile security definer set search_path='' as $$
declare required text[]; applicable text[];
begin
  select c.required_acts into required from parent_private.provider_capabilities c where c.program_id=o.program_id and c.action=o.action;
  if required is null then return null; end if;
  if o.packet ? 'protectedSnapPacket' then
    perform parent_private.validate_operation_artifact(o);
    select v.required_personal_acts into applicable from parent_private.snap_final_packet_verifications v where v.id=(o.packet#>>'{protectedSnapPacket,verificationId}')::uuid;
    if applicable is null then return null; end if;
    -- Source-required acts remain necessary even if a capability accidentally omits them.
    required:=array(select distinct act from unnest(required||applicable||array['applicant_signature_printed_page_1','rights_certification_printed_page_5']) act);
  end if;
  return required;
end $$;

create function parent_private.personal_acts_complete(o public.parent_operations) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare required text[]; owner_id uuid; protected boolean:=o.packet ? 'protectedSnapPacket';
begin
  if o.action in ('research','prepare') then return true; end if;
  required:=parent_private.required_personal_acts(o);
  if required is null then return false; end if;
  if protected then
    select h.owner_id into owner_id from public.parent_requests r join public.parent_households h on h.id=r.household_id where r.id=o.request_id;
  end if;
  return not exists(select 1 from unnest(required) required_act where not exists(
    select 1 from parent_private.personal_act_evidence e where e.operation_id=o.id and e.act=required_act and e.packet_hash=o.packet_hash
      and e.expires_at>case when protected then clock_timestamp() else now() end and (
        e.attribution is distinct from 'parent_reported' or (protected
          and required_act=any(array['applicant_signature_printed_page_1','rights_certification_printed_page_5'])
          and e.verified_by=owner_id and e.reference='parent-submit:'||o.id::text
          and e.protected_packet_id::text=o.packet#>>'{protectedSnapPacket,packetId}'
          and e.protected_content_sha256=o.packet#>>'{protectedSnapPacket,contentSha256}')
      )
  ));
exception when others then return false;
end $$;

-- Both Submit entry points share the already-proven job, replay, budget and unknown-delivery boundary.
create function parent_private.authorize_snap_submission(
  p_request_id uuid,p_operation_id uuid,p_expected_version integer,p_packet_hash text,p_artifact_id uuid,p_packet_id uuid,p_content_sha256 text,p_completed_acts text[]
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_operation public.parent_operations; v_request public.parent_requests; v_artifact public.parent_form_artifacts; v_packet parent_private.snap_final_packets;
  v_permission text; v_job public.parent_jobs; v_live_lease boolean; v_expired_lease boolean; v_protected boolean; v_reported integer;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  select * into v_job from public.parent_jobs where request_id=p_request_id for update;
  select * into v_operation from public.parent_operations where id=p_operation_id and request_id=p_request_id for update;
  if not found or not parent_private.owns_request(p_request_id)
    or not parent_private.current_grant(p_request_id,p_expected_version)
    or v_operation.request_version is distinct from p_expected_version or v_operation.need<>'snap_new' or v_operation.action<>'submit'
    or p_packet_hash is null or p_packet_hash!~'^[a-f0-9]{64}$' or v_operation.packet_hash is distinct from p_packet_hash
    or p_content_sha256 is null or p_content_sha256!~'^[a-f0-9]{64}$'
    or not parent_private.operation_allowed(p_request_id,p_expected_version,v_operation.program_id,v_operation.action,v_operation.data_categories,v_operation.document_ids,v_operation.packet,v_operation.need)
    then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
  v_protected:=v_operation.packet ? 'protectedSnapPacket';
  if v_protected then
    select * into v_packet from parent_private.snap_final_packets where id=p_packet_id and request_id=p_request_id for update;
    if not found or p_artifact_id is not null or v_operation.artifact_id is not null or v_packet.operation_id is distinct from p_operation_id
      or v_packet.id::text is distinct from v_operation.packet#>>'{protectedSnapPacket,packetId}' or v_packet.content_sha256 is distinct from p_content_sha256
      or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid
        and (s.not_after is null or s.not_after>clock_timestamp()))
      then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
    if p_completed_acts is null or cardinality(p_completed_acts)<>2
      or not(p_completed_acts@>array['applicant_signature_printed_page_1','rights_certification_printed_page_5']::text[])
      then raise exception 'report the actual required personal steps for this application' using errcode='23514'; end if;
  else
    if p_packet_id is not null or p_artifact_id is null or v_operation.artifact_id is distinct from p_artifact_id
      then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
    select * into v_artifact from public.parent_form_artifacts where id=p_artifact_id;
    if not found or v_artifact.content_sha256 is distinct from p_content_sha256 then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
  end if;
  perform parent_private.validate_operation_artifact(v_operation);
  select permission_version into v_permission from parent_private.provider_capabilities where program_id=v_operation.program_id and action=v_operation.action;
  if v_permission is distinct from v_operation.permission_version then raise exception 'provider permission changed' using errcode='42501'; end if;
  if v_protected and v_operation.state='prepared' and not exists(select 1 from parent_private.snap_submission_authorizations where operation_id=p_operation_id) then
    -- This records the parent's own report of prior ink completion, never an observed or verified signature.
    insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_by,verified_at,expires_at,attribution,protected_packet_id,protected_content_sha256)
      select p_operation_id,act,v_operation.packet_hash,'parent-submit:'||p_operation_id::text,auth.uid(),clock_timestamp(),
        v_packet.expires_at,'parent_reported',v_packet.id,v_packet.content_sha256 from unnest(p_completed_acts) act
      on conflict(operation_id,act,packet_hash,reference) do nothing;
    get diagnostics v_reported=row_count;
    if v_reported>0 then insert into public.parent_events(request_id,kind,actor,summary,evidence)
      values(p_request_id,'personal_act.reported','parent','You reported completing the named handwritten certifications on this exact application.',
        jsonb_build_object('operationId',p_operation_id,'acts',p_completed_acts,'attribution','parent_reported','method','parent_declared_handwritten')); end if;
  end if;
  if not parent_private.personal_acts_complete(v_operation) then raise exception 'required personal act has not been verified for this packet' using errcode='42501'; end if;
  v_live_lease:=v_job.state='leased' and v_job.lease_token is not null and v_job.lease_until>now()
    and v_job.lease_started_at>=now()-interval '15 minutes';
  v_expired_lease:=v_job.state='leased' and v_job.lease_until<now();
  if v_operation.state='prepared' then
    if (select count(*) from public.parent_operations where request_id=p_request_id and action not in ('research','prepare') and executed_at is not null)>=(v_request.mandate->>'maxAttempts')::integer then raise exception 'service attempt limit reached' using errcode='23514'; end if;
    if v_job.last_error='delivery_unknown' or exists(select 1 from public.parent_operations where request_id=p_request_id and need=v_operation.need and action not in ('research','prepare') and state='delivery_unknown') then raise exception 'unknown delivery requires reconciliation' using errcode='23514'; end if;
  end if;
  if exists(select 1 from parent_private.snap_submission_authorizations where operation_id=p_operation_id and authorized_by=auth.uid()) then
    if v_operation.state='prepared' and not coalesce(v_job.request_version=p_expected_version and (
      (v_live_lease and v_job.attempts<=48) or (v_job.attempts<48 and (v_expired_lease or (v_job.state in ('queued','waiting') and v_job.run_at<=clock_timestamp())))
    ),false) then raise exception 'SNAP submission continuation unavailable' using errcode='23514'; end if;
    return p_operation_id;
  end if;
  if v_operation.state<>'prepared' then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
  if v_job.id is null or v_job.request_version is distinct from p_expected_version or v_job.attempts>=48
    or not coalesce(v_job.state in ('queued','waiting','failed') or v_live_lease or v_expired_lease,false)
    then raise exception 'SNAP submission continuation unavailable' using errcode='23514'; end if;
  insert into parent_private.snap_submission_authorizations(operation_id,authorized_by,wake_lease_token)
    values(p_operation_id,auth.uid(),case when v_job.state='leased' then v_job.lease_token end);
  update public.parent_jobs set state='queued',run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now()
    where request_id=p_request_id and state in ('queued','waiting','failed') and parent_private.current_grant(request_id,request_version);
  insert into public.parent_events(request_id,kind,actor,summary,evidence)
    values(p_request_id,'snap_submission.authorized','parent','You chose Submit for the exact prepared SNAP application.',jsonb_build_object('operationId',p_operation_id));
  return p_operation_id;
end $$;

create or replace function public.parent_authorize_snap_submission(p_request_id uuid,p_operation_id uuid,p_expected_version integer,p_packet_hash text,p_artifact_id uuid,p_content_sha256 text) returns uuid
language sql security definer set search_path='' as $$
  select parent_private.authorize_snap_submission(p_request_id,p_operation_id,p_expected_version,p_packet_hash,p_artifact_id,null,p_content_sha256,null);
$$;
create function public.parent_authorize_snap_protected_submission(p_request_id uuid,p_operation_id uuid,p_expected_version integer,p_packet_hash text,p_packet_id uuid,p_content_sha256 text,p_completed_acts text[]) returns uuid
language sql security definer set search_path='' as $$
  select parent_private.authorize_snap_submission(p_request_id,p_operation_id,p_expected_version,p_packet_hash,null,p_packet_id,p_content_sha256,p_completed_acts);
$$;

create or replace function parent_private.parent_begin_operation(p_operation_id uuid,p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations; v_request public.parent_requests; v_permission text;
begin
  select * into v_operation from public.parent_operations where id=p_operation_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_operation.request_version);
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  select * into v_request from public.parent_requests where id=v_job.request_id for update;
  if v_operation.request_id<>v_job.request_id or v_operation.state<>'prepared' or not parent_private.operation_allowed(v_job.request_id,v_operation.request_version,v_operation.program_id,v_operation.action,v_operation.data_categories,v_operation.document_ids,v_operation.packet,v_operation.need) then raise exception 'operation no longer executable' using errcode='42501'; end if;
  perform parent_private.validate_operation_artifact(v_operation);
  if v_operation.need='snap_new' and v_operation.action='submit' and not parent_private.snap_submission_authorized(v_operation.id) then raise exception 'the parent must choose Submit for this exact SNAP application' using errcode='42501'; end if;
  if v_operation.action not in ('research','prepare') then
    select permission_version into v_permission from parent_private.provider_capabilities where program_id=v_operation.program_id and action=v_operation.action;
    if v_permission is distinct from v_operation.permission_version then raise exception 'provider permission changed' using errcode='42501'; end if;
    if not parent_private.personal_acts_complete(v_operation) then raise exception 'required personal act has not been verified for this packet' using errcode='42501'; end if;
    if (select count(*) from public.parent_operations where request_id=v_job.request_id and action not in ('research','prepare') and executed_at is not null)>=(v_request.mandate->>'maxAttempts')::integer then raise exception 'service attempt limit reached' using errcode='23514'; end if;
    if exists(select 1 from public.parent_operations where request_id=v_job.request_id and need=v_operation.need and action not in ('research','prepare') and state='delivery_unknown') then raise exception 'unknown delivery requires reconciliation' using errcode='23514'; end if;
  end if;
  update public.parent_operations set state='executing',executed_at=now(),updated_at=now() where id=p_operation_id;
  insert into parent_private.receipt_authority(operation_id,job_id,lease_token,packet_hash,valid_until) values(p_operation_id,p_job_id,p_lease_token,v_operation.packet_hash,now()+interval '10 minutes');
  return jsonb_build_object('operationId',v_operation.id,'packet',v_operation.packet,'packetHash',v_operation.packet_hash,'idempotencyKey',v_operation.idempotency_key,'programId',v_operation.program_id,'need',v_operation.need,'action',v_operation.action,'permissionVersion',v_permission,
    'artifact',(select to_jsonb(a) from public.parent_form_artifacts a where a.id=v_operation.artifact_id),
    'protectedPacket',v_operation.packet->'protectedSnapPacket');
end $$;

create or replace function parent_private.parent_get_operations(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('personalActsComplete',parent_private.personal_acts_complete(o),
    'snapSubmissionAuthorized',parent_private.snap_submission_authorized(o.id)) order by o.created_at),'[]') from public.parent_operations o where o.request_id=v_job.request_id);
end $$;

create or replace function public.parent_record_personal_act(p_operation_id uuid,p_act text,p_reference text,p_observed_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare v_membership parent_private.trusted_memberships; v_operation public.parent_operations; v_existing parent_private.personal_act_evidence;
begin
  v_membership:=parent_private.referral_membership(p_operation_id,false);
  select * into v_operation from public.parent_operations where id=p_operation_id;
  perform 1 from public.parent_requests where id=v_operation.request_id for update;
  perform 1 from public.parent_jobs where request_id=v_operation.request_id for update;
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  v_membership:=parent_private.referral_membership(p_operation_id,false);
  if not v_membership.can_verify_personal_acts or not parent_private.current_grant(v_operation.request_id,v_operation.request_version)
    or v_operation.state<>'prepared'
    or not parent_private.operation_allowed(v_operation.request_id,v_operation.request_version,v_operation.program_id,v_operation.action,v_operation.data_categories,v_operation.document_ids,v_operation.packet,v_operation.need)
    or p_act is null or not exists(select 1 from parent_private.provider_capabilities c where c.program_id=v_operation.program_id and c.action=v_operation.action
      and c.enabled and c.transport_verified and c.verified_until>now() and c.permission_version=v_operation.permission_version and p_act=any(parent_private.required_personal_acts(v_operation)))
    or length(btrim(coalesce(p_reference,''))) not between 1 and 200 or p_observed_at is null then raise exception 'verified personal-act authority unavailable' using errcode='42501'; end if;
  select * into v_existing from parent_private.personal_act_evidence where operation_id=p_operation_id and act=p_act and packet_hash=v_operation.packet_hash and reference=p_reference;
  if found then
    if v_existing.verified_at=p_observed_at then return; end if;
    raise exception 'verification reference already binds another observation' using errcode='23514';
  end if;
  if p_observed_at>now() or p_observed_at<v_operation.created_at or p_observed_at+interval '24 hours'<=now()
    or exists(select 1 from parent_private.personal_act_evidence e where e.operation_id=p_operation_id and e.act=p_act and e.packet_hash=v_operation.packet_hash and e.verified_at>=p_observed_at)
    then raise exception 'a current newer personal-act observation is required' using errcode='23514'; end if;
  perform parent_private.validate_operation_artifact(v_operation);
  insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_by,verified_at,expires_at,attribution)
    values(p_operation_id,p_act,v_operation.packet_hash,p_reference,auth.uid(),p_observed_at,least(v_membership.expires_at,p_observed_at+interval '24 hours'),
      case when v_membership.role='partner' then 'partner_reported' else 'operator_confirmed' end);
  update public.parent_jobs set state='queued',run_at=now(),updated_at=now() where request_id=v_operation.request_id and state='waiting' and parent_private.current_grant(request_id,request_version);
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_operation.request_id,'personal_act.verified',v_membership.role,'A required personal step was verified for the prepared packet.',jsonb_build_object('operationId',p_operation_id,'act',p_act,'attribution',v_membership.role||'_confirmed'));
end $$;

revoke execute on function parent_private.operation_allowed(uuid,integer,text,text,text[],uuid[],jsonb,text),parent_private.validate_operation_artifact(public.parent_operations),
  parent_private.valid_snap_required_acts(text[]),parent_private.required_personal_acts(public.parent_operations),parent_private.personal_acts_complete(public.parent_operations),parent_private.authorize_snap_submission(uuid,uuid,integer,text,uuid,uuid,text,text[])
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
revoke execute on function public.parent_authorize_snap_protected_submission(uuid,uuid,integer,text,uuid,text,text[]) from public,anon,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_authorize_snap_protected_submission(uuid,uuid,integer,text,uuid,text,text[]) to authenticated;
