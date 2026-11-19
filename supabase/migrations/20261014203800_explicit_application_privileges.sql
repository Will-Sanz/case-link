-- Old Supabase defaults must not survive as implicit access in upgraded projects.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated, service_role;
-- PostgreSQL's built-in PUBLIC function grant can only be revoked globally for the creator role.
alter default privileges for role postgres revoke execute on functions from public;

revoke truncate, references, trigger, maintain on all tables in schema public
  from public, anon, authenticated, service_role;
revoke select, insert, update, delete on public.case_progress_updates from service_role;

revoke execute on all functions in schema public from public, anon, service_role;
grant execute on function public.contains_direct_identifier(text) to authenticated, service_role;
grant execute on function
  public.operator_set_user_role(uuid, public.user_role, text, text, text),
  public.operator_set_family_assignment(uuid, uuid, boolean, text, text),
  public.operator_offboard_user(uuid, uuid, text, text),
  public.operator_revoke_mfa_sessions(uuid, text, text, text),
  public.canonical_plan_contacts(uuid, jsonb),
  public.plan_contacts_current(uuid, jsonb)
  to service_role;

-- Trigger execution keeps working without making trigger functions callable as browser RPCs.
do $$
declare routine regprocedure;
begin
  for routine in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    execute format('revoke execute on function %s from authenticated', routine);
  end loop;
end $$;
