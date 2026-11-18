-- Preparation only. The private policy/renderer remains closed unless separately approved.
-- This candidate check never returns a private answer or grants execution; the leased private target rechecks authority.
create function parent_private.utility_preparation_claimable(r public.parent_requests) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare program text; need text; provider text; table_name text; gate_name text; snapshot jsonb; gate boolean;
begin
  if jsonb_array_length(r.intake->'needs')<>1 or jsonb_array_length(r.mandate->'recipientIds')<>1 then return false; end if;
  program:=r.mandate#>>'{recipientIds,0}';
  if not parent_private.utility_preparation_scope_allowed(r.mandate,program) or not coalesce(r.intake->>'accountAuthority' in ('self','authorized_caregiver'),false)
    or not exists(select 1 from parent_private.utility_protected_policies p where p.program_id=program and p.enabled
      and length(btrim(coalesce(p.approval_reference,'')))>0 and p.approved_until>clock_timestamp()
      and p.policy_version is not null and p.retention_policy_version is not null and p.max_retention_seconds is not null and cardinality(p.preparation_versions)>0) then return false; end if;
  if program='peco-cap' then need:='electricity'; provider:='peco'; table_name:='parent_peco_application_details'; gate_name:='peco_details_collection_enabled';
  elsif program='pgw-crp' then need:='gas'; provider:='pgw'; table_name:='parent_pgw_application_details'; gate_name:='pgw_details_collection_enabled';
  elsif program='pwd-tap' then need:='water'; provider:='pwd'; table_name:='parent_water_application_details'; gate_name:='water_details_collection_enabled';
  else return false; end if;
  if r.intake->'needs' is distinct from to_jsonb(array[need]) or r.intake->'utilityProviders' is distinct from to_jsonb(array[provider]) then return false; end if;
  execute format('select parent_private.%I()',gate_name) into gate;
  if gate is distinct from true then return false; end if;
  execute format('select to_jsonb(s) from public.%I s where request_id=$1 order by revision desc limit 1',table_name) into snapshot using r.id;
  return snapshot is not null and coalesce((snapshot#>>'{source,verifiedUntil}')::timestamptz>clock_timestamp(),false)
    and snapshot#>'{consent_evidence,subjectAuthorityDeclared}'='true'::jsonb and snapshot#>'{consent_evidence,accountAuthorityDeclared}'='true'::jsonb;
exception when undefined_table or undefined_function then return false;
end $$;
revoke execute on function parent_private.utility_preparation_claimable(public.parent_requests)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_utility_protected;

create or replace function parent_private.parent_claim_job(p_lease_seconds integer,p_continuation_only boolean,p_snap_continuation boolean,p_utility_preparation boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_token uuid:=gen_random_uuid(); v_request jsonb; v_request_id uuid;
begin
  if p_continuation_only is null or p_snap_continuation is null or p_utility_preparation is null then raise exception 'invalid continuation mode' using errcode='23514'; end if;
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'invalid lease duration' using errcode='23514'; end if;
  select r.id into v_request_id from public.parent_requests r join public.parent_jobs j on j.request_id=r.id
    where ((j.state in ('queued','waiting') and j.run_at<=now()) or (j.state='leased' and j.lease_until<now()))
      and j.attempts<48 and parent_private.current_grant(r.id,j.request_version)
      and (not p_continuation_only or (p_utility_preparation and parent_private.utility_preparation_claimable(r)) or (p_snap_continuation and r.intake->'needs' ? 'snap_new' and exists(select 1 from public.parent_operations o
        where o.request_id=r.id and o.need='snap_new' and o.program_id='snap-pa' and o.action='submit'
          and o.artifact_id is null and cardinality(o.document_ids)=0
          and o.packet=jsonb_build_object('protectedSnapPacket',o.packet->'protectedSnapPacket')
          and jsonb_typeof(o.packet->'protectedSnapPacket')='object'
          and o.idempotency_key='snap-final:'||(o.packet#>>'{protectedSnapPacket,packetId}')
          and o.packet_hash=encode(sha256(convert_to(o.packet::text,'UTF8')),'hex')
          and (o.state in ('executing','delivery_unknown') or (o.state='prepared' and o.request_version=j.request_version
            and parent_private.snap_protected_packet_current(o) and parent_private.snap_protected_parent_submit_ready(o)
            and parent_private.personal_acts_complete(o) and parent_private.snap_submission_authorized(o.id))))))
    order by j.run_at for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_job from public.parent_jobs where request_id=v_request_id for update;
  if not parent_private.current_grant(v_request_id,v_job.request_version) then return null; end if;
  -- Lock order is request, job, operation for claims, cancellation and dispatch alike.
  update public.parent_operations set state='delivery_unknown',updated_at=now()
    where request_id=v_request_id and state='executing';
  update public.parent_jobs set state='leased',lease_token=v_token,lease_until=now()+make_interval(secs=>p_lease_seconds),lease_started_at=now(),attempts=attempts+1,updated_at=now() where id=v_job.id;
  select (to_jsonb(r)-'mandate_revoked_at'-'start_key')||jsonb_build_object(
    'has_peco_application_details',exists(select 1 from public.parent_peco_application_details s where s.request_id=r.id),
    'has_pgw_application_details',exists(select 1 from public.parent_pgw_application_details s where s.request_id=r.id),
    'has_water_application_details',exists(select 1 from public.parent_water_application_details s where s.request_id=r.id))
    into v_request from public.parent_requests r where r.id=v_request_id;
  return jsonb_build_object('jobId',v_job.id,'leaseToken',v_token,'request',v_request,
    'documents',case when v_request->'has_peco_application_details'='true'::jsonb or v_request->'has_pgw_application_details'='true'::jsonb or v_request->'has_water_application_details'='true'::jsonb then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('object_path',case when d.status='raw_deleted' or d.expires_at<=now() then null else d.object_path end,'raw_available',d.status in ('uploaded','processing','validated') and d.expires_at>now())),'[]') from public.parent_documents d where d.request_id=v_request_id and d.upload_confirmed_at is not null and d.status not in ('deleted','deletion_pending') and (d.expires_at>now() or (d.status in ('validated','raw_deleted') and d.facts_valid_until>now()))) end,
    'unknownOperations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.parent_operations o where o.request_id=v_request_id and o.state='delivery_unknown'));
end $$;

-- Existing SNAP-only callers keep their original two-argument selection semantics.
create or replace function parent_private.parent_claim_job(p_lease_seconds integer,p_continuation_only boolean) returns jsonb
language sql security definer set search_path='' as $$
  select parent_private.parent_claim_job(p_lease_seconds,p_continuation_only,true,false);
$$;
revoke execute on function parent_private.parent_claim_job(integer,boolean,boolean,boolean)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_claim_job(integer,boolean,boolean,boolean) to parent_worker;
