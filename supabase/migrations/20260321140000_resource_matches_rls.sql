-- Resource matches: same access boundary as the family.

create policy resource_matches_select on public.resource_matches
  for select to authenticated
  using (public.can_access_family(family_id));

create policy resource_matches_insert on public.resource_matches
  for insert to authenticated
  with check (public.can_access_family(family_id));

create policy resource_matches_update on public.resource_matches
  for update to authenticated
  using (public.can_access_family(family_id))
  with check (public.can_access_family(family_id));

create policy resource_matches_delete on public.resource_matches
  for delete to authenticated
  using (public.can_access_family(family_id));
