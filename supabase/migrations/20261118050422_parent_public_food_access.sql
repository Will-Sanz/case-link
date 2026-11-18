-- Public instructions only: this program grants no provider transport, allocation or reservation.
do $migration$
declare definition text; needle constant text := $old$'pwd-tap','philly-food']$old$;
begin
  definition:=pg_get_functiondef('parent_private.validate_mandate(jsonb)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'parent mandate program list changed'; end if;
  execute replace(definition,needle,$new$'pwd-tap','philly-food','share-community-fridge-19129']$new$);
end $migration$;

create or replace function parent_private.program_supports_need(p_program text,p_need text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce((p_need='food_now' and p_program in ('philly-food','share-community-fridge-19129'))
    or (p_need in ('snap_new','snap_renewal','snap_pending','snap_problem') and p_program in ('snap-pa','uesf-benefits'))
    or (p_need in ('wic_new','wic_continuing') and p_program in ('wic-pa','uesf-benefits'))
    or (p_need='electricity' and p_program in ('peco-cap','uesf-utilities'))
    or (p_need='gas' and p_program='pgw-crp') or (p_need='water' and p_program in ('pwd-tap','uesf-utilities')),false);
$$;

create function parent_private.uses_typed_food_path(r public.parent_requests) returns boolean
language sql stable set search_path='' as $$
  select coalesce(r.intake->'needs' ? 'food_now' and r.mandate->'recipientIds' ? 'share-community-fridge-19129'
    and coalesce((select route->>'programId'='share-community-fridge-19129' from jsonb_array_elements(r.plan->'routes') route where route->>'need'='food_now' limit 1),
      not(r.mandate->'recipientIds' ? 'philly-food') or parent_private.current_intake_fields(r.id,'food_now')->>'zip'='19129'),false);
$$;
revoke execute on function parent_private.uses_typed_food_path(public.parent_requests)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create function parent_private.public_food_access_claimable(r public.parent_requests) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(r.intake->'needs'='["food_now"]'::jsonb
    and r.mandate->'recipientIds' ? 'share-community-fridge-19129'
    and r.mandate->'allowedActions' ? 'prepare' and r.mandate->'allowedData' ? 'household',false);
$$;
revoke execute on function parent_private.public_food_access_claimable(public.parent_requests)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

-- Keep the existing lease/current-grant checks; permit this bounded preparation without a model or private port.
do $migration$
declare definition text; needle constant text := 'and (not p_continuation_only or ';
begin
  definition:=pg_get_functiondef('parent_private.parent_claim_job(integer,boolean,boolean,boolean)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'parent continuation claim changed'; end if;
  execute replace(definition,needle,needle||'parent_private.public_food_access_claimable(r) or ');
end $migration$;

-- A corrected typed food report supersedes its earlier projection, never its immutable history or a provider receipt.
create function parent_private.current_food_access_report(p_request_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select e.evidence->'foodAccessReport' from public.parent_events e join public.parent_requests r on r.id=e.request_id
    where e.request_id=p_request_id and r.intake->'needs' ? 'food_now' and e.kind='parent.outcome_reported' and e.actor='parent'
      and parent_private.current_account_evidence(e.request_id,'food_now',e.created_at)
      and e.evidence->>'need'='food_now' and e.evidence->>'attribution'='parent_reported'
      and e.evidence#>>'{foodAccessReport,requestId}'=p_request_id::text and e.evidence#>>'{foodAccessReport,need}'='food_now'
      and e.evidence#>>'{foodAccessReport,programId}'='share-community-fridge-19129'
      and e.evidence#>>'{foodAccessReport,siteId}'='share-hunting-park-fridge'
      and e.evidence#>>'{foodAccessReport,attribution}'='parent_reported'
      and pg_catalog.pg_input_is_valid(e.evidence#>>'{foodAccessReport,reportedAt}','timestamp with time zone')
    order by case when pg_catalog.pg_input_is_valid(e.evidence#>>'{foodAccessReport,reportedAt}','timestamp with time zone')
      then (e.evidence#>>'{foodAccessReport,reportedAt}')::timestamptz end desc,e.created_at desc,e.id desc limit 1;
$$;
create function parent_private.parent_reported_support_received(p_request_id uuid,p_need text) returns boolean
language sql stable set search_path='' as $$
  select coalesce(case when p_need='food_now' and parent_private.current_food_access_report(p_request_id) is not null
    then parent_private.current_food_access_report(p_request_id)->>'outcome'='support_received'
    when p_need='food_now' and exists(select 1 from public.parent_requests r where r.id=p_request_id and parent_private.uses_typed_food_path(r)) then false
    else exists(select 1 from public.parent_events e where e.request_id=p_request_id
    and parent_private.current_account_evidence(e.request_id,e.evidence->>'need',e.created_at)
    and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'need'=p_need
    and e.evidence->>'outcome'='support_received' and e.evidence->>'attribution'='parent_reported'
    and (p_need<>'food_now' or not(e.evidence ? 'foodAccessReport'))) end,false);
$$;
revoke execute on function parent_private.current_food_access_report(uuid),parent_private.parent_reported_support_received(uuid,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

-- All automatic and manual closure paths use the same current parent-report proof; provider proof stays unchanged.
do $migration$
declare definition text; target record;
begin
  for target in select * from (values
    ('parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,text,text)',
     $old$exists(select 1 from public.parent_events e where e.request_id=r.id and parent_private.current_account_evidence(e.request_id,e.evidence->>'need',e.created_at) and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'need'=n.need and e.evidence->>'outcome'='support_received' and e.evidence->>'attribution'='parent_reported')$old$,
     'parent_private.parent_reported_support_received(r.id,n.need)',2),
    ('parent_private.close_request(uuid,text,text,text,text,text)',
     $old$exists(select 1 from public.parent_events e where e.request_id=p_request_id and parent_private.current_account_evidence(e.request_id,e.evidence->>'need',e.created_at) and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'attribution'='parent_reported' and e.evidence->>'need'=v_need and e.evidence->>'outcome'='support_received')$old$,
     'parent_private.parent_reported_support_received(p_request_id,v_need)',1)
  ) as reviewed(signature,needle,replacement,expected_count)
  loop
    definition:=pg_get_functiondef(to_regprocedure(target.signature));
    if definition is null or (length(definition)-length(replace(definition,target.needle,'')))/length(target.needle)<>target.expected_count then
      raise exception 'parent food completion definition changed'; end if;
    execute replace(definition,target.needle,target.replacement);
  end loop;
end $migration$;

create function parent_private.parent_get_food_access_report(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.parent_jobs;
begin
  select * into job from public.parent_jobs where id=p_job_id;
  job:=parent_private.require_lease(p_job_id,p_lease_token,job.request_version);
  return parent_private.current_food_access_report(job.request_id);
end $$;
revoke execute on function parent_private.parent_get_food_access_report(uuid,uuid)
  from public,anon,authenticated,service_role,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.parent_get_food_access_report(uuid,uuid) to parent_worker;

-- Public preparation can run without model readiness. Expire the same heartbeat explicitly on shutdown.
alter table parent_private.worker_health add column public_food_ready_until timestamptz;
create function parent_private.parent_record_worker_health(p_planning_ready boolean,p_assistant_ready boolean,p_public_food_ready boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform parent_private.parent_record_worker_health(p_planning_ready,p_assistant_ready);
  update parent_private.worker_health set public_food_ready_until=case when coalesce(p_public_food_ready,false) then expires_at else null end where singleton;
  if not coalesce(p_planning_ready,false) and not coalesce(p_assistant_ready,false) and not coalesce(p_public_food_ready,false) then
    update parent_private.worker_health set expires_at=clock_timestamp() where singleton;
  end if;
end $$;
revoke execute on function parent_private.parent_record_worker_health(boolean,boolean,boolean)
  from public,anon,authenticated,service_role,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.parent_record_worker_health(boolean,boolean,boolean) to parent_worker;

do $migration$
declare definition text; target record;
begin
  definition:=pg_get_functiondef('parent_private.request_progress(uuid)'::regprocedure);
  for target in select * from (values
    ('h.planning_ready and h.expires_at>now()', '(case when parent_private.public_food_access_claimable(r) then coalesce(h.public_food_ready_until>now(),false) else h.planning_ready end) and h.expires_at>now()'),
    ($old$elsif exists(select 1 from jsonb_array_elements(r.required_actions)$old$,
     $new$elsif parent_private.public_food_access_claimable(r) and r.next_actor='parent' and exists(select 1 from jsonb_array_elements(r.plan->'routes') route where route->>'state'='prepared' and route#>>'{foodAccess,kind}'='public_food_access_plan') then
    v_state:='needs_parent';v_summary:='Your public food access plan is ready. Collect food if practical and tell CaseLink what happened; nothing is reserved.';
  elsif exists(select 1 from jsonb_array_elements(r.required_actions)$new$),
    ($old$case when r.next_actor='service_operator' then$old$,
     $new$case when r.next_actor='service_operator' and parent_private.public_food_access_claimable(r) then 'Your food need remains open. CaseLink needs to check a practical next access option.' when r.next_actor='service_operator' then$new$)
  ) as reviewed(needle,replacement)
  loop
    if (length(definition)-length(replace(definition,target.needle,'')))/length(target.needle)<>1 then raise exception 'parent public-food progress definition changed'; end if;
    definition:=replace(definition,target.needle,target.replacement);
  end loop;
  execute definition;
end $migration$;

create function public.parent_report_food_visit(p_request_id uuid,p_expected_version integer,p_site_id text,p_plan_hash text,p_report_key uuid,p_result text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request public.parent_requests; access jsonb; report jsonb; previous public.parent_events;
  write_hash text; event_id uuid:=gen_random_uuid(); outcome text; reported_at timestamptz; factual_correction boolean;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into request from public.parent_requests where id=p_request_id for update;
  if p_expected_version is null or p_expected_version<1 or p_site_id is distinct from 'share-hunting-park-fridge'
    or p_plan_hash is null or p_plan_hash!~'^[a-f0-9]{64}$' or p_report_key is null
    or p_result is null or p_result not in ('received_enough_food','some_food_still_needed','no_food','could_not_access','need_another_way') then
    raise exception 'invalid public food report' using errcode='23514'; end if;
  write_hash:=encode(sha256(convert_to(jsonb_build_array(p_expected_version,p_site_id,p_plan_hash,p_result)::text,'UTF8')),'hex');
  select * into previous from public.parent_events e where e.request_id=p_request_id and e.kind='parent.outcome_reported'
    and e.evidence->'foodAccessReport'->>'reportKey'=p_report_key::text order by e.created_at desc,e.id desc limit 1;
  if found then
    if previous.evidence->>'foodAccessWriteHash' is distinct from write_hash then raise exception 'food report changed; reload' using errcode='PT409'; end if;
    return previous.evidence->'foodAccessReport';
  end if;
  factual_correction:=coalesce(request.status='closed' and request.closed_reason='completed' and parent_private.current_food_access_report(p_request_id) is not null,false);
  if (not factual_correction and not parent_private.current_grant(p_request_id,request.version)) or not(request.intake->'needs' ? 'food_now')
    or not(request.mandate->'recipientIds' ? 'share-community-fridge-19129')
    or not(request.mandate->'allowedActions' ? 'prepare') or not(request.mandate->'allowedData' ? 'household') then
    raise exception 'public food report unavailable' using errcode='42501'; end if;
  select route->'foodAccess' into access from jsonb_array_elements(request.plan->'routes') route
    where route->>'need'='food_now' and route->>'programId'='share-community-fridge-19129';
  if request.version is distinct from p_expected_version or access is null
    or access->>'kind' is distinct from 'public_food_access_plan' or access->>'need' is distinct from 'food_now'
    or access->>'programId' is distinct from 'share-community-fridge-19129' or access->>'requestId' is distinct from p_request_id::text
    or access->>'requestVersion' is distinct from (p_expected_version-case when factual_correction then 1 else 0 end)::text or access->>'planHash' is distinct from p_plan_hash
    or access#>>'{site,id}' is distinct from p_site_id
    or access#>>'{source,version}' is distinct from 'share-hunting-park-fridge-2026-11-17'
    or access#>>'{source,cityRecordId}' is distinct from '122' then
    raise exception 'food plan changed; reload' using errcode='PT409'; end if;
  outcome:=case when p_result='received_enough_food' then 'support_received' else 'unresolved' end;
  reported_at:=clock_timestamp();
  report:=jsonb_build_object('eventId',event_id,'requestId',p_request_id,'expectedVersion',p_expected_version,
    'siteId',p_site_id,'planHash',p_plan_hash,'reportKey',p_report_key,'result',p_result,'need','food_now',
    'programId','share-community-fridge-19129','sourceVersion','share-hunting-park-fridge-2026-11-17',
    'reportedAt',reported_at,'attribution','parent_reported','outcome',outcome);
  insert into public.parent_events(id,request_id,kind,actor,summary,evidence)
    values(event_id,p_request_id,'parent.outcome_reported','parent','You reported what happened at Share Community Fridge.',
      jsonb_build_object('need','food_now','outcome',outcome,'attribution','parent_reported',
        'reference','Share Community Fridge, 2901 W Hunting Park Ave: '||replace(p_result,'_',' ')||'. This is a family report, not provider confirmation.',
        'foodAccessReport',report,'foodAccessWriteHash',write_hash));
  update public.parent_requests set plan=jsonb_set(plan,'{routes}',(select jsonb_agg(case when route->>'need'='food_now' and route->>'programId'='share-community-fridge-19129' then
      route||jsonb_build_object('foodAccessReport',report,'summary',case when factual_correction then 'You corrected your food report. This request remains closed; no future work has restarted.'
        when outcome='support_received' then 'You reported receiving enough food at Share Community Fridge. This is your report, not provider confirmation.'
        else 'You reported this food option did not meet the immediate need. Another usable option is not confirmed.' end,
        'steps',case when outcome='support_received' then '["Your report is recorded with family attribution; provider receipts stay separate."]'::jsonb
          else '["Your food need remains unmet. Current City listings are unconfirmed; use Help for direct options."]'::jsonb end,
        'state',case when exists(select 1 from public.parent_operations o where o.request_id=p_request_id and o.need='food_now'
          and parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.state='support_received'
          and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) then 'support_received' else outcome end)
      else route end) from jsonb_array_elements(plan->'routes') route)) where id=p_request_id;
  if factual_correction then
    return report;
  end if;
  update public.parent_jobs set state=case when state='waiting' then 'queued' else state end,
    run_at=case when state in ('waiting','queued') then now() else run_at end,
    receipt_wake_lease_token=case when state='leased' then lease_token else receipt_wake_lease_token end,updated_at=now()
    where request_id=p_request_id and state in ('queued','waiting','leased') and parent_private.current_grant(request_id,request_version);
  update public.parent_requests set next_actor='caselink',next_trigger='parent_action_completed',next_run_at=now(),updated_at=now() where id=p_request_id;
  return report;
end $$;
revoke execute on function public.parent_report_food_visit(uuid,integer,text,text,uuid,text)
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_report_food_visit(uuid,integer,text,text,uuid,text) to authenticated;

-- A current typed food path asks its site-specific question once; other needs and legacy reports keep their form.
do $migration$
declare definition text; needle constant text := 'insert into public.parent_events(request_id,kind,actor,summary,evidence)';
begin
  definition:=pg_get_functiondef('public.parent_report_outcome(uuid,text,text,text)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'parent generic outcome definition changed'; end if;
  execute replace(definition,needle,$guard$if p_need='food_now' and exists(select 1 from public.parent_requests r
    where r.id=p_request_id and parent_private.uses_typed_food_path(r)) then
    raise exception 'use the site-bound food report' using errcode='23514'; end if;
  insert into public.parent_events(request_id,kind,actor,summary,evidence)$guard$);
end $migration$;
