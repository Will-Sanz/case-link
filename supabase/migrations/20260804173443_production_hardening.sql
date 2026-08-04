-- Production trust-boundary hardening.
-- The pilot deployment model is one school/district per Supabase project.

-- ---------------------------------------------------------------------------
-- Account provisioning and immutable authorization fields
-- ---------------------------------------------------------------------------

revoke insert, update on table public.app_users from authenticated;
grant update (
  display_name,
  job_title,
  organization,
  phone,
  pronouns,
  service_area,
  bio,
  preferred_contact_method,
  notes_signature
) on table public.app_users to authenticated;

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
    select 1 from public.app_users where id = v_user_id
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

revoke all on function public.ensure_app_user() from public, anon;
grant execute on function public.ensure_app_user() to authenticated;

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
    or new.role is distinct from old.role then
    raise exception 'authorization columns are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_protect_authorization_columns on public.app_users;
create trigger app_users_protect_authorization_columns
before update on public.app_users
for each row execute function public.protect_authorization_columns();

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users u
    where u.id = (select auth.uid())
      and u.role = 'admin'
      and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  );
$$;

revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.can_access_family(uuid) from public, anon;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.can_access_family(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Final-boundary validation and relationship integrity
-- ---------------------------------------------------------------------------

create or replace function public.contains_direct_identifier(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(value, '') ~* (
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
    || '|(^|[^0-9])(\+?1[ .-]?)?(\([0-9]{3}\)|[0-9]{3})[ .-][0-9]{3}[ .-][0-9]{4}([^0-9]|$)'
    || '|(^|[^0-9])[0-9]{3}-[0-9]{2}-[0-9]{4}([^0-9]|$)'
    || '|(student|participant|child|client|case)[[:space:]]*(id|identifier|number|no\.?)[[:space:]]*[:#-]?[[:space:]]*[[:alnum:]][[:alnum:]-]{3,}'
    || '|(date[[:space:]]+of[[:space:]]+birth|d\.?o\.?b\.?|born)[[:space:]]*[:#-]?[[:space:]]*[0-9]{1,2}[/\-][0-9]{1,2}[/\-][0-9]{2,4}'
    || '|(^|[^0-9])[0-9]{1,6}[[:space:]]+([[:alnum:].''-]+[[:space:]]+){0,5}(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|place|pl\.?|circle|terrace|trail)([^[:alpha:]]|$)'
  );
$$;

alter table public.families
  add constraint families_name_length_check check (char_length(btrim(name)) between 1 and 200),
  add constraint families_summary_length_check check (summary is null or char_length(summary) <= 8000),
  add constraint families_household_notes_length_check check (household_notes is null or char_length(household_notes) <= 8000),
  add constraint families_no_direct_identifiers_check check (
    not public.contains_direct_identifier(name)
    and not public.contains_direct_identifier(summary)
    and not public.contains_direct_identifier(household_notes)
  );

alter table public.family_goals
  add constraint family_goals_label_length_check check (char_length(btrim(label)) between 1 and 200),
  add constraint family_goals_preset_length_check check (preset_key is null or char_length(preset_key) <= 100),
  add constraint family_goals_sort_check check (sort_order between 0 and 99),
  add constraint family_goals_no_direct_identifiers_check check (not public.contains_direct_identifier(label));

alter table public.family_barriers
  add constraint family_barriers_label_length_check check (char_length(btrim(label)) between 1 and 200),
  add constraint family_barriers_preset_length_check check (preset_key is null or char_length(preset_key) <= 100),
  add constraint family_barriers_sort_check check (sort_order between 0 and 99),
  add constraint family_barriers_no_direct_identifiers_check check (not public.contains_direct_identifier(label));

alter table public.family_members
  add constraint family_members_display_name_length_check check (char_length(btrim(display_name)) between 1 and 200),
  add constraint family_members_relationship_length_check check (relationship is null or char_length(relationship) <= 120),
  add constraint family_members_notes_length_check check (notes is null or char_length(notes) <= 2000),
  add constraint family_members_age_check check (age_approx is null or age_approx between 0 and 120),
  add constraint family_members_no_direct_identifiers_check check (
    not public.contains_direct_identifier(display_name)
    and not public.contains_direct_identifier(notes)
  );

alter table public.case_notes
  add constraint case_notes_body_length_check check (char_length(btrim(body)) between 1 and 12000),
  add constraint case_notes_no_direct_identifiers_check check (not public.contains_direct_identifier(body));

alter table public.plans
  add constraint plans_summary_length_check check (summary is null or char_length(summary) <= 2000),
  add constraint plans_version_check check (version between 1 and 10000),
  add constraint plans_ai_model_length_check check (ai_model is null or char_length(ai_model) <= 200),
  add constraint plans_no_direct_identifiers_check check (
    not public.contains_direct_identifier(summary)
    and not public.contains_direct_identifier(client_display::text)
    and not public.contains_direct_identifier(generation_state->>'planning_brief')
  ),
  add constraint plans_client_display_size_check check (client_display is null or octet_length(client_display::text) <= 50000),
  add constraint plans_generation_state_size_check check (generation_state is null or octet_length(generation_state::text) <= 250000);

alter table public.plan_steps
  add constraint plan_steps_title_length_check check (char_length(btrim(title)) between 1 and 500),
  add constraint plan_steps_description_length_check check (char_length(description) <= 8000),
  add constraint plan_steps_sort_order_check check (sort_order between 0 and 999),
  add constraint plan_steps_details_size_check check (details is null or octet_length(details::text) <= 100000),
  add constraint plan_steps_workflow_size_check check (workflow_data is null or octet_length(workflow_data::text) <= 50000),
  add constraint plan_steps_ai_helper_size_check check (ai_helper_data is null or octet_length(ai_helper_data::text) <= 50000);

alter table public.plan_steps
  add constraint plan_steps_no_direct_identifiers_check check (
    not public.contains_direct_identifier(title)
    and not public.contains_direct_identifier(description)
    -- Public agency contact details are allowed only in the dedicated contacts array.
    and not public.contains_direct_identifier((coalesce(details, '{}'::jsonb) - 'contacts')::text)
    and not public.contains_direct_identifier(workflow_data::text)
  );

alter table public.plan_step_action_items
  add constraint plan_step_action_items_title_length_check check (char_length(btrim(title)) between 1 and 500),
  add constraint plan_step_action_items_description_length_check check (description is null or char_length(description) <= 4000),
  add constraint plan_step_action_items_week_check check (week_index between 1 and 52),
  add constraint plan_step_action_items_sort_check check (sort_order between 0 and 999),
  add constraint plan_step_action_items_outcome_length_check check (outcome is null or char_length(outcome) <= 2000),
  add constraint plan_step_action_items_notes_length_check check (notes is null or char_length(notes) <= 2000),
  add constraint plan_step_action_items_no_direct_identifiers_check check (
    not public.contains_direct_identifier(title)
    and not public.contains_direct_identifier(description)
    and not public.contains_direct_identifier(outcome)
    and not public.contains_direct_identifier(notes)
  );

alter table public.resource_matches
  add constraint resource_matches_reason_length_check check (char_length(btrim(match_reason)) between 1 and 2000),
  add constraint resource_matches_score_check check (score between 0 and 1000),
  add constraint resource_matches_no_direct_identifiers_check check (
    not public.contains_direct_identifier(match_reason)
  );

alter table public.tasks
  add constraint tasks_title_length_check check (char_length(btrim(title)) between 1 and 500),
  add constraint tasks_description_length_check check (description is null or char_length(description) <= 4000),
  add constraint tasks_no_direct_identifiers_check check (
    not public.contains_direct_identifier(title)
    and not public.contains_direct_identifier(description)
  );

alter table public.referrals
  add constraint referrals_organization_length_check check (char_length(btrim(organization_label)) between 1 and 300),
  add constraint referrals_text_size_check check (
    (contact_person is null or char_length(contact_person) <= 300)
    and (method is null or char_length(method) <= 100)
    and (outcome is null or char_length(outcome) <= 2000)
    and (notes is null or char_length(notes) <= 4000)
  ),
  add constraint referrals_no_direct_identifiers_check check (
    not public.contains_direct_identifier(outcome)
    and not public.contains_direct_identifier(notes)
  );

create or replace function public.protect_family_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if new.created_by_id is distinct from old.created_by_id then
    raise exception 'family ownership is immutable' using errcode = '42501';
  end if;
  if new.archived_at is distinct from old.archived_at
    and old.created_by_id <> (select auth.uid())
    and not public.is_app_admin() then
    raise exception 'only the family owner or an administrator may archive this family'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists families_protect_identity on public.families;
create trigger families_protect_identity
before update on public.families
for each row execute function public.protect_family_identity();

create or replace function public.protect_plan_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role') then return new; end if;
  if new.family_id is distinct from old.family_id
    or new.version is distinct from old.version
    or new.generation_source is distinct from old.generation_source
    or new.ai_model is distinct from old.ai_model
    or new.generation_state is distinct from old.generation_state then
    raise exception 'plan identity is immutable' using errcode = '42501';
  end if;
  if (
    (new.client_display ? 'reviewedAt' and new.client_display->'reviewedAt' is distinct from old.client_display->'reviewedAt')
    or (new.client_display ? 'reviewedById' and new.client_display->'reviewedById' is distinct from old.client_display->'reviewedById')
  ) then
    raise exception 'plan review fields require the reviewed-plan function' using errcode = '42501';
  end if;
  if new.summary is distinct from old.summary
    or (coalesce(new.client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById')
      is distinct from
      (coalesce(old.client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById') then
    new.client_display := coalesce(new.client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById';
  end if;
  return new;
end;
$$;

drop trigger if exists plans_protect_identity on public.plans;
create trigger plans_protect_identity
before update on public.plans
for each row execute function public.protect_plan_identity();

create or replace function public.protect_plan_child_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
begin
  if current_user in ('postgres', 'service_role') then return new; end if;
  if (tg_table_name = 'plan_steps' and v_new->'plan_id' is distinct from v_old->'plan_id')
    or (tg_table_name = 'plan_step_action_items' and v_new->'plan_step_id' is distinct from v_old->'plan_step_id') then
    raise exception 'plan relationship is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_steps_protect_identity on public.plan_steps;
create trigger plan_steps_protect_identity
before update on public.plan_steps
for each row execute function public.protect_plan_child_identity();

drop trigger if exists plan_step_action_items_protect_identity on public.plan_step_action_items;
create trigger plan_step_action_items_protect_identity
before update on public.plan_step_action_items
for each row execute function public.protect_plan_child_identity();

create or replace function public.protect_resource_match_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') and (
    new.family_id is distinct from old.family_id
    or new.resource_id is distinct from old.resource_id
  ) then
    raise exception 'resource-match identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists resource_matches_protect_identity on public.resource_matches;
create trigger resource_matches_protect_identity
before update on public.resource_matches
for each row execute function public.protect_resource_match_identity();

create or replace function public.invalidate_plan_review_on_child_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_step_id uuid;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    if tg_table_name = 'plan_steps' and not (
      v_new->'title' is distinct from v_old->'title'
      or v_new->'description' is distinct from v_old->'description'
      or v_new->'details' is distinct from v_old->'details'
      or v_new->'priority' is distinct from v_old->'priority'
      or v_new->'phase' is distinct from v_old->'phase'
      or v_new->'sort_order' is distinct from v_old->'sort_order'
    ) then
      return new;
    end if;
    if tg_table_name = 'plan_step_action_items' and not (
      v_new->'title' is distinct from v_old->'title'
      or v_new->'description' is distinct from v_old->'description'
      or v_new->'week_index' is distinct from v_old->'week_index'
      or v_new->'target_date' is distinct from v_old->'target_date'
    ) then
      return new;
    end if;
  end if;
  if tg_table_name = 'plan_steps' then
    v_plan_id := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  else
    v_step_id := case when tg_op = 'DELETE' then old.plan_step_id else new.plan_step_id end;
    select plan_id into v_plan_id from public.plan_steps where id = v_step_id;
  end if;
  if v_plan_id is not null then
    update public.plans
    set client_display = coalesce(client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById'
    where id = v_plan_id
      and (client_display ? 'reviewedAt' or client_display ? 'reviewedById');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.invalidate_plan_review_on_child_change() from public, anon, authenticated;

drop trigger if exists plan_steps_invalidate_review on public.plan_steps;
create trigger plan_steps_invalidate_review
after insert or update or delete on public.plan_steps
for each row execute function public.invalidate_plan_review_on_child_change();

drop trigger if exists plan_step_action_items_invalidate_review on public.plan_step_action_items;
create trigger plan_step_action_items_invalidate_review
after insert or update or delete on public.plan_step_action_items
for each row execute function public.invalidate_plan_review_on_child_change();

create or replace function public.protect_case_note_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') and (
    new.family_id is distinct from old.family_id
    or new.author_id is distinct from old.author_id
  ) then
    raise exception 'case note ownership is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists case_notes_protect_identity on public.case_notes;
create trigger case_notes_protect_identity
before update on public.case_notes
for each row execute function public.protect_case_note_identity();

drop policy if exists case_notes_update_own on public.case_notes;
create policy case_notes_update_own on public.case_notes
  for update to authenticated
  using ((author_id = (select auth.uid()) or public.is_app_admin()) and public.can_access_family(family_id))
  with check ((author_id = (select auth.uid()) or public.is_app_admin()) and public.can_access_family(family_id));

create or replace function public.enforce_family_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_family_id uuid;
begin
  if tg_table_name = 'resource_matches' and new.plan_step_id is not null then
    select p.family_id into v_family_id
    from public.plan_steps ps
    join public.plans p on p.id = ps.plan_id
    where ps.id = new.plan_step_id;
  elsif tg_table_name = 'plan_step_activity' then
    select p.family_id into v_family_id
    from public.plan_steps ps
    join public.plans p on p.id = ps.plan_id
    where ps.id = new.plan_step_id;
  elsif tg_table_name = 'tasks' and new.plan_step_id is not null then
    select p.family_id into v_family_id
    from public.plan_steps ps
    join public.plans p on p.id = ps.plan_id
    where ps.id = new.plan_step_id;
  else
    return new;
  end if;

  if v_family_id is null or v_family_id <> new.family_id then
    raise exception 'cross-family relationship is not allowed' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists resource_matches_family_consistency on public.resource_matches;
create trigger resource_matches_family_consistency
before insert or update of family_id, plan_step_id on public.resource_matches
for each row execute function public.enforce_family_relationship();

drop trigger if exists plan_step_activity_family_consistency on public.plan_step_activity;
create trigger plan_step_activity_family_consistency
before insert or update of family_id, plan_step_id on public.plan_step_activity
for each row execute function public.enforce_family_relationship();

drop trigger if exists tasks_family_consistency on public.tasks;
create trigger tasks_family_consistency
before insert or update of family_id, plan_step_id on public.tasks
for each row execute function public.enforce_family_relationship();

-- ---------------------------------------------------------------------------
-- Trusted, immutable activity events
-- ---------------------------------------------------------------------------

alter table public.activity_log
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists source text not null default 'application',
  add constraint activity_log_source_check check (source in ('application', 'database', 'operator')),
  add constraint activity_log_action_length_check check (char_length(action) between 1 and 100),
  add constraint activity_log_details_size_check check (details is null or octet_length(details::text) <= 8000);

comment on table public.activity_log is
  'User-visible product timeline. Database-owned consequential events are authoritative; operator security events live in security_audit_log.';

create unique index if not exists activity_log_correlation_action_idx
  on public.activity_log (correlation_id, action);

drop policy if exists activity_log_insert on public.activity_log;
revoke insert, update, delete on table public.activity_log from authenticated, anon;

create or replace function public.record_activity_event(
  p_family_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_details jsonb default null,
  p_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_allowed_actions constant text[] := array[
    'family.workflow_step_viewed',
    'plan.first_action_visible',
    'step.action_item_completed',
    'step.action_item_no_longer_needed',
    'step.action_item_updated',
    'step.escalation_flagged',
    'step.status_changed',
    'step.updated'
  ];
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if p_action is null or not (p_action = any(v_allowed_actions)) then
    raise exception 'unsupported activity action' using errcode = '23514';
  end if;
  if p_entity_type is not null and p_entity_type not in (
    'family', 'case_note', 'plan', 'plan_step', 'plan_step_action_item', 'resource_match'
  ) then
    raise exception 'unsupported activity entity type' using errcode = '23514';
  end if;
  if p_entity_id is not null and (
    char_length(p_entity_id) > 200 or public.contains_direct_identifier(p_entity_id)
  ) then
    raise exception 'invalid activity entity id' using errcode = '23514';
  end if;
  if p_details is not null and octet_length(p_details::text) > 8000 then
    raise exception 'activity details are too large' using errcode = '22001';
  end if;
  if public.contains_direct_identifier(coalesce(p_details, '{}'::jsonb)::text) then
    raise exception 'invalid activity details' using errcode = '23514';
  end if;

  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, correlation_id, source
  ) values (
    p_family_id, v_actor, p_action, p_entity_type, p_entity_id, p_details,
    coalesce(p_correlation_id, gen_random_uuid()), 'application'
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_activity_event(uuid, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.record_activity_event(uuid, text, text, text, jsonb, uuid) to authenticated;

drop policy if exists plan_step_activity_insert on public.plan_step_activity;
revoke insert, update, delete on table public.plan_step_activity from authenticated, anon;

-- Operator-only audit stream. No browser role receives table privileges.
create table if not exists public.security_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_label text not null,
  action text not null,
  target_user_id uuid,
  reason text not null,
  details jsonb,
  created_at timestamptz not null default now(),
  constraint security_audit_actor_length_check check (char_length(actor_label) between 3 and 200),
  constraint security_audit_action_check check (action in (
    'user.invited', 'user.role_changed', 'user.disabled', 'user.deleted',
    'family.assignment_added', 'family.assignment_removed'
  )),
  constraint security_audit_reason_length_check check (char_length(reason) between 8 and 1000),
  constraint security_audit_details_size_check check (details is null or octet_length(details::text) <= 8000)
);
alter table public.security_audit_log enable row level security;
revoke all on table public.security_audit_log from public, anon, authenticated, service_role;
grant select on table public.security_audit_log to service_role;

create or replace function public.operator_set_user_role(
  p_target_user_id uuid,
  p_role public.user_role,
  p_actor_label text,
  p_reason text,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_action not in ('user.invited', 'user.role_changed')
    or char_length(btrim(coalesce(p_actor_label, ''))) not between 3 and 200
    or char_length(btrim(coalesce(p_reason, ''))) not between 8 and 1000 then
    raise exception 'invalid operator audit input' using errcode = '23514';
  end if;
  select lower(btrim(email)) into v_email from auth.users where id = p_target_user_id;
  if nullif(v_email, '') is null then
    raise exception 'target auth user not found' using errcode = '23503';
  end if;

  insert into public.app_users (id, email, role)
  values (p_target_user_id, v_email, p_role)
  on conflict (id) do update set email = excluded.email, role = excluded.role;
  insert into public.security_audit_log (
    actor_label, action, target_user_id, reason, details
  ) values (
    btrim(p_actor_label), p_action, p_target_user_id, btrim(p_reason),
    jsonb_build_object('role', p_role, 'delivery', case when p_action = 'user.invited' then 'invite' else 'existing_user' end)
  );
end;
$$;

revoke all on function public.operator_set_user_role(uuid, public.user_role, text, text, text)
  from public, anon, authenticated;
grant execute on function public.operator_set_user_role(uuid, public.user_role, text, text, text)
  to service_role;

create or replace function public.operator_set_family_assignment(
  p_family_id uuid,
  p_target_user_id uuid,
  p_assigned boolean,
  p_actor_label text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
  v_action text := case when p_assigned then 'family.assignment_added' else 'family.assignment_removed' end;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_actor_label, ''))) not between 3 and 200
    or char_length(btrim(coalesce(p_reason, ''))) not between 8 and 1000
    or not exists (select 1 from public.families where id = p_family_id)
    or not exists (select 1 from public.app_users where id = p_target_user_id) then
    raise exception 'invalid operator assignment input' using errcode = '23514';
  end if;

  if p_assigned then
    insert into public.family_case_managers (family_id, user_id)
    values (p_family_id, p_target_user_id)
    on conflict (family_id, user_id) do nothing;
  else
    delete from public.family_case_managers
    where family_id = p_family_id and user_id = p_target_user_id;
  end if;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then return false; end if;

  insert into public.security_audit_log (
    actor_label, action, target_user_id, reason, details
  ) values (
    btrim(p_actor_label), v_action, p_target_user_id, btrim(p_reason),
    jsonb_build_object('family_id', p_family_id)
  );
  return true;
end;
$$;

revoke all on function public.operator_set_family_assignment(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.operator_set_family_assignment(uuid, uuid, boolean, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Shared AI budgets and cross-instance work claims
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.production_controls (
  singleton boolean primary key default true check (singleton),
  ai_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into private.production_controls (singleton, ai_enabled)
values (true, true)
on conflict (singleton) do nothing;

create table private.ai_rate_counters (
  scope_key text not null,
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds between 10 and 86400),
  used integer not null check (used >= 0),
  primary key (scope_key, window_start, window_seconds)
);

create index ai_rate_counters_expiry_idx
  on private.ai_rate_counters (window_start, window_seconds);

create table private.ai_job_claims (
  family_id uuid not null references public.families (id) on delete cascade,
  job_key text not null,
  owner_user_id uuid not null references public.app_users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (family_id, job_key)
);

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
    select 1 from public.app_users where id = v_user_id
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

revoke all on function public.consume_ai_budget(text, integer) from public, anon;
grant execute on function public.consume_ai_budget(text, integer) to authenticated;

create or replace function public.claim_ai_job(
  p_family_id uuid,
  p_job_key text,
  p_ttl_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_claimed boolean;
begin
  if v_user_id is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_job_key), '') is null or char_length(p_job_key) > 120 then
    raise exception 'invalid AI job key' using errcode = '23514';
  end if;
  if p_ttl_seconds not between 30 and 600 then
    raise exception 'invalid AI job TTL' using errcode = '23514';
  end if;

  insert into private.ai_job_claims (family_id, job_key, owner_user_id, expires_at)
  values (p_family_id, p_job_key, v_user_id, clock_timestamp() + make_interval(secs => p_ttl_seconds))
  on conflict (family_id, job_key) do update
    set owner_user_id = excluded.owner_user_id,
        expires_at = excluded.expires_at,
        created_at = clock_timestamp()
    where private.ai_job_claims.expires_at <= clock_timestamp()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.release_ai_job(p_family_id uuid, p_job_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.ai_job_claims
  where family_id = p_family_id
    and job_key = p_job_key
    and owner_user_id = (select auth.uid());
$$;

revoke all on function public.claim_ai_job(uuid, text, integer) from public, anon;
revoke all on function public.release_ai_job(uuid, text) from public, anon;
grant execute on function public.claim_ai_job(uuid, text, integer) to authenticated;
grant execute on function public.release_ai_job(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic archive and paperwork audit operations
-- ---------------------------------------------------------------------------

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
    select 1 from public.app_users where id = v_actor
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

revoke all on function public.archive_family(uuid) from public, anon;
grant execute on function public.archive_family(uuid) to authenticated;

create or replace function public.record_paperwork_download(
  p_family_id uuid,
  p_plan_id uuid,
  p_plan_version integer,
  p_field_count integer,
  p_assisted_by_ai boolean,
  p_paperwork_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_correlation_id uuid := gen_random_uuid();
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id and family_id = p_family_id) then
    raise exception 'plan not found' using errcode = '23514';
  end if;
  if p_field_count not between 0 and 150 or p_paperwork_mode <> 'fillable' then
    raise exception 'invalid paperwork audit data' using errcode = '23514';
  end if;

  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, correlation_id, source
  ) values
  (
    p_family_id, v_actor, 'paperwork.review_completed', 'plan', p_plan_id::text,
    jsonb_build_object(
      'plan_version', p_plan_version,
      'field_count', p_field_count,
      'assisted_by_ai', p_assisted_by_ai,
      'paperwork_mode', p_paperwork_mode
    ), v_correlation_id, 'database'
  ),
  (
    p_family_id, v_actor, 'paperwork.downloaded', 'plan', p_plan_id::text,
    jsonb_build_object(
      'plan_version', p_plan_version,
      'field_count', p_field_count,
      'paperwork_mode', p_paperwork_mode
    ), v_correlation_id, 'database'
  );
end;
$$;

revoke all on function public.record_paperwork_download(uuid, uuid, integer, integer, boolean, text) from public, anon;
grant execute on function public.record_paperwork_download(uuid, uuid, integer, integer, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic application mutations
-- ---------------------------------------------------------------------------

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
    select 1 from public.app_users where id = v_actor
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

revoke all on function public.create_family_intake(text, text, public.family_urgency, text, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.create_family_intake(text, text, public.family_urgency, text, jsonb, jsonb, jsonb, text) to authenticated;
revoke execute on function public.create_family_intake_row(text, text, public.family_urgency, text, public.family_status) from authenticated;

create or replace function public.add_case_note(p_family_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_note_id uuid;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  insert into public.case_notes (family_id, author_id, body)
  values (p_family_id, v_actor, btrim(p_body)) returning id into v_note_id;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, source
  ) values (
    p_family_id, v_actor, 'note.added', 'case_note', v_note_id::text, 'database'
  );
  return v_note_id;
end;
$$;

revoke all on function public.add_case_note(uuid, text) from public, anon;
grant execute on function public.add_case_note(uuid, text) to authenticated;

create or replace function public.update_family_meta(p_family_id uuid, p_patch jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_updated integer;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_patch) as key
      where key not in ('summary', 'household_notes', 'urgency', 'status')
    ) then
    raise exception 'invalid family patch' using errcode = '23514';
  end if;

  update public.families
  set summary = case when p_patch ? 'summary' then nullif(btrim(p_patch->>'summary'), '') else summary end,
      household_notes = case when p_patch ? 'household_notes' then nullif(btrim(p_patch->>'household_notes'), '') else household_notes end,
      urgency = case when p_patch ? 'urgency' then nullif(p_patch->>'urgency', '')::public.family_urgency else urgency end,
      status = case when p_patch ? 'status' then (p_patch->>'status')::public.family_status else status end
  where id = p_family_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return false; end if;

  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'context.updated', 'family', p_family_id::text,
    jsonb_build_object('fields', (select jsonb_agg(key) from jsonb_object_keys(p_patch) as key)),
    'database'
  );
  return true;
end;
$$;

revoke all on function public.update_family_meta(uuid, jsonb) from public, anon;
grant execute on function public.update_family_meta(uuid, jsonb) to authenticated;

create or replace function public.replace_family_goals(p_family_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_index integer := 0;
  v_id uuid;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'invalid goals' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where nullif(item->>'id', '') is not null
      and not exists (
        select 1 from public.family_goals g
        where g.id = (item->>'id')::uuid and g.family_id = p_family_id
      )
  ) then
    raise exception 'goal not found' using errcode = '23514';
  end if;
  delete from public.family_goals g
  where g.family_id = p_family_id
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item
      where nullif(item->>'id', '') is not null and (item->>'id')::uuid = g.id
    );
  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    if v_id is null then
      insert into public.family_goals (family_id, label, sort_order)
      values (p_family_id, v_item->>'label', v_index);
    else
      update public.family_goals set label = v_item->>'label', sort_order = v_index
      where id = v_id and family_id = p_family_id;
    end if;
    v_index := v_index + 1;
  end loop;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'context.updated', 'family', p_family_id::text,
    jsonb_build_object('fields', jsonb_build_array('goals'), 'count', jsonb_array_length(p_rows)),
    'database'
  );
end;
$$;

create or replace function public.replace_family_barriers(p_family_id uuid, p_barriers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_index integer := 0;
  v_id uuid;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_barriers) <> 'array' or jsonb_array_length(p_barriers) not between 1 and 20 then
    raise exception 'invalid barriers' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_barriers) item
    where nullif(item->>'id', '') is not null
      and not exists (
        select 1 from public.family_barriers b
        where b.id = (item->>'id')::uuid and b.family_id = p_family_id
      )
  ) then
    raise exception 'barrier not found' using errcode = '23514';
  end if;
  delete from public.family_barriers b
  where b.family_id = p_family_id
    and not exists (
      select 1 from jsonb_array_elements(p_barriers) item
      where nullif(item->>'id', '') is not null and (item->>'id')::uuid = b.id
    );
  for v_item in select value from jsonb_array_elements(p_barriers) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    if v_id is null then
      insert into public.family_barriers (family_id, preset_key, label, sort_order)
      values (p_family_id, nullif(v_item->>'preset_key', ''), v_item->>'label', v_index);
    else
      update public.family_barriers
      set label = v_item->>'label',
          preset_key = case when v_item ? 'preset_key' then nullif(v_item->>'preset_key', '') else preset_key end,
          sort_order = v_index
      where id = v_id and family_id = p_family_id;
    end if;
    v_index := v_index + 1;
  end loop;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'context.updated', 'family', p_family_id::text,
    jsonb_build_object('fields', jsonb_build_array('barriers'), 'count', jsonb_array_length(p_barriers)),
    'database'
  );
end;
$$;

create or replace function public.replace_family_members(p_family_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_id uuid;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'invalid members' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where nullif(item->>'id', '') is not null
      and not exists (
        select 1 from public.family_members m
        where m.id = (item->>'id')::uuid and m.family_id = p_family_id
      )
  ) then
    raise exception 'member not found' using errcode = '23514';
  end if;
  delete from public.family_members m
  where m.family_id = p_family_id
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item
      where nullif(item->>'id', '') is not null and (item->>'id')::uuid = m.id
    );
  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    if v_id is null then
      insert into public.family_members (
        family_id, display_name, relationship, notes, age_approx
      ) values (
        p_family_id, v_item->>'display_name', nullif(v_item->>'relationship', ''),
        nullif(v_item->>'notes', ''), nullif(v_item->>'age_approx', '')::integer
      );
    else
      update public.family_members
      set display_name = v_item->>'display_name',
          relationship = nullif(v_item->>'relationship', ''),
          notes = nullif(v_item->>'notes', ''),
          age_approx = nullif(v_item->>'age_approx', '')::integer
      where id = v_id and family_id = p_family_id;
    end if;
  end loop;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'context.updated', 'family', p_family_id::text,
    jsonb_build_object('fields', jsonb_build_array('members'), 'count', jsonb_array_length(p_rows)),
    'database'
  );
end;
$$;

revoke all on function public.replace_family_goals(uuid, jsonb) from public, anon;
revoke all on function public.replace_family_barriers(uuid, jsonb) from public, anon;
revoke all on function public.replace_family_members(uuid, jsonb) from public, anon;
grant execute on function public.replace_family_goals(uuid, jsonb) to authenticated;
grant execute on function public.replace_family_barriers(uuid, jsonb) to authenticated;
grant execute on function public.replace_family_members(uuid, jsonb) to authenticated;

create or replace function public.create_plan_with_steps(
  p_family_id uuid,
  p_generation_source text,
  p_ai_model text,
  p_steps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_plan_id uuid;
  v_version integer;
  v_created_at timestamptz;
  v_step jsonb;
  v_step_id uuid;
  v_item jsonb;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if p_generation_source not in ('openai', 'rules')
    or (p_ai_model is not null and char_length(p_ai_model) > 200)
    or jsonb_typeof(p_steps) <> 'array'
    or jsonb_array_length(p_steps) not between 1 and 15 then
    raise exception 'invalid generated plan' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 0));
  select coalesce(max(version), 0) + 1 into v_version
  from public.plans where family_id = p_family_id;

  insert into public.plans (
    family_id, version, summary, generation_source, ai_model
  ) values (
    p_family_id, v_version, null, p_generation_source::public.plan_generation_source, p_ai_model
  ) returning id, created_at into v_plan_id, v_created_at;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    if v_step->>'phase' not in ('30', '60', '90')
      or jsonb_typeof(coalesce(v_step->'action_items', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_step->'action_items', '[]'::jsonb)) > 20 then
      raise exception 'invalid generated step' using errcode = '23514';
    end if;
    insert into public.plan_steps (
      plan_id, phase, title, description, status, sort_order, details, priority
    ) values (
      v_plan_id,
      (v_step->>'phase')::public.plan_phase,
      v_step->>'title',
      v_step->>'description',
      'pending',
      (v_step->>'sort_order')::integer,
      v_step->'details',
      coalesce(nullif(v_step->>'priority', ''), 'medium')
    ) returning id into v_step_id;

    for v_item in select value from jsonb_array_elements(coalesce(v_step->'action_items', '[]'::jsonb)) loop
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

  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'plan.generated', 'plan', v_plan_id::text,
    jsonb_build_object(
      'version', v_version,
      'steps', jsonb_array_length(p_steps),
      'generation_source', p_generation_source
    ),
    'database'
  );

  return jsonb_build_object(
    'planId', v_plan_id,
    'version', v_version,
    'createdAt', v_created_at,
    'stepCount', jsonb_array_length(p_steps)
  );
end;
$$;

revoke all on function public.create_plan_with_steps(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_plan_with_steps(uuid, text, text, jsonb) to authenticated;

create or replace function public.create_manual_plan_step(
  p_family_id uuid,
  p_plan_id uuid,
  p_phase text,
  p_title text,
  p_description text,
  p_target_date date,
  p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_step_id uuid;
  v_sort_order integer;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if p_phase not in ('30', '60', '90')
    or char_length(btrim(coalesce(p_title, ''))) not between 1 and 500
    or char_length(coalesce(p_description, '')) > 4000
    or p_target_date is null
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_details, '{}'::jsonb)::text) > 100000
    or public.contains_direct_identifier(p_title)
    or public.contains_direct_identifier(p_description)
    or public.contains_direct_identifier(p_details->>'stage_goal') then
    raise exception 'invalid manual plan step' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.plans p
    where p.id = p_plan_id and p.family_id = p_family_id
      and p.id = (
        select latest.id from public.plans latest
        where latest.family_id = p_family_id order by latest.version desc limit 1
      )
  ) then
    raise exception 'plan not found' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_plan_id::text, 0));
  select coalesce(max(sort_order), -1) + 1 into v_sort_order
  from public.plan_steps where plan_id = p_plan_id;
  insert into public.plan_steps (
    plan_id, phase, title, description, status, sort_order, details
  ) values (
    p_plan_id, p_phase::public.plan_phase, btrim(p_title), coalesce(p_description, ''),
    'pending', v_sort_order, coalesce(p_details, '{}'::jsonb)
  ) returning id into v_step_id;
  insert into public.plan_step_action_items (
    plan_step_id, title, description, week_index, target_date, status, sort_order
  ) values (
    v_step_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    1, p_target_date, 'pending', 0
  );
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'step.added', 'plan_step', v_step_id::text,
    jsonb_build_object('target_date', p_target_date), 'database'
  );
  return v_step_id;
end;
$$;

revoke all on function public.create_manual_plan_step(uuid, uuid, text, text, text, date, jsonb)
  from public, anon;
grant execute on function public.create_manual_plan_step(uuid, uuid, text, text, text, date, jsonb)
  to authenticated;

create or replace function public.delete_plan_step(p_family_id uuid, p_step_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  delete from public.plan_steps step
  using public.plans plan
  where step.id = p_step_id
    and step.plan_id = plan.id
    and plan.family_id = p_family_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then return false; end if;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, source
  ) values (
    p_family_id, v_actor, 'step.deleted', 'plan_step', p_step_id::text, 'database'
  );
  return true;
end;
$$;

revoke all on function public.delete_plan_step(uuid, uuid) from public, anon;
grant execute on function public.delete_plan_step(uuid, uuid) to authenticated;

create or replace function public.mark_plan_reviewed(p_family_id uuid, p_plan_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reviewed_at timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.plans p
    where p.id = p_plan_id and p.family_id = p_family_id
      and p.id = (
        select latest.id from public.plans latest
        where latest.family_id = p_family_id order by latest.version desc limit 1
      )
      and coalesce(p.generation_state->>'status', 'complete') not in ('running', 'failed')
  ) then
    raise exception 'plan is not reviewable' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.plan_step_action_items item
    join public.plan_steps step on step.id = item.plan_step_id
    where step.plan_id = p_plan_id
  ) or exists (
    select 1 from public.plan_steps step
    where step.plan_id = p_plan_id and (
      nullif(btrim(step.title), '') is null
      or nullif(btrim(step.details->>'expected_outcome'), '') is null
    )
  ) or exists (
    select 1 from public.plan_step_action_items item
    join public.plan_steps step on step.id = item.plan_step_id
    where step.plan_id = p_plan_id and (
      nullif(btrim(item.title), '') is null
      or (item.status <> 'completed' and item.target_date is null)
      or (item.status = 'blocked' and (nullif(btrim(item.notes), '') is null or item.follow_up_date is null))
    )
  ) then
    raise exception 'plan actions are incomplete' using errcode = '23514';
  end if;

  update public.plans
  set client_display = coalesce(client_display, '{}'::jsonb) || jsonb_build_object(
    'reviewedAt', v_reviewed_at,
    'reviewedById', v_actor
  )
  where id = p_plan_id and family_id = p_family_id;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'plan.reviewed', 'plan', p_plan_id::text,
    jsonb_build_object('reviewed_at', v_reviewed_at), 'database'
  );
  return v_reviewed_at;
end;
$$;

revoke all on function public.mark_plan_reviewed(uuid, uuid) from public, anon;
grant execute on function public.mark_plan_reviewed(uuid, uuid) to authenticated;

create or replace function public.start_staged_plan_generation(
  p_family_id uuid,
  p_generation_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_plan public.plans;
  v_version integer;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_generation_state) <> 'object'
    or p_generation_state->>'status' <> 'running'
    or p_generation_state->>'pending_phase' <> '30'
    or octet_length(p_generation_state::text) > 250000
    or public.contains_direct_identifier(p_generation_state::text) then
    raise exception 'invalid generation state' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 0));
  select * into v_plan from public.plans
  where family_id = p_family_id order by version desc limit 1;
  if v_plan.id is not null
    and v_plan.generation_state->>'status' = 'running'
    and v_plan.generation_state->>'v' = '1' then
    return jsonb_build_object(
      'planId', v_plan.id,
      'version', v_plan.version,
      'createdAt', v_plan.created_at,
      'existing', true
    );
  end if;

  v_version := coalesce(v_plan.version, 0) + 1;
  insert into public.plans (
    family_id, version, summary, generation_source, ai_model, generation_state
  ) values (
    p_family_id, v_version, null, 'openai', null, p_generation_state
  ) returning * into v_plan;
  insert into public.activity_log (
    family_id, actor_user_id, action, entity_type, entity_id, details, source
  ) values (
    p_family_id, v_actor, 'plan.generation_started', 'plan', v_plan.id::text,
    jsonb_build_object('version', v_version, 'staged', true), 'database'
  );
  return jsonb_build_object(
    'planId', v_plan.id,
    'version', v_version,
    'createdAt', v_plan.created_at,
    'existing', false
  );
end;
$$;

revoke all on function public.start_staged_plan_generation(uuid, jsonb) from public, anon;
grant execute on function public.start_staged_plan_generation(uuid, jsonb) to authenticated;

create or replace function public.append_staged_plan_phase(
  p_family_id uuid,
  p_plan_id uuid,
  p_phase text,
  p_steps jsonb,
  p_generation_state jsonb,
  p_ai_model text,
  p_duration_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.append_staged_plan_phase(uuid, uuid, text, jsonb, jsonb, text, integer) from public, anon;
grant execute on function public.append_staged_plan_phase(uuid, uuid, text, jsonb, jsonb, text, integer) to authenticated;

create or replace function public.update_staged_plan_state(
  p_family_id uuid,
  p_plan_id uuid,
  p_generation_state jsonb,
  p_ai_model text default null,
  p_event text default null,
  p_event_details jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.update_staged_plan_state(uuid, uuid, jsonb, text, text, jsonb)
  from public, anon;
grant execute on function public.update_staged_plan_state(uuid, uuid, jsonb, text, text, jsonb)
  to authenticated;

create or replace function public.replace_suggested_resource_matches(
  p_family_id uuid,
  p_matches jsonb,
  p_evaluated integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
      select 1 from public.resources where id = v_resource_id and active
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
$$;

revoke all on function public.replace_suggested_resource_matches(uuid, jsonb, integer)
  from public, anon;
grant execute on function public.replace_suggested_resource_matches(uuid, jsonb, integer)
  to authenticated;

create or replace function public.add_manual_resource_match(
  p_family_id uuid,
  p_resource_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_match_id uuid;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.resources where id = p_resource_id and active
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
$$;

revoke all on function public.add_manual_resource_match(uuid, uuid) from public, anon;
grant execute on function public.add_manual_resource_match(uuid, uuid) to authenticated;

create or replace function public.update_resource_match(
  p_family_id uuid,
  p_match_id uuid,
  p_operation text,
  p_status public.match_status default null,
  p_plan_step_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_updated integer;
  v_action text;
  v_details jsonb;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;

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
$$;

revoke all on function public.update_resource_match(uuid, uuid, text, public.match_status, uuid)
  from public, anon;
grant execute on function public.update_resource_match(uuid, uuid, text, public.match_status, uuid)
  to authenticated;

-- Browser JWTs can now mutate these records only through the validated,
-- transactional functions above. Service-role operations remain available.
drop policy if exists families_delete_owner_or_admin on public.families;
revoke insert, update, delete on table public.families from authenticated, anon;

drop policy if exists case_notes_insert on public.case_notes;
drop policy if exists case_notes_update_own on public.case_notes;
drop policy if exists case_notes_delete_own on public.case_notes;
revoke insert, update, delete on table public.case_notes from authenticated, anon;

revoke insert, update, delete on table public.family_goals from authenticated, anon;
revoke insert, update, delete on table public.family_barriers from authenticated, anon;
revoke insert, update, delete on table public.family_members from authenticated, anon;

-- Explicit PostgREST grants. RLS is ineffective without a clear privilege baseline,
-- and Supabase defaults can differ between local, preview, and hosted projects.
revoke all on all tables in schema public from anon, authenticated;

grant select on table
  public.app_users,
  public.families,
  public.family_case_managers,
  public.family_goals,
  public.family_barriers,
  public.family_members,
  public.case_notes,
  public.resources,
  public.resource_matches,
  public.plans,
  public.plan_steps,
  public.plan_step_resources,
  public.referrals,
  public.tasks,
  public.activity_log,
  public.plan_step_activity,
  public.plan_step_action_items
to authenticated;

grant update (
  display_name,
  job_title,
  organization,
  phone,
  pronouns,
  service_area,
  bio,
  preferred_contact_method,
  notes_signature
) on table public.app_users to authenticated;

grant update (summary, client_display) on table public.plans to authenticated;
grant update (
  title, description, status, details, workflow_data, priority, phase, sort_order
) on table public.plan_steps to authenticated;
grant update (
  title, description, week_index, target_date, status, outcome, notes, follow_up_date
) on table public.plan_step_action_items to authenticated;
revoke insert, update, delete on table public.app_users, public.family_case_managers from service_role;
grant select, insert, update, delete on table
  public.families,
  public.family_goals,
  public.family_barriers,
  public.family_members,
  public.case_notes,
  public.resources,
  public.resource_matches,
  public.plans,
  public.plan_steps,
  public.plan_step_resources,
  public.referrals,
  public.tasks,
  public.plan_step_activity,
  public.plan_step_action_items,
  public.resource_import_runs,
  public.barrier_plan_records,
  public.demo_requests
to service_role;
grant select on table public.app_users, public.family_case_managers to service_role;
revoke insert, update, delete on table public.activity_log from service_role;
grant select on table public.activity_log to service_role;
