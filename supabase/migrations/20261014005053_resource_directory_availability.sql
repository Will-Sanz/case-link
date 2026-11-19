-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.add_manual_resource_match (
  p_family_id   uuid,
  p_resource_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_match_id uuid;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.resources where id = p_resource_id and active and not is_demo
  ) then
    raise exception 'resource is unavailable' using errcode = '23514';
  end if;

  insert into public.resource_matches (
    family_id, resource_id, match_reason, score, status
  ) values (
    p_family_id, p_resource_id, 'Manually added by case manager', 100, 'accepted'
  ) on conflict (family_id, resource_id) do update
    set match_reason = excluded.match_reason,
        score = excluded.score,
        status = excluded.status
  returning id into v_match_id;

  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'matching.manual_add', 'resource_match', v_match_id::text,
    jsonb_build_object('resource_id', p_resource_id), 'database'
  );
  return v_match_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_suggested_resource_matches (
  p_family_id uuid,
  p_matches   jsonb,
  p_evaluated integer
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_resource_id uuid;
  v_inserted integer := 0;
  v_row_count integer;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_matches) <> 'array' then
    raise exception 'invalid resource suggestions' using errcode = '23514';
  end if;
  if jsonb_array_length(p_matches) > 1000
    or octet_length(p_matches::text) > 500000
    or p_evaluated not between 0 and 10000 then
    raise exception 'invalid resource suggestions' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text || ':resource-matches', 0));
  delete from public.resource_matches
  where family_id = p_family_id and status = 'suggested';

  for v_item in select value from jsonb_array_elements(p_matches) loop
    begin
      v_resource_id := (v_item->>'resource_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid resource suggestion id' using errcode = '23514';
    end;
    if not exists (
      select 1 from public.resources where id = v_resource_id and active and not is_demo
    ) then
      raise exception 'resource suggestion is unavailable' using errcode = '23514';
    end if;
    insert into public.resource_matches (
      family_id, resource_id, match_reason, score, status
    ) values (
      p_family_id,
      v_resource_id,
      v_item->>'match_reason',
      (v_item->>'score')::double precision,
      'suggested'
    ) on conflict (family_id, resource_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;

  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, details, source
  ) values (
    p_family_id, v_actor, 'matching.run', 'resource_match',
    jsonb_build_object('suggestions', v_inserted, 'evaluated', p_evaluated), 'database'
  );
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_resource_match (
  p_family_id    uuid,
  p_match_id     uuid,
  p_operation    text,
  p_status       public.match_status DEFAULT NULL::public.match_status,
  p_plan_step_id uuid                DEFAULT NULL::uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_updated integer;
  v_action text;
  v_details jsonb;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;

  if (p_operation = 'link' or (p_operation = 'status' and p_status = 'accepted')) and not exists (
    select 1 from public.resource_matches m join public.resources r on r.id=m.resource_id
    where m.id=p_match_id and m.family_id=p_family_id and r.active and not r.is_demo
      and (p_operation <> 'link' or m.status <> 'dismissed')
  ) then raise exception 'resource is unavailable' using errcode = '23514'; end if;

  if p_operation = 'status' then
    if p_status is null
      or p_status not in ('accepted', 'dismissed')
      or p_plan_step_id is not null then
      raise exception 'invalid resource-match status' using errcode = '23514';
    end if;
    update public.resource_matches set status = p_status
    where id = p_match_id and family_id = p_family_id;
    v_action := 'matching.' || p_status::text;
    v_details := jsonb_build_object('status', p_status);
  elsif p_operation = 'link' then
    if p_status is not null or p_plan_step_id is null or not exists (
      select 1
      from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = p_plan_step_id and p.family_id = p_family_id
    ) then
      raise exception 'invalid resource-match step' using errcode = '23514';
    end if;
    update public.resource_matches set plan_step_id = p_plan_step_id
    where id = p_match_id and family_id = p_family_id;
    v_action := 'matching.linked_to_step';
    v_details := jsonb_build_object('step_id', p_plan_step_id);
  elsif p_operation = 'unlink' then
    if p_status is not null or p_plan_step_id is not null then
      raise exception 'invalid resource-match unlink' using errcode = '23514';
    end if;
    update public.resource_matches set plan_step_id = null
    where id = p_match_id and family_id = p_family_id;
    v_action := 'matching.unlinked_from_step';
    v_details := '{}'::jsonb;
  else
    raise exception 'invalid resource-match operation' using errcode = '23514';
  end if;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'resource match not found' using errcode = '23514';
  end if;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, v_action, 'resource_match', p_match_id::text,
    v_details, 'database'
  );
  return true;
end;
$function$;

ALTER TABLE public.resources
  ADD COLUMN is_demo boolean DEFAULT false NOT NULL;

-- Preserve the catalog; only the explicitly labelled synthetic examples are excluded.
UPDATE public.resources SET is_demo = true
WHERE program_name ~* '\(\s*Demo\s*\)' OR office_or_department ~* '\(\s*Demo\s*\)';
