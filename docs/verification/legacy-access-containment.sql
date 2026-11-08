-- Target only the restored legacy project after explicit live-change approval.
-- Reversible permission changes; no rows, accounts, roles or assignments are rewritten.
begin;
revoke insert, update, delete, truncate, references, trigger
  on table public.app_users from public, anon, authenticated;
grant update (
  display_name, job_title, organization, phone, pronouns, service_area,
  bio, preferred_contact_method, notes_signature
) on table public.app_users to authenticated;
revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.can_access_family(uuid) from public, anon;
revoke all on function public.create_family_intake_row(text, text, public.family_urgency, text, public.family_status)
  from public, anon;
alter function public.set_updated_at() set search_path = '';
commit;
