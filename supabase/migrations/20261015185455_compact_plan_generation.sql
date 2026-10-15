-- New jobs save one complete goal/date plan atomically. Jobs without the marker
-- retain their original 30/60/90 transitions. The existing lease, authorization,
-- latest-plan and contact-provenance checks remain in force.

CREATE OR REPLACE FUNCTION public.append_staged_plan_phase (
  p_family_id        uuid,
  p_plan_id          uuid,
  p_phase            text,
  p_steps            jsonb,
  p_generation_state jsonb,
  p_ai_model         text,
  p_duration_ms      integer,
  p_lease_id         uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_plan public.plans;
  v_step jsonb;
  v_step_id uuid;
  v_item jsonb;
  v_stage text;
  v_single boolean := coalesce(p_generation_state->>'generation_strategy', '') = 'single';
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if p_phase is null or p_phase not in ('30', '60', '90')
    or jsonb_typeof(p_steps) is distinct from 'array'
    or jsonb_array_length(p_steps) not between 1 and 5
    or jsonb_typeof(p_generation_state) is distinct from 'object'
    or p_generation_state->>'v' is distinct from '1'
    or (p_generation_state ? 'generation_strategy' and p_generation_state->>'generation_strategy' is distinct from 'single')
    or octet_length(p_generation_state::text) > 250000
    or public.contains_direct_identifier(p_generation_state::text)
    or p_duration_ms is null or p_duration_ms not between 0 and 600000
    or char_length(coalesce(p_ai_model, '')) not between 1 and 200 then
    raise exception 'invalid staged phase' using errcode = '23514';
  end if;
  if v_single then
    if p_phase <> '30'
      or p_generation_state->'pending_phase' is distinct from 'null'::jsonb
      or p_generation_state->>'status' is distinct from 'complete'
      or p_generation_state->'phases_complete' is distinct from '{"30":true,"60":false,"90":false}'::jsonb then
      raise exception 'invalid complete plan transition' using errcode = '23514';
    end if;
  elsif (p_phase = '30' and (
      p_generation_state->>'pending_phase' is distinct from '60'
      or p_generation_state->>'status' is distinct from 'running'
    )) or (p_phase = '60' and (
      p_generation_state->>'pending_phase' is distinct from '90'
      or p_generation_state->>'status' is distinct from 'running'
    )) or (p_phase = '90' and (
      p_generation_state->'pending_phase' is distinct from 'null'::jsonb
      or p_generation_state->>'status' is distinct from 'complete'
    )) then
    raise exception 'invalid phase transition' using errcode = '23514';
  end if;

  perform 1 from private.ai_job_claims where family_id=p_family_id
    and job_key='staged-plan-advance' and lease_id=p_lease_id and owner_user_id=v_actor
    and expires_at>clock_timestamp() for update;
  if not found then raise exception 'generation lease expired' using errcode='40001'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_plan_id::text, 0));
  select * into v_plan from public.plans
  where id = p_plan_id and family_id = p_family_id
    and id = (
      select latest.id from public.plans latest
      where latest.family_id = p_family_id order by latest.version desc limit 1
    );
  if v_plan.id is null
    or v_plan.generation_state->>'status' is distinct from 'running'
    or v_plan.generation_state->>'pending_phase' is distinct from p_phase
    or v_plan.generation_state->'generation_strategy' is distinct from p_generation_state->'generation_strategy'
    or v_plan.generation_state->'input_snapshot' is distinct from p_generation_state->'input_snapshot'
    or v_plan.generation_state->'completion_method' is distinct from p_generation_state->'completion_method' then
    raise exception 'staged plan phase is stale' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.plan_steps where plan_id = p_plan_id and phase = p_phase::public.plan_phase
  ) then
    return false;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    if v_step->>'phase' is distinct from p_phase
      or jsonb_typeof(coalesce(v_step->'action_items', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_step->'action_items', '[]'::jsonb)) not between 1 and (case when v_single then 3 else 20 end) then
      raise exception 'invalid staged step' using errcode = '23514';
    end if;
    insert into public.plan_steps (
      plan_id, phase, title, description, status, sort_order, details, priority
    ) values (
      p_plan_id,
      p_phase::public.plan_phase,
      v_step->>'title',
      v_step->>'description',
      'pending',
      (v_step->>'sort_order')::integer,
      v_step->'details',
      coalesce(nullif(v_step->>'priority', ''), 'medium')
    ) returning id into v_step_id;

    for v_item in select value from jsonb_array_elements(v_step->'action_items') loop
      if v_single and (
        nullif(v_item->>'target_date', '') is null
        or (v_item->>'target_date')::date < (v_plan.created_at at time zone 'America/New_York')::date
        or (v_item->>'target_date')::date > (v_plan.created_at at time zone 'America/New_York')::date + 90
      ) then
        raise exception 'complete plan action needs an in-window target date' using errcode = '23514';
      end if;
      insert into public.plan_step_action_items (
        plan_step_id, title, description, week_index, target_date, status, sort_order
      ) values (
        v_step_id,
        v_item->>'title',
        nullif(v_item->>'description', ''),
        (v_item->>'week_index')::integer,
        nullif(v_item->>'target_date', '')::date,
        'pending',
        (v_item->>'sort_order')::integer
      );
    end loop;
  end loop;

  update public.plans
  set generation_state = p_generation_state,
      ai_model = p_ai_model
  where id = p_plan_id;
  v_stage := case when v_single or p_phase = '90' then 'complete_plan' when p_phase = '30' then 'initial' else 'follow_up' end;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'plan.stage_generated', 'plan', p_plan_id::text,
    jsonb_build_object(
      'stage', v_stage,
      'steps', jsonb_array_length(p_steps),
      'duration_ms', p_duration_ms
    ), 'database'
  );
  if v_single or p_phase = '90' then
    insert into public.activity_log (
      family_id, actor_user_id, action, entity_type, entity_id, details, source
    ) values (
      p_family_id, v_actor, 'plan.generation_finished', 'plan', p_plan_id::text,
      jsonb_build_object('duration_ms', p_duration_ms), 'database'
    );
  end if;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.append_staged_plan_phase(uuid, uuid, text, jsonb, jsonb, text, integer, uuid) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.append_staged_plan_phase(uuid, uuid, text, jsonb, jsonb, text, integer, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_staged_plan_state (
  p_family_id        uuid,
  p_plan_id          uuid,
  p_generation_state jsonb,
  p_lease_id         uuid,
  p_ai_model         text  DEFAULT NULL::text,
  p_event            text  DEFAULT NULL::text,
  p_event_details    jsonb DEFAULT NULL::jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_updated integer;
  v_plan public.plans;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_generation_state) is distinct from 'object'
    or p_generation_state->>'v' is distinct from '1'
    or (p_generation_state ? 'generation_strategy' and p_generation_state->>'generation_strategy' is distinct from 'single')
    or coalesce(p_generation_state->>'status', '') not in ('running', 'failed', 'complete')
    or (p_generation_state->>'pending_phase' is not null and p_generation_state->>'pending_phase' not in ('30', '60', '90'))
    or octet_length(p_generation_state::text) > 250000
    or public.contains_direct_identifier(p_generation_state::text)
    or char_length(coalesce(p_ai_model, '')) > 200
    or (p_event is not null and p_event not in (
      'plan.generation_failed', 'plan.generation_finished', 'plan.generation_resumed'
    ))
    or (p_event = 'plan.generation_failed' and p_generation_state->>'status' <> 'failed')
    or (p_event = 'plan.generation_finished' and p_generation_state->>'status' <> 'complete')
    or (p_event = 'plan.generation_resumed' and p_generation_state->>'status' <> 'running')
    or octet_length(coalesce(p_event_details, '{}'::jsonb)::text) > 8000
    or public.contains_direct_identifier(coalesce(p_event_details, '{}'::jsonb)::text) then
    raise exception 'invalid staged plan state' using errcode = '23514';
  end if;
  if (p_generation_state->>'status' = 'complete' and p_generation_state->'pending_phase' is distinct from 'null'::jsonb)
    or (p_generation_state->>'status' = 'running' and p_generation_state->>'pending_phase' is null) then
    raise exception 'invalid staged plan transition' using errcode = '23514';
  end if;

  perform 1 from private.ai_job_claims where family_id=p_family_id
    and job_key='staged-plan-advance' and lease_id=p_lease_id and owner_user_id=v_actor
    and expires_at>clock_timestamp() for update;
  if not found then raise exception 'generation lease expired' using errcode='40001'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_plan_id::text, 0));
  select * into v_plan from public.plans where id = p_plan_id and family_id = p_family_id;
  if v_plan.id is null
    or v_plan.generation_state->'generation_strategy' is distinct from p_generation_state->'generation_strategy'
    or v_plan.generation_state->'input_snapshot' is distinct from p_generation_state->'input_snapshot'
    or v_plan.generation_state->'completion_method' is distinct from p_generation_state->'completion_method'
    or (v_plan.generation_state->>'status' = 'complete' and p_generation_state->>'status' is distinct from 'complete') then
    raise exception 'staged plan state is stale' using errcode = '40001';
  end if;
  -- A lost response may recover completion from saved rows, but cannot skip unsaved work.
  if p_generation_state->>'status' = 'complete' and (
    not exists (select 1 from public.plan_steps where plan_id = p_plan_id and phase = '30')
    or (coalesce(p_generation_state->>'generation_strategy', '') <> 'single' and (
      not exists (select 1 from public.plan_steps where plan_id = p_plan_id and phase = '60')
      or not exists (select 1 from public.plan_steps where plan_id = p_plan_id and phase = '90')
    ))
  ) then
    raise exception 'generation has unsaved work' using errcode = '23514';
  end if;
  update public.plans
  set generation_state = p_generation_state,
      ai_model = p_ai_model
  where id = p_plan_id
    and family_id = p_family_id
    and id = (
      select latest.id from public.plans latest
      where latest.family_id = p_family_id order by latest.version desc limit 1
    );
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'staged plan not found' using errcode = '40001';
  end if;
  if p_event is not null then
    insert into public.activity_log (
      family_id, actor_user_id, action, entity_type, entity_id, details, source
    ) values (
      p_family_id, v_actor, p_event, 'plan', p_plan_id::text, p_event_details, 'database'
    );
  end if;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.update_staged_plan_state(uuid, uuid, jsonb, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.update_staged_plan_state(uuid, uuid, jsonb, uuid, text, text, jsonb) TO authenticated;
