-- Add interaction/workflow fields for case manager actions
-- Stores: blocker_reason, outcome_notes, contact_attempted_at, outreach_result,
--         needs_escalation, documents_received, family_understood, case_manager_assisted
alter table public.plan_steps
  add column if not exists workflow_data jsonb default null;

comment on column public.plan_steps.workflow_data is 'Case manager interaction data: blocker_reason, outcome_notes, contact_attempted_at, outreach_result, needs_escalation, documents_received, family_understood, case_manager_assisted';
