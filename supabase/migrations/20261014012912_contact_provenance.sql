-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION private.enforce_plan_contact_provenance()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare v_family_id uuid;
begin
  -- Preserve historical contacts on unrelated edits; review/export independently require current sources.
  if tg_op='UPDATE' and new.details->'contacts' is not distinct from old.details->'contacts' then return new; end if;
  if new.details is null or not (new.details ? 'contacts') then return new; end if;
  select family_id into v_family_id from public.plans where id=new.plan_id;
  new.details := jsonb_set(new.details,'{contacts}',public.canonical_plan_contacts(v_family_id,new.details->'contacts'));
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.enforce_plan_contact_provenance() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.canonical_plan_contacts (
  p_family_id uuid,
  p_contacts  jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_contacts jsonb := coalesce(nullif(p_contacts,'null'::jsonb),'[]'::jsonb);
  v_contact jsonb; v_expected jsonb; v_resource public.resources; v_id uuid; v_stamp timestamptz;
  v_seen uuid[] := '{}'; v_result jsonb := '[]'; v_key text;
begin
  if current_user not in ('postgres','service_role') and not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode='42501';
  end if;
  if jsonb_typeof(v_contacts) <> 'array' or jsonb_array_length(v_contacts) > 12 then
    raise exception 'invalid directory contacts' using errcode='23514';
  end if;
  for v_contact in select value from jsonb_array_elements(v_contacts) loop
    if jsonb_typeof(v_contact) <> 'object' or not (v_contact ?& array['source_resource_id','source_updated_at']) then
      raise exception 'select contacts from the current resource directory' using errcode='23514';
    end if;
    if exists(select 1 from jsonb_object_keys(v_contact) k where k not in ('source_resource_id','source_updated_at','name','phone','email','notes')) then
      raise exception 'unsupported contact fields' using errcode='23514';
    end if;
    begin
      v_id := (v_contact->>'source_resource_id')::uuid;
      v_stamp := (v_contact->>'source_updated_at')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid directory reference' using errcode='23514';
    end;
    if v_id is null or v_stamp is null or v_id=any(v_seen) then
      raise exception 'invalid or repeated directory reference' using errcode='23514';
    end if;
    v_seen := array_append(v_seen,v_id);
    select r.* into v_resource from public.resources r join public.resource_matches m on m.resource_id=r.id
      where r.id=v_id and m.family_id=p_family_id and m.status<>'dismissed' and r.active and not r.is_demo;
    if not found or v_resource.updated_at is distinct from v_stamp then
      raise exception 'resource changed or is unavailable; select a current directory contact' using errcode='23514';
    end if;
    v_expected := jsonb_strip_nulls(jsonb_build_object(
      'source_resource_id',v_resource.id,'source_updated_at',v_resource.updated_at,
      'name',btrim(v_resource.program_name),'phone',nullif(btrim(v_resource.primary_contact_phone),''),
      'email',nullif(btrim(v_resource.primary_contact_email),''),
      'notes','Confirm current availability, eligibility, and contact details before referring.'));
    foreach v_key in array array['name','phone','email','notes'] loop
      if v_contact ? v_key and v_contact->v_key is distinct from v_expected->v_key then
        raise exception 'contact facts must match the resource directory' using errcode='23514';
      end if;
    end loop;
    v_result := v_result || jsonb_build_array(v_expected);
  end loop;
  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION public.canonical_plan_contacts(uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.canonical_plan_contacts(uuid, jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.canonical_plan_contacts(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_family_plan_snapshot (
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
      (select to_jsonb(p) || jsonb_build_object('resource_contacts_current', not exists(select 1 from public.plan_steps cs where cs.plan_id=p.id and not public.plan_contacts_current(f.id,cs.details->'contacts')), 'steps', coalesce((
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

CREATE OR REPLACE FUNCTION public.is_reviewed_plan_revision (
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
    and p->>'resource_contacts_current' = 'true'
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

CREATE OR REPLACE FUNCTION public.mark_plan_reviewed (
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
  if v_plan->>'resource_contacts_current' is distinct from 'true' then raise exception 'select current directory contacts before reviewing' using errcode='23514'; end if;
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

CREATE FUNCTION public.plan_contacts_current (
  p_family_id uuid,
  p_contacts  jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  perform public.canonical_plan_contacts(p_family_id,p_contacts);
  return true;
exception when check_violation or insufficient_privilege then return false;
end;
$function$;

REVOKE ALL ON FUNCTION public.plan_contacts_current(uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.plan_contacts_current(uuid, jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.plan_contacts_current(uuid, jsonb) TO service_role;

CREATE TRIGGER plan_steps_contact_provenance
  BEFORE INSERT OR UPDATE OF details ON public.plan_steps
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_plan_contact_provenance();
