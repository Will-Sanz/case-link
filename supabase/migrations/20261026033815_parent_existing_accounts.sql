-- Reuse an Auth identity without inheriting school roles or school case records.
alter table parent_private.processing_controls
  add column existing_accounts_enabled boolean not null default false;

create function parent_private.existing_account_available(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.app_users a where a.id=p_user)
    or (coalesce((select existing_accounts_enabled from parent_private.processing_controls where singleton),false)
      and exists(select 1 from public.app_users a where a.id=p_user and a.is_active));
$$;
revoke execute on function parent_private.existing_account_available(uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create or replace function parent_private.verified_identity() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<now())
      and not coalesce(u.is_anonymous,false)
      and s.id=(select nullif(auth.jwt()->>'session_id','')::uuid)
      and (s.not_after is null or s.not_after>now())
      and parent_private.existing_account_available(u.id)
      and (not exists(select 1 from public.app_users a where a.id=u.id) or public.has_password_session()));
$$;

create or replace function parent_private.current_grant(p_request uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id
    where r.id=p_request and r.version=p_version and r.status='active' and r.mandate_revoked_at is null
      and a.status='active' and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')) and (u.banned_until is null or u.banned_until<now())
      and parent_private.existing_account_available(a.id)
      and (r.mandate->>'expiresAt')::timestamptz>now());
$$;

create or replace function parent_private.notification_allowed(p_request uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select (parent_private.current_grant(p_request,p_version) or exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id where r.id=p_request and r.version=p_version and r.status='closed' and r.closed_reason in ('completed','all_permitted_routes_exhausted') and (r.mandate->>'expiresAt')::timestamptz>now() and a.status='active' and (u.banned_until is null or u.banned_until<now()) and parent_private.processing_enabled() and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')) and exists(select 1 from parent_private.notification_outbox n where n.request_id=r.id and n.request_version=r.version and n.completion_notice and n.created_at>now()-interval '24 hours'))) and exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id where r.id=p_request and parent_private.existing_account_available(a.id) and r.intake->>'contactPreference'='email' and a.preferences->>'contactPreference'='email' and u.email_confirmed_at is not null and length(coalesce(u.email,''))>0);
$$;
