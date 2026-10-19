-- Read the authorized plan once before deriving its content and review hashes.
CREATE OR REPLACE FUNCTION public.get_family_plan_snapshot (
  p_family_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with snapshot as materialized (
    select to_jsonb(f) as family,
      coalesce((select jsonb_agg(to_jsonb(b) order by b.sort_order, b.id)
        from public.family_barriers b where b.family_id = f.id), '[]'::jsonb) as barriers,
      (select to_jsonb(p) || jsonb_build_object('resource_contacts_current', not exists(select 1 from public.plan_steps cs where cs.plan_id=p.id and not public.plan_contacts_current(f.id,cs.details->'contacts')), 'steps', coalesce((
        select jsonb_agg(to_jsonb(s) || jsonb_build_object('action_items', coalesce((
          select jsonb_agg(to_jsonb(a) order by a.sort_order, a.id)
          from public.plan_step_action_items a where a.plan_step_id = s.id
        ), '[]'::jsonb)) order by s.sort_order, s.id)
        from public.plan_steps s where s.plan_id = p.id
      ), '[]'::jsonb))
      from public.plans p where p.family_id = f.id order by p.version desc limit 1) as plan
    from public.families f where f.id = p_family_id and f.archived_at is null
  ), content as (
    select *, jsonb_build_object('name', family->'name', 'summary', family->'summary',
      'household_notes', family->'household_notes', 'barriers', barriers) as context,
      plan || jsonb_build_object('client_display', coalesce(nullif(plan->'client_display', 'null'::jsonb), '{}'::jsonb)
        - 'reviewedAt' - 'reviewedById' - 'reviewedRevision') as unreviewed_plan
    from snapshot
  ), revisions as (
    select *, jsonb_build_object('context', context, 'plan', unreviewed_plan) as exact_content,
      jsonb_build_object('context', context, 'plan', (unreviewed_plan - 'steps') || jsonb_build_object('steps', (
        select jsonb_agg((s - 'status' - 'workflow_data' - 'ai_helper_data' - 'updated_at' - 'action_items') ||
          jsonb_build_object('action_items', (select jsonb_agg(a - 'status' - 'outcome' - 'notes' - 'updated_at' order by ai)
            from jsonb_array_elements(s->'action_items') with ordinality items(a, ai))) order by si)
        from jsonb_array_elements(unreviewed_plan->'steps') with ordinality steps(s, si)
      ))) as material_content
    from content
  )
  select jsonb_build_object('family', family, 'barriers', barriers, 'plan', case when plan is null then null else plan || jsonb_build_object(
    'review_revision', encode(sha256(convert_to(exact_content::text, 'UTF8')), 'hex'),
    'material_revision', encode(sha256(convert_to(material_content::text, 'UTF8')), 'hex')
  ) end) from revisions;
$function$;
