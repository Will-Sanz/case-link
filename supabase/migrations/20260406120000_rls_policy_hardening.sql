-- Hardening: barrier_plan_records policies apply to authenticated sessions only;
-- plan_step_activity inserts must not spoof actor_user_id; resource_import_runs
-- is denied for anon/authenticated JWTs (service role bypasses RLS for import scripts).

-- barrier_plan_records: owner-only access for the authenticated role
drop policy if exists barrier_plan_records_select on public.barrier_plan_records;
create policy barrier_plan_records_select on public.barrier_plan_records
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists barrier_plan_records_insert on public.barrier_plan_records;
create policy barrier_plan_records_insert on public.barrier_plan_records
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()));

drop policy if exists barrier_plan_records_update on public.barrier_plan_records;
create policy barrier_plan_records_update on public.barrier_plan_records
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists barrier_plan_records_delete on public.barrier_plan_records;
create policy barrier_plan_records_delete on public.barrier_plan_records
  for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- plan_step_activity: family access plus actor_user_id must match caller (or be null)
drop policy if exists plan_step_activity_insert on public.plan_step_activity;
create policy plan_step_activity_insert on public.plan_step_activity
  for insert to authenticated
  with check (
    public.can_access_family(family_id)
    and (actor_user_id is null or actor_user_id = (select auth.uid()))
  );

-- resource_import_runs: explicit deny for JWT roles (no change vs default deny if no allow policies)
drop policy if exists resource_import_runs_deny_authenticated on public.resource_import_runs;
create policy resource_import_runs_deny_authenticated on public.resource_import_runs
  for all to authenticated
  using (false)
  with check (false);

drop policy if exists resource_import_runs_deny_anon on public.resource_import_runs;
create policy resource_import_runs_deny_anon on public.resource_import_runs
  for all to anon
  using (false)
  with check (false);
