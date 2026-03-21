-- AI execution-assistance content saved on plan steps
alter table public.plan_steps
  add column if not exists ai_helper_data jsonb default null;

comment on column public.plan_steps.ai_helper_data is 'Saved AI helper content: call_script, email_draft, prep_checklist, fallback_options, family_explanation, next_step_guidance, action_needed_now, last_assisted_at';
