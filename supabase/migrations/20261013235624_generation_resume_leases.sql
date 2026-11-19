-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.append_staged_plan_phase(p_family_id uuid, p_plan_id uuid, p_phase text, p_steps jsonb, p_generation_state jsonb, p_ai_model text, p_duration_ms integer);

DROP FUNCTION public.claim_ai_job(p_family_id uuid, p_job_key text, p_ttl_seconds integer);

DROP FUNCTION public.release_ai_job(p_family_id uuid, p_job_key text);

DROP FUNCTION public.update_staged_plan_state(p_family_id uuid, p_plan_id uuid, p_generation_state jsonb, p_ai_model text, p_event text, p_event_details jsonb);

DROP POLICY app_users_select_family_peers ON public.app_users;

DROP POLICY app_users_select_self ON public.app_users;

ALTER TABLE private.ai_job_claims
  ADD COLUMN lease_id uuid DEFAULT gen_random_uuid() NOT NULL;

CREATE FUNCTION public.append_staged_plan_phase (
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
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if p_phase not in ('30', '60', '90')
    or jsonb_typeof(p_steps) <> 'array'
    or jsonb_array_length(p_steps) not between 1 and 5
    or jsonb_typeof(p_generation_state) <> 'object'
    or octet_length(p_generation_state::text) > 250000
    or public.contains_direct_identifier(p_generation_state::text)
    or p_duration_ms not between 0 and 600000
    or char_length(coalesce(p_ai_model, '')) not between 1 and 200 then
    raise exception 'invalid staged phase' using errcode = '23514';
  end if;
  if (p_phase = '30' and (
      p_generation_state->>'pending_phase' <> '60'
      or p_generation_state->>'status' <> 'running'
    )) or (p_phase = '60' and (
      p_generation_state->>'pending_phase' <> '90'
      or p_generation_state->>'status' <> 'running'
    )) or (p_phase = '90' and (
      p_generation_state->'pending_phase' is distinct from 'null'::jsonb
      or p_generation_state->>'status' <> 'complete'
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
  if v_plan.id is null or v_plan.generation_state->>'pending_phase' <> p_phase then
    raise exception 'staged plan phase is stale' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.plan_steps where plan_id = p_plan_id and phase = p_phase::public.plan_phase
  ) then
    return false;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    if v_step->>'phase' <> p_phase
      or jsonb_typeof(coalesce(v_step->'action_items', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_step->'action_items', '[]'::jsonb)) not between 1 and 20 then
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
  v_stage := case p_phase when '30' then 'initial' when '60' then 'follow_up' else 'complete_plan' end;
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
  if p_phase = '90' then
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

CREATE FUNCTION public.claim_ai_job (
  p_family_id   uuid,
  p_job_key     text,
  p_lease_id    uuid,
  p_ttl_seconds integer DEFAULT 600
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare v_user_id uuid := (select auth.uid()); v_claimed boolean;
begin
  if v_user_id is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if p_lease_id is null or nullif(btrim(p_job_key),'') is null or char_length(p_job_key)>120
    or p_ttl_seconds is null or p_ttl_seconds not between 30 and 600 then
    raise exception 'invalid AI job claim' using errcode = '23514';
  end if;
  insert into private.ai_job_claims (family_id,job_key,owner_user_id,expires_at,lease_id)
    values(p_family_id,p_job_key,v_user_id,clock_timestamp()+make_interval(secs=>p_ttl_seconds),p_lease_id)
  on conflict(family_id,job_key) do update set owner_user_id=excluded.owner_user_id,
    expires_at=excluded.expires_at,lease_id=excluded.lease_id,created_at=clock_timestamp()
    where private.ai_job_claims.expires_at<=clock_timestamp()
  returning true into v_claimed;
  return coalesce(v_claimed,false);
end; $function$;

REVOKE ALL ON FUNCTION public.claim_ai_job(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.claim_ai_job(uuid, text, uuid, integer) TO authenticated;

CREATE FUNCTION public.get_previous_reviewed_plan (
  p_family_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select to_jsonb(p) || jsonb_build_object('steps',coalesce((
    select jsonb_agg(to_jsonb(s) || jsonb_build_object('action_items',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.sort_order,a.id) from public.plan_step_action_items a where a.plan_step_id=s.id
    ),'[]'::jsonb)) order by s.sort_order,s.id) from public.plan_steps s where s.plan_id=p.id
  ),'[]'::jsonb)) from public.plans p where p.family_id=p_family_id
    and p.client_display->>'reviewedAt' is not null and p.client_display->>'reviewedRevision' is not null
    and coalesce(p.generation_state->>'status','complete')='complete'
    and exists(select 1 from public.plans newer where newer.family_id=p_family_id and newer.version>p.version)
  order by p.version desc limit 1;
$function$;

REVOKE ALL ON FUNCTION public.get_previous_reviewed_plan(uuid) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.get_previous_reviewed_plan(uuid) TO authenticated;

CREATE FUNCTION public.release_ai_job (
  p_family_id uuid,
  p_job_key   text,
  p_lease_id  uuid
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  delete from private.ai_job_claims where family_id=p_family_id and job_key=p_job_key
    and lease_id=p_lease_id and owner_user_id=(select auth.uid()) and public.is_active_app_user();
$function$;

REVOKE ALL ON FUNCTION public.release_ai_job(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.release_ai_job(uuid, text, uuid) TO authenticated;

CREATE FUNCTION public.update_staged_plan_state (
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
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_generation_state) <> 'object'
    or p_generation_state->>'v' <> '1'
    or p_generation_state->>'status' not in ('running', 'failed', 'complete')
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

CREATE POLICY app_users_select_visible ON public.app_users
  FOR SELECT
  TO authenticated
  USING (((id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.families f
  WHERE ((f.created_by_id = app_users.id) AND public.can_access_family(f.id)))) OR (EXISTS ( SELECT 1
   FROM public.family_case_managers m
  WHERE ((m.user_id = app_users.id) AND public.can_access_family(m.family_id)))) OR (EXISTS ( SELECT 1
   FROM public.case_notes cn
  WHERE ((cn.author_id = app_users.id) AND public.can_access_family(cn.family_id))))));
