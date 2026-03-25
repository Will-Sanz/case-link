-- Tracks in-progress staged plan generation (30 → 60 → 90) for progressive UX and safe reload.
alter table public.plans
  add column if not exists generation_state jsonb;

comment on column public.plans.generation_state is
  'Staged generation: { v, status, pending_phase, planning_brief, phases_complete, models_used, stage_timings_ms, error }';
