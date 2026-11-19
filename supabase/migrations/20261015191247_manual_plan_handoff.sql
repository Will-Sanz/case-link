-- Explicit human recovery of a failed draft. Saved actions and context stay intact.
-- This ends the AI job; it does not record successful AI generation or approve the plan.
CREATE FUNCTION public.continue_plan_manually(
  p_family_id uuid,
  p_plan_id uuid,
  p_expected_revision text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
declare
  v_actor uuid := (select auth.uid());
  v_plan public.plans;
  v_snapshot jsonb;
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  -- Match the worker's lease-before-plan lock order. A late worker cannot retain
  -- authority after the handoff, even if its provider request is still running.
  perform 1 from private.ai_job_claims
    where family_id = p_family_id and job_key = 'staged-plan-advance' for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_plan_id::text, 0));
  select * into v_plan from public.plans where id = p_plan_id and family_id = p_family_id for update;
  v_snapshot := public.get_family_plan_snapshot(p_family_id)->'plan';
  if v_plan.id is null or v_snapshot->>'id' is distinct from p_plan_id::text
    or p_expected_revision is null or v_snapshot->>'review_revision' is distinct from p_expected_revision
    or v_plan.generation_state->>'status' is distinct from 'failed' then
    raise exception 'draft changed; reload before continuing manually' using errcode = '40001';
  end if;

  update public.plans
    set generation_source = 'manual',
        generation_state = generation_state || jsonb_build_object(
          'status', 'complete', 'pending_phase', null, 'completion_method', 'manual'
        ),
        client_display = coalesce(client_display, '{}'::jsonb) - 'reviewedAt' - 'reviewedById' - 'reviewedRevision'
    where id = p_plan_id;
  delete from private.ai_job_claims where family_id = p_family_id and job_key = 'staged-plan-advance';
  insert into public.activity_log(family_id, actor_user_id, action, entity_type, entity_id, details, source)
    values(p_family_id, v_actor, 'plan.continued_manually', 'plan', p_plan_id::text,
      jsonb_build_object('previous_source', v_plan.generation_source,
        'saved_steps', (select count(*) from public.plan_steps where plan_id = p_plan_id)), 'database');
  return true;
end;
$$;

REVOKE ALL ON FUNCTION public.continue_plan_manually(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.continue_plan_manually(uuid, uuid, text) TO authenticated;
