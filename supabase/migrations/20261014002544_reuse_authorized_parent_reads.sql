-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

DROP POLICY plan_step_action_items_select ON public.plan_step_action_items;

DROP POLICY plan_steps_select ON public.plan_steps;

DROP POLICY plans_select ON public.plans;

CREATE POLICY plan_step_action_items_select ON public.plan_step_action_items
  FOR SELECT
  TO authenticated
  USING ((plan_step_id IN ( SELECT plan_steps.id
   FROM public.plan_steps)));

CREATE POLICY plan_steps_select ON public.plan_steps
  FOR SELECT
  TO authenticated
  USING ((plan_id IN ( SELECT plans.id
   FROM public.plans)));

CREATE POLICY plans_select ON public.plans
  FOR SELECT
  TO authenticated
  USING ((family_id IN ( SELECT families.id
   FROM public.families)));
