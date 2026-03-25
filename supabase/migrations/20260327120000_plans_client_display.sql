-- Optional user-facing title and per-phase section blurbs for 30/60/90 plans.
alter table public.plans
  add column if not exists client_display jsonb not null default '{}'::jsonb;

comment on column public.plans.client_display is
  'UI overrides: { "title"?: string, "phaseSummaries"?: { "30"?, "60"?, "90"? } }';
