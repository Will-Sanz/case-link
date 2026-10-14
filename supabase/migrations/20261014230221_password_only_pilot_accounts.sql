-- The pilot uses password-only accounts. Preserve every other access boundary.
-- Auth factors must be removed through the Auth API before disabling verification.
do $$
begin
  if exists (select 1 from auth.mfa_factors where status = 'verified') then
    raise exception 'Remove enrolled CaseLink factors through the Auth admin API before this migration';
  end if;
end;
$$;

create or replace function public.is_active_app_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_password_session() and exists (
    select 1 from public.app_users u join auth.sessions s on s.user_id = u.id
    where u.id = (select auth.uid()) and u.is_active
      and s.id = (select nullif(auth.jwt()->>'session_id', '')::uuid)
      and (s.not_after is null or s.not_after > now())
  );
$$;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_app_user() and exists (
    select 1 from public.app_users where id = (select auth.uid()) and role = 'admin'
  );
$$;

drop function public.has_required_mfa();
drop function public.operator_revoke_mfa_sessions(uuid, text, text, text);
-- Historical MFA audit events remain intact.
