-- Invitation/recovery OTP sessions cannot use casework until a real password sign-in.
-- The AMR claim is signed by Auth, unlike client-editable user_metadata.
create function public.has_password_session()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr' else '[]'::jsonb end
    ) method where method->>'method' = 'password'
  );
$$;
revoke all on function public.has_password_session() from public, anon;
grant execute on function public.has_password_session() to authenticated;

create or replace function public.is_active_app_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_password_session() and exists (
    select 1 from public.app_users u join auth.sessions s on s.user_id = u.id
    where u.id = (select auth.uid()) and u.is_active
      and s.id = (select nullif(auth.jwt()->>'session_id', '')::uuid)
      and (s.not_after is null or s.not_after > now())
  );
$$;
