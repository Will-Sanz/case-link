-- Claim the eligible public subpath under the same lease; private benefit authority is unchanged.
create or replace function parent_private.public_food_access_claimable(r public.parent_requests) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(r.intake->'needs' ? 'food_now' and jsonb_array_length(r.intake->'needs')<=2
    and jsonb_array_length(r.intake->'needs')=(select count(distinct need) from jsonb_array_elements_text(r.intake->'needs') n(need))
    and r.intake->'needs' <@ '["food_now","snap_new","snap_renewal","snap_pending","snap_problem"]'::jsonb
    and r.mandate->'recipientIds' ? 'share-community-fridge-19129'
    and r.mandate->'allowedActions' ? 'prepare' and r.mandate->'allowedData' ? 'household',false);
$$;

-- A parked benefit wait consumes no claim or model reservation until its actual prerequisites return.
create function parent_private.mixed_food_snap_planning_ready(r public.parent_requests) returns boolean
language plpgsql stable set search_path='' as $$
declare owner_id uuid; controls parent_private.processing_controls; binding jsonb;
begin
  if not parent_private.public_food_access_claimable(r) or jsonb_array_length(r.intake->'needs')<>2
    or not parent_private.current_grant(r.id,r.version)
    or not exists(select 1 from jsonb_array_elements_text(r.intake->'needs') n(need)
      cross join jsonb_array_elements_text(r.mandate->'recipientIds') p(program)
      where n.need<>'food_now' and parent_private.program_supports_need(p.program,n.need))
    or not exists(select 1 from parent_private.worker_health h where h.singleton and h.planning_ready
      and h.expires_at>now() and h.public_food_ready_until>now()) then return false; end if;
  select h.owner_id into owner_id from public.parent_households h where h.id=r.household_id;
  if (select count(*) from parent_private.ai_calls where request_id=r.id)>=12
    or (select count(*) from parent_private.ai_calls where account_id=owner_id and created_at>now()-interval '24 hours')
      +(select count(*) from parent_private.assistant_calls where account_id=owner_id and created_at>now()-interval '24 hours')>=60 then return false; end if;
  select * into controls from parent_private.processing_controls where singleton;
  if controls.model_budget_started_at>now() or (controls.model_call_limit is not null and greatest(
    (select count(*) from parent_private.model_call_reservations where created_at>=controls.model_budget_started_at),
    (select count(*) from parent_private.ai_calls where created_at>=controls.model_budget_started_at)
      +(select count(*) from parent_private.assistant_calls where created_at>=controls.model_budget_started_at))>=controls.model_call_limit) then return false; end if;
  if r.intake->'needs' ? 'snap_new' and exists(select 1 from public.parent_snap_application_details where request_id=r.id) then
    if not parent_private.snap_details_collection_enabled() then return false; end if;
    binding:=parent_private.snap_application_binding(r.id,r.version);
    return exists(select 1 from parent_private.form_templates t where t.id='pa-snap-pa600fs-sg-2019-preview'
      and t.version='application-preview-2026-11-03.v1' and t.program_id='snap-pa' and t.needs=array['snap_new'] and t.active and t.preparation_only
      and t.field_map='{}'::jsonb and t.required_fields='{}'::text[] and t.personal_fields='{}'::text[] and t.required_acts='{}'::text[]
      and t.content_sha256=binding#>>'{snapshot,source,templateSha256}' and t.verified_until>now() and t.verified_until<='2026-12-03T05:00:00Z'::timestamptz);
  end if;
  return true;
exception when insufficient_privilege or check_violation then return false;
end $$;
revoke execute on function parent_private.mixed_food_snap_planning_ready(public.parent_requests)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

-- Exact protected work resumes without a model; an unknown attempt can only be reconciled, never resent.
create function parent_private.mixed_food_snap_continuation_ready(r public.parent_requests) returns boolean
language plpgsql volatile set search_path='' as $$
declare operation public.parent_operations; capability jsonb;
begin
  if not parent_private.public_food_access_claimable(r) or jsonb_array_length(r.intake->'needs')<>2
    or not(r.intake->'needs' ? 'snap_new') or not parent_private.current_grant(r.id,r.version)
    or not(r.mandate->'recipientIds' ? 'snap-pa') then return false; end if;
  for operation in select o.* from public.parent_operations o where o.request_id=r.id and o.need='snap_new' and o.program_id='snap-pa' and o.action='submit'
    and o.artifact_id is null and cardinality(o.document_ids)=0
    and o.packet=jsonb_build_object('protectedSnapPacket',o.packet->'protectedSnapPacket') and jsonb_typeof(o.packet->'protectedSnapPacket')='object'
    and o.idempotency_key='snap-final:'||(o.packet#>>'{protectedSnapPacket,packetId}') and o.packet_hash=encode(sha256(convert_to(o.packet::text,'UTF8')),'hex')
  loop
    if operation.state='prepared' and operation.request_version=r.version and parent_private.snap_protected_packet_current(operation)
      and parent_private.snap_protected_parent_submit_ready(operation) and parent_private.personal_acts_complete(operation)
      and parent_private.snap_submission_authorized(operation.id) then return true; end if;
    if operation.state in ('executing','delivery_unknown') and r.mandate->'allowedActions' ? 'follow_up' then
      capability:=parent_private.parent_get_capability('snap-pa','follow_up');
      if capability->>'enabled'='true' and capability->'actions' ? 'follow_up'
        and length(btrim(coalesce(capability->>'permissionReference','')))>0 and (capability->>'permissionExpiresAt')::timestamptz>now()
        and capability->'dataCategories' ? 'household' then return true; end if;
    end if;
  end loop;
  return false;
end $$;
revoke execute on function parent_private.mixed_food_snap_continuation_ready(public.parent_requests)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

-- Factual completion uses the existing all-needs proof and closure; it never creates another work attempt.
create function parent_private.finish_received_food_snap_request(p_request uuid) returns void
language plpgsql set search_path='' as $$
declare request public.parent_requests;
begin
  select * into request from public.parent_requests where id=p_request for update;
  if not found or not parent_private.public_food_access_claimable(request) or jsonb_array_length(request.intake->'needs')<>2
    or not parent_private.current_grant(request.id,request.version) then return; end if;
  if not exists(select 1 from jsonb_array_elements_text(request.intake->'needs') n(need) where not (
    parent_private.parent_reported_support_received(request.id,n.need)
    or exists(select 1 from public.parent_operations o where o.request_id=request.id and o.need=n.need
      and parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.state='support_received'
      and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')))) then
    perform parent_private.close_request(request.id,'completed','Every requested need has an attributed report of support received.',
      'parent','Start a new request whenever support is needed again.','caselink');
  end if;
end $$;
revoke execute on function parent_private.finish_received_food_snap_request(uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

do $migration$
declare definition text; target record;
begin
  for target in select * from (values
    ('parent_private.parent_claim_job(integer,boolean,boolean,boolean)',
      $old$where ((j.state in ('queued','waiting') and j.run_at<=now()) or (j.state='leased' and j.lease_until<now()))$old$,
      $new$where ((j.state in ('queued','waiting') and j.run_at<=now()) or (j.state='leased' and j.lease_until<now())
        or (j.state='waiting' and not isfinite(j.run_at) and (
          (not p_continuation_only and exists(select 1 from jsonb_array_elements(r.required_actions) a where a->>'field'='benefit_service_wait')
            and parent_private.mixed_food_snap_planning_ready(r))
          or (p_snap_continuation and exists(select 1 from jsonb_array_elements(r.required_actions) a where a->>'field'='protected_snap_service_wait')
            and parent_private.mixed_food_snap_continuation_ready(r)))))$new$),
    ('parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,text,text)',
      $old$v_actor:=case when p_next_actor='operator'$old$,
      $new$if v_job.attempts>=48 and exists(select 1 from public.parent_requests r where r.id=v_job.request_id
        and parent_private.public_food_access_claimable(r) and jsonb_array_length(r.intake->'needs')=2) then
        p_next_run_at:=null;p_next_actor:=case when p_next_actor='parent' then 'parent' else 'operator' end;
        p_next_trigger:=case when p_next_actor='parent' then 'parent_action_completed' else 'route_review_required' end;
      end if;
      v_actor:=case when p_next_actor='operator'$new$),
    ('public.parent_report_food_visit(uuid,integer,text,text,uuid,text)',
      $old$if factual_correction then$old$,
      $new$perform parent_private.finish_received_food_snap_request(p_request_id);
      if factual_correction or exists(select 1 from public.parent_requests r where r.id=p_request_id and r.status='closed') then$new$),
    ('public.parent_report_outcome(uuid,text,text,text)',
      $old$if p_need is null or not exists($old$,
      $new$perform 1 from public.parent_requests r where r.id=p_request_id for update;
      if p_need is null or not exists($new$),
    ('public.parent_report_outcome(uuid,text,text,text)',
      $old$return v_id;$old$,
      $new$perform parent_private.finish_received_food_snap_request(p_request_id);
      return v_id;$new$),
    ('parent_private.request_progress(uuid)',
      $old$v_state text; v_summary text; v_running boolean:=false; v_next timestamptz;$old$,
      $new$v_state text; v_summary text; v_running boolean:=false; v_next timestamptz; v_mixed boolean;$new$),
    ('parent_private.request_progress(uuid)',
      $old$if r.status='cancelled' then$old$,
      $new$v_mixed:=parent_private.public_food_access_claimable(r) and jsonb_array_length(r.intake->'needs')=2;
      if v_mixed and parent_private.parent_reported_support_received(r.id,'food_now')
        and exists(select 1 from jsonb_array_elements(r.required_actions) a where a->>'field' in ('benefit_service_wait','protected_snap_service_wait')) then
        v_running:=case when exists(select 1 from jsonb_array_elements(r.required_actions) a where a->>'field'='protected_snap_service_wait')
          then v_running and j.state='leased' and j.lease_until>now() else parent_private.mixed_food_snap_planning_ready(r) end;
      end if;
      if r.status='cancelled' then$new$),
    ('parent_private.request_progress(uuid)',
      $old$elsif not v_running then$old$,
      $new$elsif v_mixed and j.attempts>=48 and not(j.state='leased' and j.lease_until>now()) then
        if exists(select 1 from jsonb_array_elements(r.plan->'routes') route where route->>'need'='food_now'
          and route->>'state'='prepared' and route->>'nextActor'='parent') then
          v_state:='needs_parent';v_summary:='Your public food instructions remain available. Background work needs a CaseLink service check.';
        else v_state:='failed';v_summary:='The bounded background attempt limit was reached. Saved work and reports remain available; CaseLink needs to resolve the service issue.';end if;
      elsif v_mixed and exists(select 1 from jsonb_array_elements(r.required_actions) a where coalesce(a->>'resolver','parent')='parent' and a->>'resolved' is distinct from 'true') then
        v_state:='needs_parent';v_summary:='A step needs you. See the specific question or permission below; only affected work waits.';
      elsif not v_running then$new$),
    ('parent_private.request_progress(uuid)',
      $old$if v_running and j.state in ('queued','waiting') and isfinite(j.run_at)$old$,
      $new$if v_running and (not v_mixed or j.attempts<48) and j.state in ('queued','waiting') and isfinite(j.run_at)$new$),
    ('parent_private.request_progress(uuid)',
      $old$coalesce(v_running and j.state in ('queued','waiting','leased'),false)$old$,
      $new$coalesce(v_running and (not v_mixed or j.attempts<48 or j.state='leased' and j.lease_until>now()) and j.state in ('queued','waiting','leased'),false)$new$),
    ('parent_private.request_progress(uuid)',
      $old$case when r.next_actor='service_operator' and parent_private.public_food_access_claimable(r) then$old$,
      $new$case when v_mixed and exists(select 1 from jsonb_array_elements(r.required_actions) a where a->>'field' in ('benefit_service_wait','protected_snap_service_wait')) then
        'Public food work and recorded SNAP evidence are saved. SNAP is waiting for an available authorized service; no automatic check is scheduled.'
        when r.next_actor='service_operator' and parent_private.public_food_access_claimable(r) then$new$)
  ) as reviewed(signature,needle,replacement)
  loop
    definition:=pg_get_functiondef(to_regprocedure(target.signature));
    if definition is null or (length(definition)-length(replace(definition,target.needle,'')))/length(target.needle)<>1 then
      raise exception 'mixed food continuation definition changed'; end if;
    execute replace(definition,target.needle,target.replacement);
  end loop;
end $migration$;
