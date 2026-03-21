-- Checklist completion stored in workflow_data.checklist_completed (array of booleans)
-- Step refinement: log in plan_step_activity with action 'step.refined'
-- No new columns; workflow_data and plan_step_activity already support this.

comment on column public.plan_steps.workflow_data is 'Case manager data: blocker_reason, outcome_notes, contact_attempted_at, outreach_result, needs_escalation, documents_received, family_understood, case_manager_assisted, checklist_completed (boolean[] for each checklist item)';
