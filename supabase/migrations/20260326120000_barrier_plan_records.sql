-- barrier_plan_records: snapshot of generated barrier workflow per user.
-- Prerequisites (run earlier migrations first): public.app_users, public.families,
-- extension pgcrypto (for gen_random_uuid), public.set_updated_at() from init_schema.

create table if not exists public.barrier_plan_records (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.app_users(id) on delete cascade,
  reference_id text not null,
  family_id uuid not null references public.families(id) on delete cascade,
  selected_barriers jsonb not null default '[]'::jsonb,
  additional_details text,
  generated_plan_json jsonb,
  matched_resources_json jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, reference_id)
);

create index if not exists idx_barrier_plan_records_owner_updated
  on public.barrier_plan_records (owner_user_id, updated_at desc);

alter table public.barrier_plan_records enable row level security;

drop policy if exists barrier_plan_records_select on public.barrier_plan_records;
create policy barrier_plan_records_select
  on public.barrier_plan_records
  for select
  using (owner_user_id = auth.uid());

drop policy if exists barrier_plan_records_insert on public.barrier_plan_records;
create policy barrier_plan_records_insert
  on public.barrier_plan_records
  for insert
  with check (owner_user_id = auth.uid());

drop policy if exists barrier_plan_records_update on public.barrier_plan_records;
create policy barrier_plan_records_update
  on public.barrier_plan_records
  for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists barrier_plan_records_delete on public.barrier_plan_records;
create policy barrier_plan_records_delete
  on public.barrier_plan_records
  for delete
  using (owner_user_id = auth.uid());

-- Reuse shared trigger fn from init_schema (avoids duplicate trigger functions).
drop trigger if exists trg_barrier_plan_records_updated_at on public.barrier_plan_records;
drop trigger if exists barrier_plan_records_set_updated_at on public.barrier_plan_records;
drop function if exists public.set_updated_at_barrier_plan_records();

create trigger barrier_plan_records_set_updated_at
before update on public.barrier_plan_records
for each row execute function public.set_updated_at();
