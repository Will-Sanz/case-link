-- Child action items under plan steps: smaller, weekly-scheduled tasks
create table public.plan_step_action_items (
  id uuid primary key default gen_random_uuid(),
  plan_step_id uuid not null references public.plan_steps (id) on delete cascade,
  title text not null,
  description text,
  week_index int not null default 1,
  target_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'blocked')),
  sort_order int not null default 0,
  outcome text,
  notes text,
  follow_up_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plan_step_action_items_step_idx on public.plan_step_action_items (plan_step_id);
create index plan_step_action_items_target_date_idx on public.plan_step_action_items (target_date);

create trigger plan_step_action_items_set_updated_at
before update on public.plan_step_action_items
for each row execute function public.set_updated_at();

alter table public.plan_step_action_items enable row level security;

-- RLS: same as plan_steps (via plan -> family)
create policy plan_step_action_items_select on public.plan_step_action_items
  for select to authenticated
  using (
    exists (
      select 1 from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = plan_step_action_items.plan_step_id
      and public.can_access_family(p.family_id)
    )
  );

create policy plan_step_action_items_insert on public.plan_step_action_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = plan_step_action_items.plan_step_id
      and public.can_access_family(p.family_id)
    )
  );

create policy plan_step_action_items_update on public.plan_step_action_items
  for update to authenticated
  using (
    exists (
      select 1 from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = plan_step_action_items.plan_step_id
      and public.can_access_family(p.family_id)
    )
  );

create policy plan_step_action_items_delete on public.plan_step_action_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = plan_step_action_items.plan_step_id
      and public.can_access_family(p.family_id)
    )
  );
