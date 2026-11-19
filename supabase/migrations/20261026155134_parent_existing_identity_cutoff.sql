-- Bound a connected pilot to identities already present, without changing shared Auth enrollment.
alter table parent_private.processing_controls
  add column existing_identity_created_before timestamptz;

create or replace function parent_private.existing_account_available(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((
    select c.existing_identity_created_before is null or exists(
      select 1 from auth.users u where u.id=p_user and u.created_at<=c.existing_identity_created_before
    ) from parent_private.processing_controls c where c.singleton
  ),false) and (
    not exists(select 1 from public.app_users a where a.id=p_user)
    or (coalesce((select existing_accounts_enabled from parent_private.processing_controls where singleton),false)
      and exists(select 1 from public.app_users a where a.id=p_user and a.is_active))
  );
$$;
revoke execute on function parent_private.existing_account_available(uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
