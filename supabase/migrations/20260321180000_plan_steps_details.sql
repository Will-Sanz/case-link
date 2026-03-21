-- Add JSONB details column for rich plan step content (checklist, contacts, blockers, etc.)
alter table public.plan_steps
  add column if not exists details jsonb default null;

comment on column public.plan_steps.details is 'Rich structured content: rationale, checklist, required_documents, contacts, blockers, fallback_options, expected_outcome, timing_guidance, priority';
