-- Retain each genuine verification; retries cannot refresh its evidence deadline.
alter table parent_private.personal_act_evidence drop constraint personal_act_evidence_pkey;
alter table parent_private.personal_act_evidence
  add primary key(operation_id,act,packet_hash,reference);

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
      and c.enabled and c.transport_verified and c.verified_until>now() and c.permission_version=v_operation.permission_version and p_act=any(c.required_acts))
    or length(btrim(coalesce(p_reference,''))) not between 1 and 200 or p_observed_at is null then raise exception 'verified personal-act authority unavailable' using errcode='42501'; end if;
  select * into v_existing from parent_private.personal_act_evidence
    where operation_id=p_operation_id and act=p_act and packet_hash=v_operation.packet_hash and reference=p_reference;
  if found then
    if v_existing.verified_at=p_observed_at then return; end if;
    raise exception 'verification reference already binds another observation' using errcode='23514';
  end if;
  if p_observed_at>now() or p_observed_at<v_operation.created_at or p_observed_at+interval '24 hours'<=now()
    or exists(select 1 from parent_private.personal_act_evidence e where e.operation_id=p_operation_id and e.act=p_act and e.packet_hash=v_operation.packet_hash and e.verified_at>=p_observed_at)
    then raise exception 'a current newer personal-act observation is required' using errcode='23514'; end if;
  perform parent_private.validate_form_artifact(v_operation.request_id,v_operation.request_version,v_operation.need,v_operation.program_id,v_operation.action,v_operation.packet,v_operation.artifact_id);
  insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_by,verified_at,expires_at)
    values(p_operation_id,p_act,v_operation.packet_hash,p_reference,auth.uid(),p_observed_at,least(v_membership.expires_at,p_observed_at+interval '24 hours'));
  update public.parent_jobs set state='queued',run_at=now(),updated_at=now() where request_id=v_operation.request_id and state='waiting' and parent_private.current_grant(request_id,request_version);
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_operation.request_id,'personal_act.verified',v_membership.role,'A required personal step was verified for the prepared packet.',jsonb_build_object('operationId',p_operation_id,'act',p_act,'attribution',v_membership.role||'_confirmed'));
end $$;
