-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

DROP FUNCTION public.mark_plan_reviewed(p_family_id uuid, p_plan_id uuid);

CREATE FUNCTION public.get_family_plan_snapshot (
  p_family_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with snapshot as (
    select to_jsonb(f) as family,
      coalesce((select jsonb_agg(to_jsonb(b) order by b.sort_order, b.id)
        from public.family_barriers b where b.family_id = f.id), '[]'::jsonb) as barriers,
      (select to_jsonb(p) || jsonb_build_object('steps', coalesce((
        select jsonb_agg(to_jsonb(s) || jsonb_build_object('action_items', coalesce((
          select jsonb_agg(to_jsonb(a) order by a.sort_order, a.id)
          from public.plan_step_action_items a where a.plan_step_id = s.id
        ), '[]'::jsonb)) order by s.sort_order, s.id)
        from public.plan_steps s where s.plan_id = p.id
      ), '[]'::jsonb))
      from public.plans p where p.family_id = f.id order by p.version desc limit 1) as plan
    from public.families f where f.id = p_family_id and f.archived_at is null
  ), content as (
    select *, jsonb_build_object('name', family->'name', 'summary', family->'summary',
      'household_notes', family->'household_notes', 'barriers', barriers) as context,
      plan || jsonb_build_object('client_display', coalesce(nullif(plan->'client_display', 'null'::jsonb), '{}'::jsonb)
        - 'reviewedAt' - 'reviewedById' - 'reviewedRevision') as unreviewed_plan
    from snapshot
  ), revisions as (
    select *, jsonb_build_object('context', context, 'plan', unreviewed_plan) as exact_content,
      jsonb_build_object('context', context, 'plan', (unreviewed_plan - 'steps') || jsonb_build_object('steps', (
        select jsonb_agg((s - 'status' - 'workflow_data' - 'ai_helper_data' - 'updated_at' - 'action_items') ||
          jsonb_build_object('action_items', (select jsonb_agg(a - 'status' - 'outcome' - 'notes' - 'updated_at' order by ai)
            from jsonb_array_elements(s->'action_items') with ordinality items(a, ai))) order by si)
        from jsonb_array_elements(unreviewed_plan->'steps') with ordinality steps(s, si)
      ))) as material_content
    from content
  )
  select jsonb_build_object('family', family, 'barriers', barriers, 'plan', case when plan is null then null else plan || jsonb_build_object(
    'review_revision', encode(sha256(convert_to(exact_content::text, 'UTF8')), 'hex'),
    'material_revision', encode(sha256(convert_to(material_content::text, 'UTF8')), 'hex')
  ) end) from revisions;
$function$;

REVOKE ALL ON FUNCTION public.get_family_plan_snapshot(uuid) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.get_family_plan_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.invalidate_plan_review_on_child_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_plan_id uuid;
  v_material boolean := true;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new); v_old := to_jsonb(old);
    if tg_table_name = 'plan_steps' then
      v_material := (v_new - 'status' - 'workflow_data' - 'ai_helper_data' - 'updated_at')
        is distinct from (v_old - 'status' - 'workflow_data' - 'ai_helper_data' - 'updated_at');
    else
      v_material := (v_new - 'status' - 'outcome' - 'notes' - 'updated_at')
        is distinct from (v_old - 'status' - 'outcome' - 'notes' - 'updated_at');
    end if;
  end if;
  if tg_table_name = 'plan_steps' then
    v_plan_id := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  else
    select plan_id into v_plan_id from public.plan_steps
      where id = case when tg_op = 'DELETE' then old.plan_step_id else new.plan_step_id end;
  end if;
  update public.plans set client_display = case when v_material
    then coalesce(client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById' - 'reviewedRevision'
    else client_display end where id = v_plan_id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE FUNCTION public.is_reviewed_plan_revision (
  p_family_id         uuid,
  p_plan_id           uuid,
  p_expected_revision text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(p->>'id' = p_plan_id::text
    and p->>'review_revision' = p_expected_revision
    and p->'client_display'->>'reviewedRevision' = p->>'material_revision'
    and p->'client_display'->>'reviewedAt' is not null
    and p->'client_display'->>'reviewedById' is not null
    and coalesce(p->'generation_state'->>'status', 'complete') not in ('running', 'failed')
    and exists (select 1 from jsonb_array_elements(p->'steps') s, jsonb_array_elements(s->'action_items') a)
    and not exists (select 1 from jsonb_array_elements(p->'steps') s where nullif(btrim(s->>'title'), '') is null or nullif(btrim(s->'details'->>'expected_outcome'), '') is null)
    and not exists (select 1 from jsonb_array_elements(p->'steps') s, jsonb_array_elements(s->'action_items') a where
      nullif(btrim(a->>'title'), '') is null or (a->>'status' <> 'completed' and a->>'target_date' is null)
      or (a->>'status' = 'blocked' and (nullif(btrim(a->>'notes'), '') is null or a->>'follow_up_date' is null))), false)
  from (select public.get_family_plan_snapshot(p_family_id)->'plan' p) snapshot;
$function$;

REVOKE ALL ON FUNCTION public.is_reviewed_plan_revision(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.is_reviewed_plan_revision(uuid, uuid, text) TO authenticated;

CREATE FUNCTION public.mark_plan_reviewed (
  p_family_id         uuid,
  p_plan_id           uuid,
  p_expected_revision text
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
    jsonb_build_object('reviewed_at', v_reviewed_at, 'review_revision', p_expected_revision, 'material_revision', v_plan->>'material_revision'), 'database');
  return v_reviewed_at;
end;
$function$;

REVOKE ALL ON FUNCTION public.mark_plan_reviewed(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.mark_plan_reviewed(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_plan_identity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if current_user in ('postgres', 'service_role') then return new; end if;
  if new.family_id is distinct from old.family_id
    or new.version is distinct from old.version
    or new.generation_source is distinct from old.generation_source
    or new.ai_model is distinct from old.ai_model
    or new.generation_state is distinct from old.generation_state then
    raise exception 'plan identity is immutable' using errcode = '42501';
  end if;
  if (new.client_display ? 'reviewedAt' and new.client_display->'reviewedAt' is distinct from old.client_display->'reviewedAt')
    or (new.client_display ? 'reviewedById' and new.client_display->'reviewedById' is distinct from old.client_display->'reviewedById')
    or (new.client_display ? 'reviewedRevision' and new.client_display->'reviewedRevision' is distinct from old.client_display->'reviewedRevision') then
    raise exception 'plan review fields require the reviewed-plan function' using errcode = '42501';
  end if;
  if new.summary is distinct from old.summary
    or (coalesce(new.client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById' - 'reviewedRevision')
      is distinct from (coalesce(old.client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById' - 'reviewedRevision') then
    new.client_display := coalesce(new.client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById' - 'reviewedRevision';
  end if;
  return new;
end;
$function$;
