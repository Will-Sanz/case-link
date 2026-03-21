-- Family domain RLS: creators, assignees, and admins can access; helpers are SECURITY DEFINER.

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
  );
$$;

create or replace function public.can_access_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_app_admin()
    or exists (
      select 1
      from public.families f
      where f.id = p_family_id
        and f.created_by_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.family_case_managers m
      where m.family_id = p_family_id
        and m.user_id = (select auth.uid())
    );
$$;

grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.can_access_family(uuid) to authenticated;

-- Peers: read creator / assignee / case-note author emails for families you can access.
create policy app_users_select_family_peers on public.app_users
  for select to authenticated
  using (
    exists (
      select 1
      from public.families f
      where f.created_by_id = app_users.id
        and public.can_access_family(f.id)
    )
    or exists (
      select 1
      from public.family_case_managers m
      where m.user_id = app_users.id
        and public.can_access_family(m.family_id)
    )
    or exists (
      select 1
      from public.case_notes cn
      where cn.author_id = app_users.id
        and public.can_access_family(cn.family_id)
    )
  );

-- ——— families ———
create policy families_select_access on public.families
  for select to authenticated
  using (public.can_access_family(id));

create policy families_insert_creator on public.families
  for insert to authenticated
  with check (created_by_id = (select auth.uid()));

create policy families_update_access on public.families
  for update to authenticated
  using (public.can_access_family(id))
  with check (public.can_access_family(id));

create policy families_delete_owner_or_admin on public.families
  for delete to authenticated
  using (
    public.is_app_admin()
    or created_by_id = (select auth.uid())
  );

-- ——— family_case_managers ———
create policy family_case_managers_select on public.family_case_managers
  for select to authenticated
  using (public.can_access_family(family_id));

create policy family_case_managers_insert on public.family_case_managers
  for insert to authenticated
  with check (
    public.can_access_family(family_id)
    and (
      public.is_app_admin()
      or exists (
        select 1
        from public.families f
        where f.id = family_id
          and f.created_by_id = (select auth.uid())
      )
    )
  );

create policy family_case_managers_delete on public.family_case_managers
  for delete to authenticated
  using (
    public.is_app_admin()
    or exists (
      select 1
      from public.families f
      where f.id = family_id
        and f.created_by_id = (select auth.uid())
    )
  );

-- ——— family_goals / family_barriers / family_members ———
create policy family_goals_all on public.family_goals
  for all to authenticated
  using (public.can_access_family(family_id))
  with check (public.can_access_family(family_id));

create policy family_barriers_all on public.family_barriers
  for all to authenticated
  using (public.can_access_family(family_id))
  with check (public.can_access_family(family_id));

create policy family_members_all on public.family_members
  for all to authenticated
  using (public.can_access_family(family_id))
  with check (public.can_access_family(family_id));

-- ——— case_notes ———
create policy case_notes_select on public.case_notes
  for select to authenticated
  using (public.can_access_family(family_id));

create policy case_notes_insert on public.case_notes
  for insert to authenticated
  with check (
    public.can_access_family(family_id)
    and author_id = (select auth.uid())
  );

create policy case_notes_update_own on public.case_notes
  for update to authenticated
  using (author_id = (select auth.uid()) or public.is_app_admin())
  with check (author_id = (select auth.uid()) or public.is_app_admin());

create policy case_notes_delete_own on public.case_notes
  for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_app_admin());

-- ——— activity_log (intake + future audit) ———
create policy activity_log_select on public.activity_log
  for select to authenticated
  using (public.can_access_family(family_id));

create policy activity_log_insert on public.activity_log
  for insert to authenticated
  with check (
    public.can_access_family(family_id)
    and (
      actor_user_id is null
      or actor_user_id = (select auth.uid())
    )
  );
