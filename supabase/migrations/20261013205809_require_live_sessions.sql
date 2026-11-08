-- A revoked or expired session must stop accessing casework even before its JWT expires.
create or replace function public.is_active_app_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users u
    join auth.sessions s on s.user_id = u.id
    where u.id = (select auth.uid()) and u.is_active
      and s.id = (select nullif(auth.jwt()->>'session_id', '')::uuid)
      and (s.not_after is null or s.not_after > now())
  );
$$;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_app_user() and exists (
    select 1 from public.app_users where id = (select auth.uid()) and role = 'admin'
      and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  );
$$;

create or replace function public.ensure_app_user()
returns public.app_users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_row public.app_users;
begin
  if not public.is_active_app_user() then
    raise exception 'account is not provisioned' using errcode = '42501';
  end if;

  select lower(btrim(email)) into v_email
  from auth.users
  where id = v_user_id;

  if nullif(v_email, '') is null then
    raise exception 'authenticated user has no email' using errcode = '23514';
  end if;

  update public.app_users
  set email = v_email
  where id = v_user_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.archive_family(p_family_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_archived_at timestamptz := clock_timestamp();
begin
  if not public.is_active_app_user() then
    raise exception 'account is not provisioned' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.families f
    where f.id = p_family_id
      and (f.created_by_id = v_actor or public.is_app_admin())
      and f.archived_at is null
  ) then
    return false;
  end if;

  update public.families set archived_at = v_archived_at where id = p_family_id;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'family.archived', 'family', p_family_id::text,
    jsonb_build_object('archived_at', v_archived_at), 'database'
  );
  return true;
end;
$$;

create or replace function public.create_family_intake(
  p_name text,
  p_summary text,
  p_urgency public.family_urgency,
  p_household_notes text,
  p_goals jsonb,
  p_barriers jsonb,
  p_members jsonb,
  p_initial_case_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_family_id uuid;
  v_item jsonb;
  v_index integer := 0;
begin
  if not public.is_active_app_user() then
    raise exception 'account is not provisioned' using errcode = '42501';
  end if;
  if jsonb_typeof(p_goals) <> 'array' or jsonb_array_length(p_goals) > 20
    or jsonb_typeof(p_barriers) <> 'array' or jsonb_array_length(p_barriers) not between 1 and 20
    or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) > 20 then
    raise exception 'invalid intake collections' using errcode = '23514';
  end if;

  insert into public.families (
    name, summary, urgency, household_notes, status, created_by_id
  ) values (
    p_name, p_summary, p_urgency, p_household_notes, 'active', v_actor
  ) returning id into v_family_id;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(p_goals) loop
    insert into public.family_goals (family_id, preset_key, label, sort_order)
    values (
      v_family_id, nullif(v_item->>'presetKey', ''), v_item->>'label', v_index
    );
    v_index := v_index + 1;
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(p_barriers) loop
    insert into public.family_barriers (family_id, preset_key, label, sort_order)
    values (
      v_family_id, nullif(v_item->>'presetKey', ''), v_item->>'label', v_index
    );
    v_index := v_index + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(p_members) loop
    insert into public.family_members (
      family_id, display_name, relationship, notes, age_approx
    ) values (
      v_family_id,
      v_item->>'displayName',
      nullif(v_item->>'relationship', ''),
      nullif(v_item->>'notes', ''),
      nullif(v_item->>'ageApprox', '')::integer
    );
  end loop;

  if nullif(btrim(p_initial_case_note), '') is not null then
    insert into public.case_notes (family_id, author_id, body)
    values (v_family_id, v_actor, btrim(p_initial_case_note));
  end if;

  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    v_family_id, v_actor, 'family.created', 'family', v_family_id::text,
    jsonb_build_object(
      'barrier_count', jsonb_array_length(p_barriers),
      'goal_count', jsonb_array_length(p_goals),
      'has_description', p_summary is not null or p_household_notes is not null
    ),
    'database'
  );
  return v_family_id;
end;
$$;

create or replace function public.consume_ai_budget(
  p_operation text,
  p_weight integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := clock_timestamp();
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_operation_limit integer;
  v_operation_window integer;
  v_window_start timestamptz;
  v_remaining integer;
  v_retry_after integer;
  v_scope text;
begin
  if not public.is_active_app_user() then
    raise exception 'account is not provisioned' using errcode = '42501';
  end if;
  if p_weight not between 1 and 10 then
    raise exception 'invalid AI request weight' using errcode = '23514';
  end if;
  if v_operation not in ('helper', 'chat', 'plan', 'plan_phase', 'pdf_mapping') then
    raise exception 'invalid AI operation' using errcode = '23514';
  end if;
  if not (select ai_enabled from private.production_controls where singleton) then
    return jsonb_build_object('allowed', false, 'retryAfter', 3600, 'reason', 'disabled');
  end if;

  if v_operation = 'pdf_mapping' then
    v_operation_limit := 3;
    v_operation_window := 600;
  elsif v_operation in ('plan', 'plan_phase') then
    v_operation_limit := 6;
    v_operation_window := 600;
  else
    v_operation_limit := 30;
    v_operation_window := 60;
  end if;

  -- Operation-specific user budget.
  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / v_operation_window) * v_operation_window
  );
  v_scope := 'user:' || v_user_id::text || ':operation:' || v_operation;
  insert into private.ai_rate_counters (scope_key, window_start, window_seconds, used)
  values (v_scope, v_window_start, v_operation_window, p_weight)
  on conflict (scope_key, window_start, window_seconds) do update
    set used = private.ai_rate_counters.used + excluded.used
    where private.ai_rate_counters.used + excluded.used <= v_operation_limit
  returning v_operation_limit - used into v_remaining;
  if not found then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + make_interval(secs => v_operation_window) - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'retryAfter', v_retry_after, 'reason', 'operation');
  end if;

  -- Aggregate per-user hourly budget.
  v_window_start := to_timestamp(floor(extract(epoch from v_now) / 3600) * 3600);
  v_scope := 'user:' || v_user_id::text || ':hour';
  insert into private.ai_rate_counters (scope_key, window_start, window_seconds, used)
  values (v_scope, v_window_start, 3600, p_weight)
  on conflict (scope_key, window_start, window_seconds) do update
    set used = private.ai_rate_counters.used + excluded.used
    where private.ai_rate_counters.used + excluded.used <= 120
  returning 120 - used into v_remaining;
  if not found then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + interval '1 hour' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'retryAfter', v_retry_after, 'reason', 'user_hour');
  end if;

  -- A deployment is one tenant in the pilot, so this is also the tenant daily budget.
  v_window_start := date_trunc('day', v_now);
  insert into private.ai_rate_counters (scope_key, window_start, window_seconds, used)
  values ('deployment:day', v_window_start, 86400, p_weight)
  on conflict (scope_key, window_start, window_seconds) do update
    set used = private.ai_rate_counters.used + excluded.used
    where private.ai_rate_counters.used + excluded.used <= 2000
  returning 2000 - used into v_remaining;
  if not found then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + interval '1 day' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'retryAfter', v_retry_after, 'reason', 'deployment_day');
  end if;

  delete from private.ai_rate_counters
  where window_start + make_interval(secs => window_seconds) < v_now - interval '1 day';

  return jsonb_build_object('allowed', true, 'retryAfter', 0, 'remaining', v_remaining);
end;
$$;

create or replace function public.release_ai_job(p_family_id uuid, p_job_key text)
returns void language sql security definer set search_path = '' as $$
  delete from private.ai_job_claims
  where family_id = p_family_id and job_key = p_job_key
    and owner_user_id = (select auth.uid()) and public.is_active_app_user();
$$;
