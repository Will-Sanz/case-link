-- Referrals and tasks: same family access boundary as plans (creator / assignee / admin).
-- Tables had RLS enabled in init with no policies, so authenticated JWT could not use them.
-- These policies allow normal case-manager access when the app starts using these tables.

create policy referrals_select on public.referrals
  for select to authenticated
  using (public.can_access_family(family_id));

create policy referrals_insert on public.referrals
  for insert to authenticated
  with check (public.can_access_family(family_id));

create policy referrals_update on public.referrals
  for update to authenticated
  using (public.can_access_family(family_id))
  with check (public.can_access_family(family_id));

create policy referrals_delete on public.referrals
  for delete to authenticated
  using (public.can_access_family(family_id));

create policy tasks_select on public.tasks
  for select to authenticated
  using (public.can_access_family(family_id));

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.can_access_family(family_id));

create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_access_family(family_id))
  with check (public.can_access_family(family_id));

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.can_access_family(family_id));
