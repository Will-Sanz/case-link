-- Read-only compatibility counts for the October 14 legacy schema and current constraints.
-- No identifying content, credentials or row IDs leave the database. Run with search_path=public.
-- activity_log.source and new tables do not exist yet; their constraints are checked in the upgrade transaction.
with validation_pattern as (
  select (
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
    || '|(^|[^[:alnum:]])(\+?1[[:space:].-]?)?(\([0-9]{3}\)|[0-9]{3})[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4}([^[:alnum:]]|$)'
    || '|(^|[^0-9])[0-9]{3}-[0-9]{2}-[0-9]{4}([^0-9]|$)'
    || '|(student|participant|child|client|case)[[:space:]]*(id|identifier|number|no\.?)[[:space:]]*[:#-]?[[:space:]]*[[:alnum:]][[:alnum:]-]{3,}'
    || '|(date[[:space:]]+of[[:space:]]+birth|d\.?o\.?b\.?|born)[[:space:]]*[:#-]?[[:space:]]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[/\-][0-9]{1,2}[/\-][0-9]{2,4})'
    || '|(^|[^0-9])[0-9]{1,6}[[:space:]]+([[:alnum:].''-]+[[:space:]]+){0,5}(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|place|pl\.?|circle|terrace|trail)([^[:alpha:]]|$)'
    || '|\m((student|child|parent|mother|father|guardian|participant|client|family)[[:space:]]+)?name[[:space:]]*(is[[:space:]]+|:[[:space:]]*)[[:alpha:]][[:alpha:]''’-]{1,30}[[:space:]]+[[:alpha:]][[:alpha:]''’-]{1,30}'
  ) as pattern
), checks as (
select 'activity_log_action_length_check' as check_name, count(*) filter (where not (((char_length(action) >= 1) AND (char_length(action) <= 100)))) as violating_rows
  from public.activity_log
union all
select 'activity_log_details_size_check' as check_name, count(*) filter (where not (((details IS NULL) OR (octet_length((details)::text) <= 8000)))) as violating_rows
  from public.activity_log
union all
select 'app_users_preferred_contact_method_check' as check_name, count(*) filter (where not (((preferred_contact_method IS NULL) OR (preferred_contact_method = ANY (ARRAY['email'::text, 'phone'::text, 'either'::text]))))) as violating_rows
  from public.app_users
union all
select 'case_notes_body_length_check' as check_name, count(*) filter (where not (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 12000)))) as violating_rows
  from public.case_notes
union all
select 'case_notes_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[body]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.case_notes cross join validation_pattern
union all
select 'case_progress_updates_plan_changes_check' as check_name, count(*) filter (where not ((jsonb_typeof(plan_changes) = 'array'::text))) as violating_rows
  from public.case_progress_updates
union all
select 'case_progress_updates_summary_check' as check_name, count(*) filter (where not (((char_length(btrim(summary)) >= 1) AND (char_length(btrim(summary)) <= 12000)))) as violating_rows
  from public.case_progress_updates
union all
select 'families_household_notes_length_check' as check_name, count(*) filter (where not (((household_notes IS NULL) OR (char_length(household_notes) <= 8000)))) as violating_rows
  from public.families
union all
select 'families_name_length_check' as check_name, count(*) filter (where not (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 200)))) as violating_rows
  from public.families
union all
select 'families_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[name, summary, household_notes]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.families cross join validation_pattern
union all
select 'families_summary_length_check' as check_name, count(*) filter (where not (((summary IS NULL) OR (char_length(summary) <= 8000)))) as violating_rows
  from public.families
union all
select 'family_barriers_label_length_check' as check_name, count(*) filter (where not (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 200)))) as violating_rows
  from public.family_barriers
union all
select 'family_barriers_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[label]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.family_barriers cross join validation_pattern
union all
select 'family_barriers_preset_length_check' as check_name, count(*) filter (where not (((preset_key IS NULL) OR (char_length(preset_key) <= 100)))) as violating_rows
  from public.family_barriers
union all
select 'family_barriers_sort_check' as check_name, count(*) filter (where not (((sort_order >= 0) AND (sort_order <= 99)))) as violating_rows
  from public.family_barriers
union all
select 'family_goals_label_length_check' as check_name, count(*) filter (where not (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 200)))) as violating_rows
  from public.family_goals
union all
select 'family_goals_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[label]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.family_goals cross join validation_pattern
union all
select 'family_goals_preset_length_check' as check_name, count(*) filter (where not (((preset_key IS NULL) OR (char_length(preset_key) <= 100)))) as violating_rows
  from public.family_goals
union all
select 'family_goals_sort_check' as check_name, count(*) filter (where not (((sort_order >= 0) AND (sort_order <= 99)))) as violating_rows
  from public.family_goals
union all
select 'family_members_age_check' as check_name, count(*) filter (where not (((age_approx IS NULL) OR ((age_approx >= 0) AND (age_approx <= 120))))) as violating_rows
  from public.family_members
union all
select 'family_members_display_name_length_check' as check_name, count(*) filter (where not (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 200)))) as violating_rows
  from public.family_members
union all
select 'family_members_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[display_name, notes]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.family_members cross join validation_pattern
union all
select 'family_members_notes_length_check' as check_name, count(*) filter (where not (((notes IS NULL) OR (char_length(notes) <= 2000)))) as violating_rows
  from public.family_members
union all
select 'family_members_relationship_length_check' as check_name, count(*) filter (where not (((relationship IS NULL) OR (char_length(relationship) <= 120)))) as violating_rows
  from public.family_members
union all
select 'plan_step_action_items_description_length_check' as check_name, count(*) filter (where not (((description IS NULL) OR (char_length(description) <= 4000)))) as violating_rows
  from public.plan_step_action_items
union all
select 'plan_step_action_items_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[title, description, outcome, notes]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.plan_step_action_items cross join validation_pattern
union all
select 'plan_step_action_items_notes_length_check' as check_name, count(*) filter (where not (((notes IS NULL) OR (char_length(notes) <= 2000)))) as violating_rows
  from public.plan_step_action_items
union all
select 'plan_step_action_items_outcome_length_check' as check_name, count(*) filter (where not (((outcome IS NULL) OR (char_length(outcome) <= 2000)))) as violating_rows
  from public.plan_step_action_items
union all
select 'plan_step_action_items_sort_check' as check_name, count(*) filter (where not (((sort_order >= 0) AND (sort_order <= 999)))) as violating_rows
  from public.plan_step_action_items
union all
select 'plan_step_action_items_status_check' as check_name, count(*) filter (where not ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'blocked'::text])))) as violating_rows
  from public.plan_step_action_items
union all
select 'plan_step_action_items_title_length_check' as check_name, count(*) filter (where not (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 500)))) as violating_rows
  from public.plan_step_action_items
union all
select 'plan_step_action_items_week_check' as check_name, count(*) filter (where not (((week_index >= 1) AND (week_index <= 52)))) as violating_rows
  from public.plan_step_action_items
union all
select 'plan_steps_ai_helper_size_check' as check_name, count(*) filter (where not (((ai_helper_data IS NULL) OR (octet_length((ai_helper_data)::text) <= 50000)))) as violating_rows
  from public.plan_steps
union all
select 'plan_steps_description_length_check' as check_name, count(*) filter (where not ((char_length(description) <= 8000))) as violating_rows
  from public.plan_steps
union all
select 'plan_steps_details_size_check' as check_name, count(*) filter (where not (((details IS NULL) OR (octet_length((details)::text) <= 100000)))) as violating_rows
  from public.plan_steps
union all
select 'plan_steps_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[title, description, (coalesce(details, '{}'::jsonb) - 'contacts')::text, workflow_data::text]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.plan_steps cross join validation_pattern
union all
select 'plan_steps_priority_check' as check_name, count(*) filter (where not ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])))) as violating_rows
  from public.plan_steps
union all
select 'plan_steps_sort_order_check' as check_name, count(*) filter (where not (((sort_order >= 0) AND (sort_order <= 999)))) as violating_rows
  from public.plan_steps
union all
select 'plan_steps_title_length_check' as check_name, count(*) filter (where not (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 500)))) as violating_rows
  from public.plan_steps
union all
select 'plan_steps_workflow_size_check' as check_name, count(*) filter (where not (((workflow_data IS NULL) OR (octet_length((workflow_data)::text) <= 50000)))) as violating_rows
  from public.plan_steps
union all
select 'plans_ai_model_length_check' as check_name, count(*) filter (where not (((ai_model IS NULL) OR (char_length(ai_model) <= 200)))) as violating_rows
  from public.plans
union all
select 'plans_client_display_size_check' as check_name, count(*) filter (where not (((client_display IS NULL) OR (octet_length((client_display)::text) <= 50000)))) as violating_rows
  from public.plans
union all
select 'plans_generation_state_size_check' as check_name, count(*) filter (where not (((generation_state IS NULL) OR (octet_length((generation_state)::text) <= 250000)))) as violating_rows
  from public.plans
union all
select 'plans_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[summary, client_display::text, generation_state->>'planning_brief']) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.plans cross join validation_pattern
union all
select 'plans_summary_length_check' as check_name, count(*) filter (where not (((summary IS NULL) OR (char_length(summary) <= 2000)))) as violating_rows
  from public.plans
union all
select 'plans_version_check' as check_name, count(*) filter (where not (((version >= 1) AND (version <= 10000)))) as violating_rows
  from public.plans
union all
select 'referrals_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[outcome, notes]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.referrals cross join validation_pattern
union all
select 'referrals_organization_length_check' as check_name, count(*) filter (where not (((char_length(btrim(organization_label)) >= 1) AND (char_length(btrim(organization_label)) <= 300)))) as violating_rows
  from public.referrals
union all
select 'referrals_text_size_check' as check_name, count(*) filter (where not ((((contact_person IS NULL) OR (char_length(contact_person) <= 300)) AND ((method IS NULL) OR (char_length(method) <= 100)) AND ((outcome IS NULL) OR (char_length(outcome) <= 2000)) AND ((notes IS NULL) OR (char_length(notes) <= 4000))))) as violating_rows
  from public.referrals
union all
select 'resource_matches_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[match_reason]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.resource_matches cross join validation_pattern
union all
select 'resource_matches_reason_length_check' as check_name, count(*) filter (where not (((char_length(btrim(match_reason)) >= 1) AND (char_length(btrim(match_reason)) <= 2000)))) as violating_rows
  from public.resource_matches
union all
select 'resource_matches_score_check' as check_name, count(*) filter (where not (((score >= (0)::double precision) AND (score <= (1000)::double precision)))) as violating_rows
  from public.resource_matches
union all
select 'tasks_description_length_check' as check_name, count(*) filter (where not (((description IS NULL) OR (char_length(description) <= 4000)))) as violating_rows
  from public.tasks
union all
select 'tasks_no_direct_identifiers_check' as check_name, count(*) filter (where exists (
    select 1 from unnest(array[title, description]) as inputs(value)
    where coalesce(value,'') ~* validation_pattern.pattern
  )) as violating_rows from public.tasks cross join validation_pattern
union all
select 'tasks_title_length_check' as check_name, count(*) filter (where not (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 500)))) as violating_rows
  from public.tasks
union all
select 'resource_matches_family_consistency' as check_name, count(*) filter (where r.family_id<>p.family_id) as violating_rows
  from resource_matches r join plan_steps s on s.id=r.plan_step_id join plans p on p.id=s.plan_id
union all
select 'plan_step_activity_family_consistency' as check_name, count(*) filter (where a.family_id<>p.family_id) as violating_rows
  from plan_step_activity a join plan_steps s on s.id=a.plan_step_id join plans p on p.id=s.plan_id
union all
select 'tasks_family_consistency' as check_name, count(*) filter (where t.family_id<>p.family_id) as violating_rows
  from tasks t join plan_steps s on s.id=t.plan_step_id join plans p on p.id=s.plan_id
union all
select 'case_progress_updates_family_consistency' as check_name, count(*) filter (where c.family_id<>p.family_id) as violating_rows
  from case_progress_updates c join plans p on p.id=c.plan_id
)
select check_name, violating_rows from checks order by check_name;
