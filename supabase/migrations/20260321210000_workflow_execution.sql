-- Step-level activity timeline
create table if not exists public.plan_step_activity (
  id uuid primary key default gen_random_uuid(),
  plan_step_id uuid not null references public.plan_steps (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  actor_user_id uuid references public.app_users (id),
  action text not null,
  activity_type text,
  notes text,
  details jsonb default '{}',
  created_at timestamptz not null default now()
);

create index plan_step_activity_step_idx on public.plan_step_activity (plan_step_id);
create index plan_step_activity_family_idx on public.plan_step_activity (family_id);
create index plan_step_activity_created_idx on public.plan_step_activity (created_at);

-- Link resource matches to plan steps (accepted resource used in plan)
alter table public.resource_matches
  add column if not exists plan_step_id uuid references public.plan_steps (id) on delete set null;

create index resource_matches_plan_step_idx on public.resource_matches (plan_step_id);

-- Add priority to plan_steps (low, medium, high, urgent)
alter table public.plan_steps
  add column if not exists priority text default 'medium' check (priority in ('low', 'medium', 'high', 'urgent'));

-- RLS for plan_step_activity
alter table public.plan_step_activity enable row level security;

create policy plan_step_activity_select on public.plan_step_activity
  for select to authenticated
  using (public.can_access_family(family_id));

create policy plan_step_activity_insert on public.plan_step_activity
  for insert to authenticated
  with check (public.can_access_family(family_id));
