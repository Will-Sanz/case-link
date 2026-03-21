-- Plans / plan_steps / plan_step_resources: same access boundary as the family.
-- Requires can_access_family from 20260321120000_family_rls.sql.

create policy plans_select on public.plans
  for select to authenticated
  using (public.can_access_family(family_id));

create policy plans_insert on public.plans
  for insert to authenticated
  with check (public.can_access_family(family_id));

create policy plans_update on public.plans
  for update to authenticated
  using (public.can_access_family(family_id))
  with check (public.can_access_family(family_id));

create policy plans_delete on public.plans
  for delete to authenticated
  using (public.can_access_family(family_id));

create policy plan_steps_select on public.plan_steps
  for select to authenticated
  using (
    exists (
      select 1 from public.plans p
      where p.id = plan_steps.plan_id and public.can_access_family(p.family_id)
    )
  );

create policy plan_steps_insert on public.plan_steps
  for insert to authenticated
  with check (
    exists (
      select 1 from public.plans p
      where p.id = plan_steps.plan_id and public.can_access_family(p.family_id)
    )
  );

create policy plan_steps_update on public.plan_steps
  for update to authenticated
  using (
    exists (
      select 1 from public.plans p
      where p.id = plan_steps.plan_id and public.can_access_family(p.family_id)
    )
  )
  with check (
    exists (
      select 1 from public.plans p
      where p.id = plan_steps.plan_id and public.can_access_family(p.family_id)
    )
  );

create policy plan_steps_delete on public.plan_steps
  for delete to authenticated
  using (
    exists (
      select 1 from public.plans p
      where p.id = plan_steps.plan_id and public.can_access_family(p.family_id)
    )
  );

create policy plan_step_resources_select on public.plan_step_resources
  for select to authenticated
  using (
    exists (
      select 1 from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = plan_step_resources.plan_step_id
        and public.can_access_family(p.family_id)
    )
  );

create policy plan_step_resources_insert on public.plan_step_resources
  for insert to authenticated
  with check (
    exists (
      select 1 from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = plan_step_resources.plan_step_id
        and public.can_access_family(p.family_id)
    )
  );

create policy plan_step_resources_delete on public.plan_step_resources
  for delete to authenticated
  using (
    exists (
      select 1 from public.plan_steps ps
      join public.plans p on p.id = ps.plan_id
      where ps.id = plan_step_resources.plan_step_id
        and public.can_access_family(p.family_id)
    )
  );
