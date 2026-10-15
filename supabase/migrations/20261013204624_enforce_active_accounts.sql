-- Account access is database state, so an old JWT cannot outlive offboarding.
alter function public.set_updated_at() set search_path = '';
alter table public.app_users add column is_active boolean not null default true;

create function public.is_active_app_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users where id = (select auth.uid()) and is_active);
$$;
revoke all on function public.is_active_app_user() from public, anon;
grant execute on function public.is_active_app_user() to authenticated;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users
    where id = (select auth.uid()) and is_active and role = 'admin'
      and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  );
$$;

create or replace function public.can_access_family(p_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_app_user() and (
    public.is_app_admin()
    or exists (select 1 from public.families where id = p_family_id and created_by_id = (select auth.uid()))
    or exists (select 1 from public.family_case_managers where family_id = p_family_id and user_id = (select auth.uid()))
  );
$$;

-- These restrictive policies also cover older ownership-only policies.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'families', 'family_case_managers', 'family_goals', 'family_barriers', 'family_members',
    'case_notes', 'resources', 'resource_matches', 'plans', 'plan_steps', 'plan_step_resources',
    'plan_step_action_items', 'referrals', 'tasks', 'activity_log', 'resource_import_runs', 'plan_step_activity',
    'barrier_plan_records', 'case_progress_updates'
  ] loop
    execute format('create policy active_account_required on public.%I as restrictive for all to authenticated using ((select public.is_active_app_user())) with check ((select public.is_active_app_user()))', v_table);
  end loop;
end;
$$;
create policy active_account_required on public.app_users as restrictive
  for update to authenticated
  using ((select public.is_active_app_user())) with check ((select public.is_active_app_user()));

create or replace function public.protect_authorization_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active then
    raise exception 'authorization columns are immutable' using errcode = '42501';
  end if;
  return new;
end;
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
  if v_user_id is null or not exists (
    select 1 from public.app_users where id = v_user_id and is_active
  ) then
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
  if v_actor is null or not exists (
    select 1 from public.app_users where id = v_actor and is_active
  ) then
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
  if v_actor is null or not exists (
    select 1 from public.app_users where id = v_actor and is_active
  ) then
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
  if v_user_id is null or not exists (
    select 1 from public.app_users where id = v_user_id and is_active
  ) then
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

-- Only the protected operator job can disable accounts or move their assignments.
create function public.operator_offboard_user(
  p_target_user_id uuid,
  p_reassign_user_id uuid,
  p_actor_label text,
  p_reason text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_revoked integer;
begin
  if char_length(btrim(coalesce(p_actor_label, ''))) not between 3 and 200
    or char_length(btrim(coalesce(p_reason, ''))) not between 8 and 1000
    or p_target_user_id is null or p_reassign_user_id is null
    or p_target_user_id = p_reassign_user_id then
    raise exception 'invalid offboarding input' using errcode = '23514';
  end if;
  -- Lock both accounts consistently so two concurrent transfers cannot target each other.
  perform id from public.app_users where id in (p_target_user_id, p_reassign_user_id) order by id for update;
  if not exists (select 1 from public.app_users where id = p_target_user_id)
    or not exists (select 1 from public.app_users where id = p_reassign_user_id and is_active) then
    raise exception 'target or active replacement account not found' using errcode = '23503';
  end if;

  update public.app_users set is_active = false where id = p_target_user_id;
  insert into public.family_case_managers (family_id, user_id)
    select f.id, p_reassign_user_id from public.families f
    where f.created_by_id = p_target_user_id or exists (
      select 1 from public.family_case_managers m where m.family_id = f.id and m.user_id = p_target_user_id
    )
    on conflict (family_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  delete from public.family_case_managers where user_id = p_target_user_id;
  -- Supabase refresh tokens reference these sessions and are removed by the FK cascade.
  delete from auth.sessions where user_id = p_target_user_id;
  get diagnostics v_revoked = row_count;
  insert into public.security_audit_log (actor_label, action, target_user_id, reason, details)
  values (btrim(p_actor_label), 'user.disabled', p_target_user_id, btrim(p_reason),
    jsonb_build_object('replacement_user_id', p_reassign_user_id, 'assignments_added', v_count, 'sessions_revoked', v_revoked));
  return v_count;
end;
$$;
revoke all on function public.operator_offboard_user(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.operator_offboard_user(uuid, uuid, text, text) to service_role;
