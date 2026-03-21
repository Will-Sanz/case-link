-- Case management domain schema (Supabase Postgres)
-- IDs align with auth: app_users.id = auth.users.id

create extension if not exists "pgcrypto";

-- ——— enums ———
create type public.user_role as enum ('admin', 'case_manager');
create type public.family_urgency as enum ('low', 'medium', 'high', 'crisis');
create type public.family_status as enum ('active', 'on_hold', 'closed');
create type public.match_status as enum ('suggested', 'accepted', 'dismissed');
create type public.plan_generation_source as enum ('openai', 'rules', 'manual');
create type public.plan_phase as enum ('30', '60', '90');
create type public.plan_step_status as enum ('pending', 'in_progress', 'completed', 'blocked');
create type public.referral_status as enum (
  'planned',
  'attempted',
  'in_progress',
  'connected',
  'closed'
);
create type public.task_source as enum ('manual', 'plan_step', 'ai');

-- ——— updated_at ———
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ——— app_users (case managers / admins) ———
create table public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role public.user_role not null default 'case_manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

-- ——— families ———
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  summary text,
  urgency public.family_urgency,
  household_notes text,
  status public.family_status not null default 'active',
  created_by_id uuid not null references public.app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index families_created_by_id_idx on public.families (created_by_id);
create index families_status_idx on public.families (status);

create trigger families_set_updated_at
before update on public.families
for each row execute function public.set_updated_at();

create table public.family_case_managers (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references public.app_users (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table public.family_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  preset_key text,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index family_goals_family_id_idx on public.family_goals (family_id);

create table public.family_barriers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  preset_key text,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index family_barriers_family_id_idx on public.family_barriers (family_id);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  display_name text not null,
  relationship text,
  notes text,
  age_approx int,
  created_at timestamptz not null default now()
);

create index family_members_family_id_idx on public.family_members (family_id);

create table public.case_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  author_id uuid not null references public.app_users (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index case_notes_family_id_idx on public.case_notes (family_id);

-- ——— resources (CSV directory) ———
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  active boolean not null default true,
  import_key text not null unique,
  office_or_department text not null,
  program_name text not null,
  description text,
  category text,
  invite_march_partner_fair boolean,
  partner_fair_attended text,
  recruit_for_grocery_giveaways boolean,
  primary_contact_name text,
  primary_contact_title text,
  primary_contact_email text,
  primary_contact_phone text,
  primary_contact_phone_norm text,
  secondary_contact_name text,
  secondary_contact_title text,
  secondary_contact_email text,
  secondary_contact_phone text,
  secondary_contact_phone_norm text,
  services_select_all text,
  additional_info text,
  tabling_at_events boolean not null default false,
  promotional_materials boolean not null default false,
  educational_workshops boolean not null default false,
  volunteer_recruitment_support boolean not null default false,
  tags text[] not null default '{}',
  search_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger resources_set_updated_at
before update on public.resources
for each row execute function public.set_updated_at();

create table public.resource_matches (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  match_reason text not null,
  score double precision not null,
  status public.match_status not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, resource_id)
);

create index resource_matches_family_id_idx on public.resource_matches (family_id);

create trigger resource_matches_set_updated_at
before update on public.resource_matches
for each row execute function public.set_updated_at();

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  version int not null,
  summary text,
  generation_source public.plan_generation_source not null default 'rules',
  ai_model text,
  created_at timestamptz not null default now(),
  unique (family_id, version)
);

create index plans_family_id_idx on public.plans (family_id);

create table public.plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  phase public.plan_phase not null,
  title text not null,
  description text not null,
  status public.plan_step_status not null default 'pending',
  due_date timestamptz,
  assigned_to_id uuid references public.app_users (id),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plan_steps_plan_id_idx on public.plan_steps (plan_id);

create trigger plan_steps_set_updated_at
before update on public.plan_steps
for each row execute function public.set_updated_at();

create table public.plan_step_resources (
  plan_step_id uuid not null references public.plan_steps (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  primary key (plan_step_id, resource_id)
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  resource_id uuid references public.resources (id),
  organization_label text not null,
  contact_person text,
  contact_attempted_at timestamptz,
  method text,
  status public.referral_status not null default 'planned',
  outcome text,
  next_follow_up_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index referrals_family_id_idx on public.referrals (family_id);

create trigger referrals_set_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title text not null,
  description text,
  completed boolean not null default false,
  completed_at timestamptz,
  source public.task_source not null default 'manual',
  plan_step_id uuid references public.plan_steps (id),
  created_by_id uuid references public.app_users (id),
  due_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_family_id_idx on public.tasks (family_id);

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  actor_user_id uuid references public.app_users (id),
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_family_id_idx on public.activity_log (family_id);
create index activity_log_created_at_idx on public.activity_log (created_at);

create table public.resource_import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_path text,
  row_count int not null default 0,
  success_count int not null default 0,
  error_count int not null default 0,
  error_log jsonb
);

-- ——— RLS ———
alter table public.app_users enable row level security;
alter table public.families enable row level security;
alter table public.family_case_managers enable row level security;
alter table public.family_goals enable row level security;
alter table public.family_barriers enable row level security;
alter table public.family_members enable row level security;
alter table public.case_notes enable row level security;
alter table public.resources enable row level security;
alter table public.resource_matches enable row level security;
alter table public.plans enable row level security;
alter table public.plan_steps enable row level security;
alter table public.plan_step_resources enable row level security;
alter table public.referrals enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_log enable row level security;
alter table public.resource_import_runs enable row level security;

-- app_users: self read / insert / update
create policy app_users_select_self on public.app_users
  for select to authenticated
  using (id = (select auth.uid()));

create policy app_users_insert_self on public.app_users
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy app_users_update_self on public.app_users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- resources: signed-in users can read (MVP). Other tables: RLS on with no policies yet =
-- no access via anon/authenticated JWT until you add policies (service role bypasses RLS).
create policy resources_select_authenticated on public.resources
  for select to authenticated
  using (true);
