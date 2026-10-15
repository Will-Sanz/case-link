-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.get_family_next_work (
  p_family_ids uuid[]
)
  RETURNS TABLE (
    family_id    uuid,
    current_step jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  if p_family_ids is null or cardinality(p_family_ids) > 100 or coalesce(array_ndims(p_family_ids), 1) <> 1
     or array_position(p_family_ids, null) is not null then
    raise exception 'Request up to 100 family IDs';
  end if;
  return query
  select f.id, next_work.summary
  from public.families f
  left join lateral (
    select p.id from public.plans p where p.family_id = f.id order by p.version desc limit 1
  ) latest on true
  left join lateral (
    select jsonb_build_object(
      'id', candidates.step_id, 'title', candidates.title, 'phase', candidates.phase,
      'status', candidates.status, 'due_date', candidates.target_date,
      'action_needed_now', candidates.action_title, 'is_blocked', candidates.is_blocked,
      'is_escalated', candidates.is_escalated
    ) summary
    from (
      select s.id step_id, s.title, s.phase, a.status, a.title action_title,
        (case when a.status = 'blocked' then coalesce(a.follow_up_date, a.target_date) else a.target_date end)::text target_date,
        a.status = 'blocked' or s.status = 'blocked' is_blocked,
        coalesce(s.workflow_data -> 'needs_escalation' = 'true'::jsonb, false) is_escalated,
        0 priority, s.sort_order step_order, a.sort_order action_order, a.id action_id
      from public.plan_steps s join public.plan_step_action_items a on a.plan_step_id = s.id
      where s.plan_id = latest.id and a.status in ('pending', 'in_progress', 'blocked')
      union all
      select s.id, s.title, s.phase, s.status::text, coalesce(nullif(s.details ->> 'action_needed_now', ''), s.title),
        to_jsonb(s.due_date) #>> '{}', s.status = 'blocked', coalesce(s.workflow_data -> 'needs_escalation' = 'true'::jsonb, false),
        1, s.sort_order, 0, null::uuid
      from public.plan_steps s
      where s.plan_id = latest.id and s.status in ('pending', 'in_progress', 'blocked')
        and not exists(select 1 from public.plan_step_action_items a where a.plan_step_id = s.id)
    ) candidates
    order by priority, target_date nulls last, step_order, action_order, step_id, action_id
    limit 1
  ) next_work on true
  where f.id = any(p_family_ids) and f.archived_at is null;
end
$function$;

REVOKE ALL ON FUNCTION public.get_family_next_work(uuid[]) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.get_family_next_work(uuid[]) TO authenticated;
