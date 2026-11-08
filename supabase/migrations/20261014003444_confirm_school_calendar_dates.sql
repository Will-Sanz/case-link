-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.mark_plan_reviewed(p_family_id uuid, p_plan_id uuid, p_expected_revision text);

CREATE OR REPLACE FUNCTION public.capture_case_progress_update (
  p_family_id   uuid,
  p_plan_id     uuid,
  p_occurred_on date,
  p_summary     text,
  p_request_id  uuid,
  p_changes     jsonb DEFAULT '[]'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_update_id uuid := p_request_id;
  v_request_hash text;
  v_existing public.case_progress_updates;
  v_change jsonb;
  v_action_id uuid;
  v_expected_updated_at timestamptz;
  v_action record;
  v_status text;
  v_target_date date;
  v_follow_up_date date;
  v_notes text;
  v_outcome text;
  v_previous jsonb;
  v_current jsonb;
  v_recorded_changes jsonb := '[]'::jsonb;
  v_step_ids uuid[] := '{}'::uuid[];
  v_step_id uuid;
begin
  if v_actor_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied';
  end if;
  if p_occurred_on is null or p_occurred_on > (clock_timestamp() at time zone 'America/New_York')::date then
    raise exception 'meeting date cannot be in the future';
  end if;
  if nullif(btrim(p_summary), '') is null or char_length(btrim(p_summary)) > 12000 then
    raise exception 'progress summary is invalid';
  end if;
  if jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) <> 'array' then
    raise exception 'plan changes must be an array';
  end if;
  if jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 25 or octet_length(p_changes::text) > 150000 then
    raise exception 'too many plan changes';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 0));
  if p_request_id is null then raise exception 'request id is required'; end if;
  v_request_hash := encode(extensions.digest(jsonb_build_object(
    'family',p_family_id,'plan',p_plan_id,'date',p_occurred_on,'summary',btrim(p_summary),'changes',coalesce(p_changes,'[]'::jsonb)
  )::text,'sha256'),'hex');
  select * into v_existing from public.case_progress_updates where id=p_request_id;
  if found then
    if v_existing.author_id is distinct from v_actor_id or v_existing.family_id is distinct from p_family_id
      or v_existing.plan_id is distinct from p_plan_id or v_existing.request_hash is distinct from v_request_hash then
      raise exception 'request id already used for a different update' using errcode='23514';
    end if;
    return v_existing.id;
  end if;

  if not exists (
    select 1
    from public.plans p
    where p.id = p_plan_id
      and p.family_id = p_family_id
      and p.id = (
        select latest.id
        from public.plans latest
        where latest.family_id = p_family_id
        order by latest.version desc
        limit 1
      )
  ) then
    raise exception 'current plan not found or access denied';
  end if;

  if public.contains_direct_identifier(p_summary) or public.contains_direct_identifier(p_changes::text) then
    raise exception 'remove identifying text' using errcode = '23514';
  end if;
  perform s.id from public.plan_steps s where s.plan_id = p_plan_id and s.id in (
    select a.plan_step_id from public.plan_step_action_items a join jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
      on a.id = (c->>'action_item_id')::uuid
  ) order by s.id for update;
  perform a.id from public.plan_step_action_items a join public.plan_steps s on s.id=a.plan_step_id
    join jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c on a.id=(c->>'action_item_id')::uuid
    where s.plan_id=p_plan_id order by a.id for update of a;
  for v_change in
    select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb))
  loop
    begin
      v_action_id := (v_change ->> 'action_item_id')::uuid;
      v_expected_updated_at := (v_change ->> 'expected_updated_at')::timestamptz;
    exception when others then
      raise exception 'plan change identifiers are invalid';
    end;

    select
      ai.id,
      ai.plan_step_id,
      ai.title,
      ai.status,
      ai.target_date,
      ai.follow_up_date,
      ai.notes,
      ai.outcome,
      ai.updated_at
    into v_action
    from public.plan_step_action_items ai
    join public.plan_steps ps on ps.id = ai.plan_step_id
    where ai.id = v_action_id and ps.plan_id = p_plan_id
    for update of ai;

    if not found then
      raise exception 'plan action not found';
    end if;
    if v_expected_updated_at is null or v_action.updated_at <> v_expected_updated_at then
      raise exception 'plan action changed in another tab';
    end if;

    v_status := nullif(v_change ->> 'status', '');
    if v_status is null or v_status not in ('pending', 'in_progress', 'completed', 'blocked') then
      raise exception 'plan action status is invalid';
    end if;

    begin
      v_target_date := case
        when v_change ? 'target_date' then nullif(v_change ->> 'target_date', '')::date
        else v_action.target_date
      end;
      v_follow_up_date := case
        when v_change ? 'follow_up_date' then nullif(v_change ->> 'follow_up_date', '')::date
        else v_action.follow_up_date
      end;
    exception when others then
      raise exception 'plan action date is invalid';
    end;

    v_notes := case
      when v_change ? 'notes' then nullif(btrim(v_change ->> 'notes'), '')
      else v_action.notes
    end;
    v_outcome := case
      when v_change ? 'outcome' then nullif(btrim(v_change ->> 'outcome'), '')
      else v_action.outcome
    end;

    if char_length(coalesce(v_notes, '')) > 2000 or char_length(coalesce(v_outcome, '')) > 2000 then
      raise exception 'plan action note is too long';
    end if;
    if v_status <> 'completed' and v_target_date is null then
      raise exception 'open plan actions need a target date';
    end if;
    if v_status <> 'completed' then
      v_notes := nullif(btrim(replace(v_notes,'[[caselink:resolution=no_longer_needed]]','')),'');
    end if;
    if v_status = 'blocked' and (v_follow_up_date is null or nullif(btrim(coalesce(v_notes, '')), '') is null) then
      raise exception 'waiting actions need a reason and follow-up date';
    end if;

    v_previous := jsonb_build_object(
      'status', v_action.status,
      'target_date', v_action.target_date,
      'follow_up_date', v_action.follow_up_date,
      'notes', v_action.notes,
      'outcome', v_action.outcome
    );

    update public.plan_step_action_items
    set
      status = v_status,
      target_date = v_target_date,
      follow_up_date = v_follow_up_date,
      notes = v_notes,
      outcome = v_outcome
    where id = v_action_id;

    v_current := jsonb_build_object(
      'status', v_status,
      'target_date', v_target_date,
      'follow_up_date', v_follow_up_date,
      'notes', v_notes,
      'outcome', v_outcome
    );
    v_recorded_changes := v_recorded_changes || jsonb_build_array(
      jsonb_build_object(
        'action_item_id', v_action_id,
        'plan_step_id', v_action.plan_step_id,
        'title', v_action.title,
        'previous', v_previous,
        'current', v_current
      )
    );
    v_step_ids := array_append(v_step_ids, v_action.plan_step_id);

    insert into public.plan_step_activity (
      plan_step_id,
      family_id,
      actor_user_id,
      action,
      activity_type,
      notes,
      details
    ) values (
      v_action.plan_step_id,
      p_family_id,
      v_actor_id,
      'progress.updated',
      'meeting',
      null,
      jsonb_build_object(
        'progress_update_id', v_update_id,
        'action_item_id', v_action_id,
        'previous', v_previous,
        'current', v_current
      )
    );
  end loop;

  -- Keep parent step state aligned with its dated actions.
  for v_step_id in select distinct unnest(v_step_ids)
  loop
    if not exists (
      select 1 from public.plan_step_action_items ai
      where ai.plan_step_id = v_step_id and ai.status <> 'completed'
    ) then
      update public.plan_steps
      set status = 'completed'
      where id = v_step_id and status not in ('completed', 'blocked');
    elsif exists (
      select 1 from public.plan_steps ps
      where ps.id = v_step_id and ps.status = 'completed'
    ) then
      update public.plan_steps set status = 'in_progress' where id = v_step_id;
    end if;
  end loop;

  insert into public.case_progress_updates (
    id,
    family_id,
    plan_id,
    author_id,
    occurred_on,
    summary,
    plan_changes,
    request_hash
  ) values (
    v_update_id,
    p_family_id,
    p_plan_id,
    v_actor_id,
    p_occurred_on,
    btrim(p_summary),
    v_recorded_changes,
    v_request_hash
  );

  update public.families set updated_at = now() where id = p_family_id;

  insert into public.activity_log (
    family_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details,
    source
  ) values (
    p_family_id,
    v_actor_id,
    'progress.captured',
    'case_progress_update',
    v_update_id::text,
    jsonb_build_object(
      'occurred_on', p_occurred_on,
      'plan_id', p_plan_id,
      'changed_action_count', jsonb_array_length(v_recorded_changes)
    ),
    'database'
  );

  return v_update_id;
end;
$function$;

CREATE FUNCTION public.mark_plan_reviewed (
  p_family_id         uuid,
  p_plan_id           uuid,
  p_expected_revision text,
  p_dates_confirmed   boolean DEFAULT false
)
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_reviewed_at timestamptz := clock_timestamp();
  v_plan jsonb;
begin
  if p_dates_confirmed is distinct from true then
    raise exception 'confirm action dates before reviewing the plan' using errcode = '23514';
  end if;
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 0));
  perform 1 from public.plans where id = p_plan_id and family_id = p_family_id for update;
  perform 1 from public.families where id = p_family_id for update;
  v_plan := public.get_family_plan_snapshot(p_family_id)->'plan';
  if v_plan is null or v_plan->>'id' is distinct from p_plan_id::text
    or p_expected_revision is null or v_plan->>'review_revision' is distinct from p_expected_revision then
    raise exception 'plan changed; reload and review the current version' using errcode = '40001';
  end if;
  if coalesce(v_plan->'generation_state'->>'status', 'complete') in ('running', 'failed') then
    raise exception 'plan is not reviewable' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.plan_step_action_items a join public.plan_steps s on s.id = a.plan_step_id where s.plan_id = p_plan_id
  ) or exists (
    select 1 from public.plan_steps s where s.plan_id = p_plan_id and (nullif(btrim(s.title), '') is null or nullif(btrim(s.details->>'expected_outcome'), '') is null)
  ) or exists (
    select 1 from public.plan_step_action_items a join public.plan_steps s on s.id = a.plan_step_id where s.plan_id = p_plan_id and (
      nullif(btrim(a.title), '') is null or (a.status <> 'completed' and a.target_date is null)
      or (a.status = 'blocked' and (nullif(btrim(a.notes), '') is null or a.follow_up_date is null))
    )
  ) then raise exception 'plan actions are incomplete' using errcode = '23514'; end if;
  update public.plans set client_display = coalesce(client_display, '{}'::jsonb) || jsonb_build_object(
    'reviewedAt', v_reviewed_at, 'reviewedById', v_actor, 'reviewedRevision', v_plan->>'material_revision'
  ) where id = p_plan_id;
  insert into public.activity_log (family_id, actor_user_id, action, entity_type, entity_id, details, source)
  values (p_family_id, v_actor, 'plan.reviewed', 'plan', p_plan_id::text,
    jsonb_build_object('reviewed_at', v_reviewed_at, 'review_revision', p_expected_revision, 'material_revision', v_plan->>'material_revision',
      'dates_confirmed', true, 'calendar_timezone', 'America/New_York',
      'confirmed_on', (v_reviewed_at at time zone 'America/New_York')::date,
      'past_open_actions', (select count(*) from public.plan_steps s join public.plan_step_action_items a on a.plan_step_id=s.id
        where s.plan_id=p_plan_id and a.status <> 'completed' and
          (case when a.status='blocked' then a.follow_up_date else a.target_date end) < (v_reviewed_at at time zone 'America/New_York')::date)), 'database');
  return v_reviewed_at;
end;
$function$;

REVOKE ALL ON FUNCTION public.mark_plan_reviewed(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.mark_plan_reviewed(uuid, uuid, text, boolean) TO authenticated;
