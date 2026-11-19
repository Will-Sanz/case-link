-- Background copies check their real-time lease under the same request/job locks before key access and before commit.
create function parent_private.parent_check_utility_reuse_job(p_job uuid,p_lease uuid,p_request uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare job public.parent_jobs;
begin
  job:=parent_private.require_lease(p_job,p_lease,p_version);
  if job.request_id is distinct from p_request or job.lease_until<=clock_timestamp() or job.lease_started_at<clock_timestamp()-interval '15 minutes' then
    raise exception 'utility reuse work authority changed' using errcode='42501'; end if;
end $$;
revoke execute on function parent_private.parent_check_utility_reuse_job(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_check_utility_reuse_job(uuid,uuid,uuid,integer) to parent_utility_protected;

-- The isolated worker can reuse fresh originals after a correction without a viewer or retained parent session.
create function parent_private.parent_get_utility_reuse_candidates(p_job uuid,p_lease uuid,p_request uuid,p_version integer,p_program text,p_snapshot uuid,p_revision integer,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.parent_jobs; c jsonb; a parent_private.utility_protected_authorizations; result jsonb:='[]'; old_source jsonb; table_name text; account_ref uuid;
begin
  job:=parent_private.require_lease(p_job,p_lease,p_version);
  if job.request_id is distinct from p_request then raise exception 'utility reuse job changed' using errcode='42501'; end if;
  perform parent_private.parent_check_utility_reuse_job(p_job,p_lease,p_request,p_version);
  c:=parent_private.parent_get_utility_protected_context(p_request,p_version,p_program,p_snapshot,p_revision,p_hash);
  table_name:=case p_program when 'peco-cap' then 'parent_peco_application_details' when 'pgw-crp' then 'parent_pgw_application_details' when 'pwd-tap' then 'parent_water_application_details' end;
  for a in select distinct on (coalesce(source.consent_evidence->>'originAuthorizationId',source.id::text)) source.*
    from parent_private.utility_protected_authorizations source join parent_private.utility_protected_inputs i on i.input_id=source.input_id and i.state='stored'
    where source.request_id=p_request and source.owner_id=(c->>'ownerId')::uuid and source.program_id=p_program and source.revoked_at is null and source.expires_at>clock_timestamp()
      and parent_private.utility_protected_origin_allowed(source)
      and (source.request_version<>p_version or source.snapshot_id<>p_snapshot or source.snapshot_hash<>p_hash)
      and not exists(select 1 from parent_private.utility_protected_authorizations current_source join parent_private.utility_protected_inputs current_input on current_input.input_id=current_source.input_id and current_input.state='stored'
        where current_source.request_id=p_request and current_source.owner_id=source.owner_id and current_source.program_id=p_program and current_source.request_version=p_version
          and current_source.snapshot_id=p_snapshot and current_source.snapshot_hash=p_hash and current_source.revoked_at is null and current_source.expires_at>clock_timestamp()
          and coalesce(current_source.consent_evidence->>'originAuthorizationId',current_source.id::text)=coalesce(source.consent_evidence->>'originAuthorizationId',source.id::text))
      and not(source.program_id='pgw-crp' and source.purpose='required_identifier' and exists(
        select 1 from parent_private.utility_protected_authorizations current_identifier join parent_private.utility_protected_inputs captured on captured.input_id=current_identifier.input_id and captured.state='stored'
        where current_identifier.request_id=p_request and current_identifier.owner_id=source.owner_id and current_identifier.program_id=p_program
          and current_identifier.request_version=p_version and current_identifier.snapshot_id=p_snapshot and current_identifier.snapshot_hash=p_hash
          and current_identifier.purpose='required_identifier' and current_identifier.targets=source.targets and current_identifier.revoked_at is null and current_identifier.expires_at>clock_timestamp()))
    order by coalesce(source.consent_evidence->>'originAuthorizationId',source.id::text),source.created_at desc,source.input_id desc limit 256 loop
    begin perform parent_private.utility_protected_targets(c,a.purpose,a.targets,a.media_type,a.byte_length);
    exception when insufficient_privilege or check_violation then continue; end;
    execute format('select to_jsonb(s) from public.%I s where id=$1 and request_id=$2',table_name) into old_source using a.snapshot_id,p_request;
    if old_source is null or (p_program in ('peco-cap','pgw-crp') and old_source#>'{details,accountNumber}' is distinct from c#>'{snapshot,details,accountNumber}')
      or (p_program='pwd-tap' and old_source#>'{details,propertyAddress}' is distinct from c#>'{snapshot,details,propertyAddress}') then continue; end if;
    if p_program='pwd-tap' and a.purpose in ('income_proof','residency_proof') then
      select min(b.account_reference::text)::uuid into account_ref from parent_private.utility_protected_account_bindings b
        join parent_private.utility_protected_accounts account on account.id=b.account_reference join parent_private.utility_protected_authorizations source on source.input_id=b.input_id
        where source.request_id=p_request and source.request_version=p_version and source.snapshot_id=p_snapshot and source.purpose='account_access'
          and source.revoked_at is null and source.expires_at>clock_timestamp() and account.expires_at>clock_timestamp() having count(distinct b.account_reference)=1;
      if account_ref is null or account_ref is distinct from a.account_reference then continue; end if;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('reference',parent_private.utility_protected_reference(a),'originAuthorizationId',coalesce(a.consent_evidence->>'originAuthorizationId',a.id::text)));
  end loop;
  return result;
end $$;
revoke execute on function parent_private.parent_get_utility_reuse_candidates(uuid,uuid,uuid,integer,text,uuid,integer,text) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_get_utility_reuse_candidates(uuid,uuid,uuid,integer,text,uuid,integer,text) to parent_utility_protected;

-- Bind the input to this job before any original key or validation projection is returned.
create function parent_private.parent_check_utility_input_job(p_job uuid,p_lease uuid,p_request uuid,p_version integer,p_input uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform parent_private.parent_check_utility_reuse_job(p_job,p_lease,p_request,p_version);
  if not exists(select 1 from parent_private.utility_protected_authorizations a where a.input_id=p_input and a.request_id=p_request and a.request_version=p_version) then
    raise exception 'utility input job scope changed' using errcode='42501'; end if;
end $$;
create function parent_private.parent_begin_utility_protected_rebind_for_job(p_job uuid,p_lease uuid,p_input uuid,p_target uuid,p_version integer,p_snapshot uuid,p_revision integer,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare source parent_private.utility_protected_authorizations; result jsonb;
begin
  select * into source from parent_private.utility_protected_authorizations where input_id=p_input;
  if not found then raise exception 'utility reuse source unavailable' using errcode='42501'; end if;
  perform parent_private.parent_check_utility_reuse_job(p_job,p_lease,source.request_id,p_version);
  result:=parent_private.parent_begin_utility_protected_rebind(p_input,p_target,p_version,p_snapshot,p_revision,p_hash);
  perform parent_private.parent_check_utility_reuse_job(p_job,p_lease,source.request_id,p_version);
  return result;
end $$;
revoke execute on function parent_private.parent_check_utility_input_job(uuid,uuid,uuid,integer,uuid),parent_private.parent_begin_utility_protected_rebind_for_job(uuid,uuid,uuid,uuid,integer,uuid,integer,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_check_utility_input_job(uuid,uuid,uuid,integer,uuid),parent_private.parent_begin_utility_protected_rebind_for_job(uuid,uuid,uuid,uuid,integer,uuid,integer,text) to parent_utility_protected;
