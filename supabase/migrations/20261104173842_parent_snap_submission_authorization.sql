-- New SNAP filing has an explicit final Submit decision, separate from signatures and the mandate.
create table parent_private.snap_submission_authorizations (
  operation_id uuid primary key references public.parent_operations(id) on delete cascade,
  authorized_by uuid references auth.users(id) on delete set null,
  authorized_at timestamptz not null default now(),
  wake_lease_token uuid
);
alter table parent_private.snap_submission_authorizations enable row level security;
revoke all on parent_private.snap_submission_authorizations from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create function parent_private.snap_submission_authorized(p_operation_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from parent_private.snap_submission_authorizations a
    join public.parent_operations o on o.id=a.operation_id
    join public.parent_requests r on r.id=o.request_id
    join public.parent_households h on h.id=r.household_id
    where o.id=p_operation_id and o.need='snap_new' and o.action='submit' and o.state='prepared'
      and a.authorized_by=h.owner_id and parent_private.current_grant(o.request_id,o.request_version));
$$;
revoke execute on function parent_private.snap_submission_authorized(uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create function public.parent_authorize_snap_submission(p_request_id uuid,p_operation_id uuid,p_expected_version integer,p_packet_hash text,p_artifact_id uuid,p_content_sha256 text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_operation public.parent_operations; v_request public.parent_requests; v_artifact public.parent_form_artifacts; v_permission text; v_job public.parent_jobs; v_live_lease boolean; v_expired_lease boolean;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  select * into v_job from public.parent_jobs where request_id=p_request_id for update;
  select * into v_operation from public.parent_operations where id=p_operation_id and request_id=p_request_id for update;
  if not found or not parent_private.owns_request(p_request_id)
    or not parent_private.current_grant(p_request_id,p_expected_version)
    or v_operation.request_version is distinct from p_expected_version
    or v_operation.need<>'snap_new' or v_operation.action<>'submit'
    or p_packet_hash is null or p_packet_hash!~'^[a-f0-9]{64}$' or v_operation.packet_hash is distinct from p_packet_hash
    or p_artifact_id is null or v_operation.artifact_id is distinct from p_artifact_id
    or p_content_sha256 is null or p_content_sha256!~'^[a-f0-9]{64}$'
    or not parent_private.operation_allowed(p_request_id,p_expected_version,v_operation.program_id,v_operation.action,v_operation.data_categories,v_operation.document_ids,v_operation.packet,v_operation.need)
    then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
  select * into v_artifact from public.parent_form_artifacts where id=p_artifact_id;
  if not found or v_artifact.content_sha256 is distinct from p_content_sha256 then raise exception 'SNAP submission unavailable' using errcode='42501'; end if;
  perform parent_private.validate_form_artifact(p_request_id,p_expected_version,v_operation.need,v_operation.program_id,v_operation.action,v_operation.packet,p_artifact_id);
  select permission_version into v_permission from parent_private.provider_capabilities where program_id=v_operation.program_id and action=v_operation.action;
  if v_permission is distinct from v_operation.permission_version then raise exception 'provider permission changed' using errcode='42501'; end if;
  if exists(select 1 from parent_private.provider_capabilities c cross join lateral unnest(c.required_acts) required(act)
    where c.program_id=v_operation.program_id and c.action=v_operation.action and not exists(
      select 1 from parent_private.personal_act_evidence e where e.operation_id=v_operation.id and e.act=required.act and e.packet_hash=v_operation.packet_hash and e.expires_at>now()
    )) then raise exception 'required personal act has not been verified for this packet' using errcode='42501'; end if;
  v_live_lease:=v_job.state='leased' and v_job.lease_token is not null and v_job.lease_until>now()
    and v_job.lease_started_at>=now()-interval '15 minutes';
  v_expired_lease:=v_job.state='leased' and v_job.lease_until<now();
  if v_operation.state='prepared' then
    if (select count(*) from public.parent_operations where request_id=p_request_id and action not in ('research','prepare') and executed_at is not null)>=(v_request.mandate->>'maxAttempts')::integer then raise exception 'service attempt limit reached' using errcode='23514'; end if;
    if v_job.last_error='delivery_unknown' or exists(select 1 from public.parent_operations where request_id=p_request_id and need=v_operation.need and action not in ('research','prepare') and state='delivery_unknown') then raise exception 'unknown delivery requires reconciliation' using errcode='23514'; end if;
  end if;
  -- A network retry cannot renew authority or promise continuation for stranded prepared work.
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
revoke execute on function public.parent_authorize_snap_submission(uuid,uuid,integer,text,uuid,text) from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_authorize_snap_submission(uuid,uuid,integer,text,uuid,text) to authenticated;

-- A leased worker may wait or fail after Submit; resume that exact lease once within its budget.
create function parent_private.wake_after_snap_submit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.state='leased' and new.state in ('waiting','failed') and new.attempts<48 and old.lease_token is not null
    and new.last_error is distinct from 'delivery_unknown' and exists(
    select 1 from parent_private.snap_submission_authorizations a join public.parent_operations o on o.id=a.operation_id
    where a.wake_lease_token=old.lease_token and o.request_id=new.request_id and o.request_version=new.request_version
      and parent_private.snap_submission_authorized(o.id)
      and not exists(select 1 from public.parent_operations unknown_operation where unknown_operation.request_id=o.request_id
        and unknown_operation.need=o.need and unknown_operation.action not in ('research','prepare') and unknown_operation.state='delivery_unknown')
  ) then
    new.state:='queued'; new.run_at:=now(); new.lease_token:=null; new.lease_until:=null;
  end if;
  return new;
end $$;
revoke execute on function parent_private.wake_after_snap_submit() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
create trigger parent_snap_submit_resumption before update of state on public.parent_jobs
  for each row execute function parent_private.wake_after_snap_submit();

create or replace function parent_private.parent_begin_operation(p_operation_id uuid,p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations; v_request public.parent_requests; v_permission text;
begin
  select * into v_operation from public.parent_operations where id=p_operation_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_operation.request_version);
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  select * into v_request from public.parent_requests where id=v_job.request_id for update;
  if v_operation.request_id<>v_job.request_id or v_operation.state<>'prepared' or not parent_private.operation_allowed(v_job.request_id,v_operation.request_version,v_operation.program_id,v_operation.action,v_operation.data_categories,v_operation.document_ids,v_operation.packet,v_operation.need) then raise exception 'operation no longer executable' using errcode='42501'; end if;
  perform parent_private.validate_form_artifact(v_operation.request_id,v_operation.request_version,v_operation.need,v_operation.program_id,v_operation.action,v_operation.packet,v_operation.artifact_id);
  if v_operation.need='snap_new' and v_operation.action='submit' and not parent_private.snap_submission_authorized(v_operation.id) then raise exception 'the parent must choose Submit for this exact SNAP application' using errcode='42501'; end if;
  if v_operation.action not in ('research','prepare') then
    select permission_version into v_permission from parent_private.provider_capabilities where program_id=v_operation.program_id and action=v_operation.action;
    if v_permission is distinct from v_operation.permission_version then raise exception 'provider permission changed' using errcode='42501'; end if;
    if exists(select 1 from parent_private.provider_capabilities c cross join lateral unnest(c.required_acts) required(act) where c.program_id=v_operation.program_id and c.action=v_operation.action and not exists(select 1 from parent_private.personal_act_evidence e where e.operation_id=v_operation.id and e.act=required.act and e.packet_hash=v_operation.packet_hash and e.expires_at>now())) then raise exception 'required personal act has not been verified for this packet' using errcode='42501'; end if;
    if (select count(*) from public.parent_operations where request_id=v_job.request_id and action not in ('research','prepare') and executed_at is not null)>=(v_request.mandate->>'maxAttempts')::integer then raise exception 'service attempt limit reached' using errcode='23514'; end if;
    if exists(select 1 from public.parent_operations where request_id=v_job.request_id and need=v_operation.need and action not in ('research','prepare') and state='delivery_unknown') then raise exception 'unknown delivery requires reconciliation' using errcode='23514'; end if;
  end if;
  update public.parent_operations set state='executing',executed_at=now(),updated_at=now() where id=p_operation_id;
  insert into parent_private.receipt_authority(operation_id,job_id,lease_token,packet_hash,valid_until) values(p_operation_id,p_job_id,p_lease_token,v_operation.packet_hash,now()+interval '10 minutes');
  return jsonb_build_object('operationId',v_operation.id,'packet',v_operation.packet,'packetHash',v_operation.packet_hash,'idempotencyKey',v_operation.idempotency_key,'programId',v_operation.program_id,'need',v_operation.need,'action',v_operation.action,'permissionVersion',v_permission,'artifact',(select to_jsonb(a) from public.parent_form_artifacts a where a.id=v_operation.artifact_id));
end $$;

create or replace function parent_private.parent_get_operations(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object(
    'personalActsComplete',case when o.action in ('research','prepare') then true else exists(select 1 from parent_private.provider_capabilities c where c.program_id=o.program_id and c.action=o.action and c.required_acts is not null and not exists(select 1 from unnest(c.required_acts) required(act) where not exists(select 1 from parent_private.personal_act_evidence e where e.operation_id=o.id and e.act=required.act and e.packet_hash=o.packet_hash and e.expires_at>now()))) end,
    'snapSubmissionAuthorized',parent_private.snap_submission_authorized(o.id)
  ) order by o.created_at),'[]') from public.parent_operations o where o.request_id=v_job.request_id);
end $$;
