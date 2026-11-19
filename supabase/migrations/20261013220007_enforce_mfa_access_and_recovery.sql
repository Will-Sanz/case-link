-- Require current verified MFA for administrators and enrolled staff.

ALTER TABLE public.security_audit_log
  DROP CONSTRAINT security_audit_action_check;

CREATE FUNCTION public.has_required_mfa()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1 from public.app_users u
    where u.id = (select auth.uid()) and u.is_active and (
      (u.role <> 'admin' and not exists (
        select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'
      ))
      or (
        (select auth.jwt()->>'aal') = 'aal2'
        and exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
        and exists (
          select 1 from auth.sessions s
          where s.id = (select nullif(auth.jwt()->>'session_id', '')::uuid)
            and s.user_id = u.id and s.aal = 'aal2'
            and (s.not_after is null or s.not_after > now())
        )
      )
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.has_required_mfa() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_required_mfa() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_active_app_user()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select public.has_password_session() and public.has_required_mfa() and exists (
    select 1 from public.app_users u join auth.sessions s on s.user_id = u.id
    where u.id = (select auth.uid()) and u.is_active
      and s.id = (select nullif(auth.jwt()->>'session_id', '')::uuid)
      and (s.not_after is null or s.not_after > now())
  );
$function$;

CREATE FUNCTION public.operator_revoke_mfa_sessions (
  p_target_user_id uuid,
  p_actor_label    text,
  p_reason         text,
  p_stage          text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_stage not in ('started', 'ready') or p_stage is null
    or char_length(btrim(coalesce(p_actor_label, ''))) not between 3 and 200
    or char_length(btrim(coalesce(p_reason, ''))) not between 8 and 1000 then
    raise exception 'invalid recovery audit input' using errcode = '23514';
  end if;
  perform 1 from public.app_users where id = p_target_user_id and is_active for update;
  if not found then raise exception 'active account required' using errcode = '42501'; end if;
  if p_stage = 'ready' and exists (
    select 1 from auth.mfa_factors where user_id = p_target_user_id and status = 'verified'
  ) then raise exception 'authenticator removal is incomplete' using errcode = '23514'; end if;
  delete from auth.sessions where user_id = p_target_user_id;
  insert into public.security_audit_log (actor_label, action, target_user_id, reason, details)
  values (btrim(p_actor_label), 'user.mfa_recovery_' || p_stage, p_target_user_id, btrim(p_reason), '{}');
end;
$function$;

REVOKE ALL ON FUNCTION public.operator_revoke_mfa_sessions(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.operator_revoke_mfa_sessions(uuid, text, text, text) TO service_role;

ALTER TABLE public.security_audit_log
  ADD CONSTRAINT security_audit_action_check
    CHECK
    (action = ANY (ARRAY['user.invited'::text, 'user.role_changed'::text, 'user.disabled'::text, 'user.deleted'::text, 'user.mfa_recovery_started'::text,
    'user.mfa_recovery_ready'::text, 'family.assignment_added'::text, 'family.assignment_removed'::text]));
