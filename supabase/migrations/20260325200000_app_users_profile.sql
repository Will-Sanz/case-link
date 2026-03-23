-- Case manager profile / workspace fields (extends public.app_users).
-- RLS: existing app_users_update_self applies; no policy change needed.

alter table public.app_users
  add column if not exists display_name text,
  add column if not exists job_title text,
  add column if not exists organization text,
  add column if not exists phone text,
  add column if not exists pronouns text,
  add column if not exists service_area text,
  add column if not exists bio text,
  add column if not exists preferred_contact_method text,
  add column if not exists notes_signature text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_preferred_contact_method_check'
  ) then
    alter table public.app_users
      add constraint app_users_preferred_contact_method_check
      check (
        preferred_contact_method is null
        or preferred_contact_method in ('email', 'phone', 'either')
      );
  end if;
end $$;

comment on column public.app_users.display_name is 'Case manager full name (workspace profile)';
comment on column public.app_users.job_title is 'Work title, distinct from auth role';
comment on column public.app_users.preferred_contact_method is 'email | phone | either';
