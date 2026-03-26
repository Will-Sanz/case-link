-- Soft-remove families from workspace lists without deleting rows.
alter table public.families
  add column if not exists archived_at timestamptz null;

comment on column public.families.archived_at is
  'When set, family is hidden from default lists and workspace routes; data is retained.';

create index if not exists families_archived_at_list_idx
  on public.families (archived_at)
  where archived_at is null;
