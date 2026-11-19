-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default


ALTER TABLE public.case_progress_updates
  ADD COLUMN request_hash text;

DROP FUNCTION public.capture_case_progress_update(p_family_id uuid, p_plan_id uuid, p_occurred_on date, p_summary text, p_changes jsonb);

CREATE FUNCTION public.capture_case_progress_update (
  p_family_id   uuid,
  p_plan_id     uuid,
  p_occurred_on date,
  p_summary     text,
  p_request_id  uuid,
  p_changes     jsonb DEFAULT '[]'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_update_id uuid := p_request_id;
  v_request_hash text;
  v_existing public.case_progress_updates;
  v_change jsonb;
  v_action_id uuid;
  v_expected_updated_at timestamptz;
  v_action record;
  v_status text;
  v_target_date date;
  v_follow_up_date date;
  v_notes text;
  v_outcome text;
  v_previous jsonb;
  v_current jsonb;
  v_recorded_changes jsonb := '[]'::jsonb;
  v_step_ids uuid[] := '{}'::uuid[];
  v_step_id uuid;
begin
  if v_actor_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied';
  end if;
  if p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'meeting date cannot be in the future';
  end if;
  if nullif(btrim(p_summary), '') is null or char_length(btrim(p_summary)) > 12000 then
    raise exception 'progress summary is invalid';
  end if;
  if jsonb_typeof(coalesce(p_changes, '[]'::jsonb)) <> 'array' then
    raise exception 'plan changes must be an array';
  end if;
  if jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 25 or octet_length(p_changes::text) > 150000 then
    raise exception 'too many plan changes';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 0));
  if p_request_id is null then raise exception 'request id is required'; end if;
  v_request_hash := encode(extensions.digest(jsonb_build_object(
    'family',p_family_id,'plan',p_plan_id,'date',p_occurred_on,'summary',btrim(p_summary),'changes',coalesce(p_changes,'[]'::jsonb)
  )::text,'sha256'),'hex');
  select * into v_existing from public.case_progress_updates where id=p_request_id;
  if found then
    if v_existing.author_id is distinct from v_actor_id or v_existing.family_id is distinct from p_family_id
      or v_existing.plan_id is distinct from p_plan_id or v_existing.request_hash is distinct from v_request_hash then
      raise exception 'request id already used for a different update' using errcode='23514';
    end if;
    return v_existing.id;
  end if;

  if not exists (
    select 1
    from public.plans p
    where p.id = p_plan_id
      and p.family_id = p_family_id
      and p.id = (
        select latest.id
        from public.plans latest
        where latest.family_id = p_family_id
        order by latest.version desc
        limit 1
      )
  ) then
    raise exception 'current plan not found or access denied';
  end if;

  if public.contains_direct_identifier(p_summary) or public.contains_direct_identifier(p_changes::text) then
    raise exception 'remove identifying text' using errcode = '23514';
  end if;
  perform s.id from public.plan_steps s where s.plan_id = p_plan_id and s.id in (
    select a.plan_step_id from public.plan_step_action_items a join jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c
      on a.id = (c->>'action_item_id')::uuid
  ) order by s.id for update;
  perform a.id from public.plan_step_action_items a join public.plan_steps s on s.id=a.plan_step_id
    join jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) c on a.id=(c->>'action_item_id')::uuid
    where s.plan_id=p_plan_id order by a.id for update of a;
  for v_change in
    select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb))
  loop
    begin
      v_action_id := (v_change ->> 'action_item_id')::uuid;
      v_expected_updated_at := (v_change ->> 'expected_updated_at')::timestamptz;
    exception when others then
      raise exception 'plan change identifiers are invalid';
    end;

    select
      ai.id,
      ai.plan_step_id,
      ai.title,
      ai.status,
      ai.target_date,
      ai.follow_up_date,
      ai.notes,
      ai.outcome,
      ai.updated_at
    into v_action
    from public.plan_step_action_items ai
    join public.plan_steps ps on ps.id = ai.plan_step_id
    where ai.id = v_action_id and ps.plan_id = p_plan_id
    for update of ai;

    if not found then
      raise exception 'plan action not found';
    end if;
    if v_expected_updated_at is null or v_action.updated_at <> v_expected_updated_at then
      raise exception 'plan action changed in another tab';
    end if;

    v_status := nullif(v_change ->> 'status', '');
    if v_status is null or v_status not in ('pending', 'in_progress', 'completed', 'blocked') then
      raise exception 'plan action status is invalid';
    end if;

    begin
      v_target_date := case
        when v_change ? 'target_date' then nullif(v_change ->> 'target_date', '')::date
        else v_action.target_date
      end;
      v_follow_up_date := case
        when v_change ? 'follow_up_date' then nullif(v_change ->> 'follow_up_date', '')::date
        else v_action.follow_up_date
      end;
    exception when others then
      raise exception 'plan action date is invalid';
    end;

    v_notes := case
      when v_change ? 'notes' then nullif(btrim(v_change ->> 'notes'), '')
      else v_action.notes
    end;
    v_outcome := case
      when v_change ? 'outcome' then nullif(btrim(v_change ->> 'outcome'), '')
      else v_action.outcome
    end;

    if char_length(coalesce(v_notes, '')) > 2000 or char_length(coalesce(v_outcome, '')) > 2000 then
      raise exception 'plan action note is too long';
    end if;
    if v_status <> 'completed' and v_target_date is null then
      raise exception 'open plan actions need a target date';
    end if;
    if v_status <> 'completed' then
      v_notes := nullif(btrim(replace(v_notes,'[[caselink:resolution=no_longer_needed]]','')),'');
    end if;
    if v_status = 'blocked' and (v_follow_up_date is null or nullif(btrim(coalesce(v_notes, '')), '') is null) then
      raise exception 'waiting actions need a reason and follow-up date';
    end if;

    v_previous := jsonb_build_object(
      'status', v_action.status,
      'target_date', v_action.target_date,
      'follow_up_date', v_action.follow_up_date,
      'notes', v_action.notes,
      'outcome', v_action.outcome
    );

    update public.plan_step_action_items
    set
      status = v_status,
      target_date = v_target_date,
      follow_up_date = v_follow_up_date,
      notes = v_notes,
      outcome = v_outcome
    where id = v_action_id;

    v_current := jsonb_build_object(
      'status', v_status,
      'target_date', v_target_date,
      'follow_up_date', v_follow_up_date,
      'notes', v_notes,
      'outcome', v_outcome
    );
    v_recorded_changes := v_recorded_changes || jsonb_build_array(
      jsonb_build_object(
        'action_item_id', v_action_id,
        'plan_step_id', v_action.plan_step_id,
        'title', v_action.title,
        'previous', v_previous,
        'current', v_current
      )
    );
    v_step_ids := array_append(v_step_ids, v_action.plan_step_id);

    insert into public.plan_step_activity (
      plan_step_id,
      family_id,
      actor_user_id,
      action,
      activity_type,
      notes,
      details
    ) values (
      v_action.plan_step_id,
      p_family_id,
      v_actor_id,
      'progress.updated',
      'meeting',
      null,
      jsonb_build_object(
        'progress_update_id', v_update_id,
        'action_item_id', v_action_id,
        'previous', v_previous,
        'current', v_current
      )
    );
  end loop;

  -- Keep parent step state aligned with its dated actions.
  for v_step_id in select distinct unnest(v_step_ids)
  loop
    if not exists (
      select 1 from public.plan_step_action_items ai
      where ai.plan_step_id = v_step_id and ai.status <> 'completed'
    ) then
      update public.plan_steps
      set status = 'completed'
      where id = v_step_id and status not in ('completed', 'blocked');
    elsif exists (
      select 1 from public.plan_steps ps
      where ps.id = v_step_id and ps.status = 'completed'
    ) then
      update public.plan_steps set status = 'in_progress' where id = v_step_id;
    end if;
  end loop;

  insert into public.case_progress_updates (
    id,
    family_id,
    plan_id,
    author_id,
    occurred_on,
    summary,
    plan_changes,
    request_hash
  ) values (
    v_update_id,
    p_family_id,
    p_plan_id,
    v_actor_id,
    p_occurred_on,
    btrim(p_summary),
    v_recorded_changes,
    v_request_hash
  );

  update public.families set updated_at = now() where id = p_family_id;

  insert into public.activity_log (
    family_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details,
    source
  ) values (
    p_family_id,
    v_actor_id,
    'progress.captured',
    'case_progress_update',
    v_update_id::text,
    jsonb_build_object(
      'occurred_on', p_occurred_on,
      'plan_id', p_plan_id,
      'changed_action_count', jsonb_array_length(v_recorded_changes)
    ),
    'database'
  );

  return v_update_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.capture_case_progress_update(uuid, uuid, date, text, uuid, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.capture_case_progress_update(uuid, uuid, date, text, uuid, jsonb) TO authenticated;

CREATE FUNCTION public.save_plan_edits (
  p_family_id uuid,
  p_plan_id   uuid,
  p_changes   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_change jsonb;
  v_item jsonb;
  v_patch jsonb;
  v_step public.plan_steps;
  v_next_step public.plan_steps;
  v_action public.plan_step_action_items;
  v_next_action public.plan_step_action_items;
  v_conflict text := 'This action changed in another tab. Compare both versions before choosing which one to keep.';
begin
  if v_actor is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 15
    or octet_length(p_changes::text) > 500000
    or (select count(distinct x->>'stepId') from jsonb_array_elements(p_changes) x) <> jsonb_array_length(p_changes) then
    raise exception 'invalid plan edits' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 0));
  if not exists (select 1 from public.plans p where p.id = p_plan_id and p.family_id = p_family_id
      and p.id = (select id from public.plans where family_id = p_family_id order by version desc limit 1)) then
    raise exception 'current plan not found or access denied' using errcode = '42501';
  end if;
  -- Lock rows in the same order in every multi-row save, before any write or audit event.
  perform s.id from public.plan_steps s join jsonb_array_elements(p_changes) c on s.id = (c->>'stepId')::uuid
    where s.plan_id = p_plan_id order by s.id for update of s;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) <> 'object'
      or jsonb_typeof(v_change->'patch') is distinct from 'object'
      or jsonb_typeof(v_change->'actionItems') is distinct from 'array'
      or jsonb_array_length(v_change->'actionItems') > 50
      or (select count(distinct a->>'actionItemId') from jsonb_array_elements(v_change->'actionItems') a) <> jsonb_array_length(v_change->'actionItems')
      or exists (select 1 from jsonb_object_keys(v_change->'patch') k where k not in ('title','description','status','phase','priority','details','workflow_data','sort_order')) then
      raise exception 'invalid step edit' using errcode = '23514';
    end if;
    perform a.id from public.plan_step_action_items a join jsonb_array_elements(v_change->'actionItems') c on a.id = (c->>'actionItemId')::uuid
      where a.plan_step_id = (v_change->>'stepId')::uuid order by a.id for update of a;
  end loop;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    select * into v_step from public.plan_steps where id = (v_change->>'stepId')::uuid and plan_id = p_plan_id;
    if not found then raise exception 'plan step not found' using errcode = '42501'; end if;
    if v_step.updated_at is distinct from (v_change->>'expectedUpdatedAt')::timestamptz then
      return jsonb_build_object('ok', false, 'error', v_conflict, 'conflict', jsonb_build_object(
        'kind','step','entityId',v_step.id,'currentUpdatedAt',v_step.updated_at,'current',to_jsonb(v_step)));
    end if;
    for v_item in select value from jsonb_array_elements(v_change->'actionItems') loop
      if jsonb_typeof(v_item->'patch') is distinct from 'object'
        or exists (select 1 from jsonb_object_keys(v_item->'patch') k where k not in ('title','description','status','week_index','target_date','outcome','notes','follow_up_date')) then
        raise exception 'invalid action edit' using errcode = '23514';
      end if;
      select * into v_action from public.plan_step_action_items where id = (v_item->>'actionItemId')::uuid and plan_step_id = v_step.id;
      if not found then raise exception 'plan action not found' using errcode = '42501'; end if;
      if v_action.updated_at is distinct from (v_item->>'expectedUpdatedAt')::timestamptz then
        return jsonb_build_object('ok',false,'error',v_conflict,'conflict',jsonb_build_object(
          'kind','action_item','entityId',v_action.id,'currentUpdatedAt',v_action.updated_at,'current',to_jsonb(v_action)));
      end if;
    end loop;
  end loop;
  -- Failures after this point raise and roll back the whole operation, including audit records.
  for v_change in select value from jsonb_array_elements(p_changes) loop
    select * into v_step from public.plan_steps where id = (v_change->>'stepId')::uuid;
    v_patch := v_change->'patch';
    v_next_step := jsonb_populate_record(v_step, v_patch);
    if jsonb_typeof(coalesce(v_next_step.details,'{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(v_next_step.workflow_data,'{}'::jsonb)) <> 'object' then
      raise exception 'invalid step details' using errcode = '23514';
    end if;
    if v_next_step is distinct from v_step then
      update public.plan_steps set title=v_next_step.title, description=v_next_step.description, status=v_next_step.status,
        phase=v_next_step.phase, priority=v_next_step.priority, details=v_next_step.details, workflow_data=v_next_step.workflow_data,
        sort_order=v_next_step.sort_order where id=v_step.id;
      insert into public.activity_log (family_id,actor_user_id,action,entity_type,entity_id,details,source)
      values (p_family_id,v_actor,'step.updated','plan_step',v_step.id::text,
        jsonb_build_object('plan_id',p_plan_id,'changed_fields',(select jsonb_agg(k) from jsonb_object_keys(v_patch) k)),'database');
      if coalesce((v_next_step.workflow_data->>'needs_escalation')::boolean,false)
        and not coalesce((v_step.workflow_data->>'needs_escalation')::boolean,false) then
        insert into public.activity_log (family_id,actor_user_id,action,entity_type,entity_id,source)
        values (p_family_id,v_actor,'step.escalation_flagged','plan_step',v_step.id::text,'database');
      end if;
      if v_next_step.status is distinct from v_step.status then
        insert into public.activity_log (family_id,actor_user_id,action,entity_type,entity_id,details,source)
        values (p_family_id,v_actor,'step.status_changed','plan_step',v_step.id::text,jsonb_build_object('status',v_next_step.status),'database');
      end if;
    end if;
    for v_item in select value from jsonb_array_elements(v_change->'actionItems') loop
      select * into v_action from public.plan_step_action_items where id = (v_item->>'actionItemId')::uuid;
      v_patch := v_item->'patch';
      v_next_action := jsonb_populate_record(v_action,v_patch);
      if v_next_action.status <> 'completed' then
        v_next_action.notes := nullif(btrim(replace(v_next_action.notes,'[[caselink:resolution=no_longer_needed]]','')),'');
      end if;
      if v_next_action.status <> 'completed' and v_next_action.target_date is null then
        raise exception 'open plan actions need a target date' using errcode = '23514';
      end if;
      if v_next_action.status = 'blocked' and (nullif(btrim(coalesce(v_next_action.notes,'')),'') is null or v_next_action.follow_up_date is null) then
        raise exception 'waiting actions need a reason and follow-up date' using errcode = '23514';
      end if;
      if v_next_action is distinct from v_action then
        update public.plan_step_action_items set title=v_next_action.title, description=v_next_action.description, status=v_next_action.status,
          week_index=v_next_action.week_index,target_date=v_next_action.target_date,outcome=v_next_action.outcome,notes=v_next_action.notes,
          follow_up_date=v_next_action.follow_up_date where id=v_action.id;
        insert into public.activity_log (family_id,actor_user_id,action,entity_type,entity_id,details,source)
        values (p_family_id,v_actor,'step.action_item_updated','plan_step_action_item',v_action.id::text,
          jsonb_build_object('plan_id',p_plan_id,'changed_fields',(select jsonb_agg(k) from jsonb_object_keys(v_patch) k),'status',v_next_action.status),'database');
        if v_next_action.status = 'completed' and v_action.status <> 'completed' then
          insert into public.activity_log (family_id,actor_user_id,action,entity_type,entity_id,source)
          values (p_family_id,v_actor,case when coalesce(v_next_action.notes,'') like '%[[caselink:resolution=no_longer_needed]]%'
            then 'step.action_item_no_longer_needed' else 'step.action_item_completed' end,'plan_step_action_item',v_action.id::text,'database');
        end if;
      end if;
    end loop;
    if jsonb_array_length(v_change->'actionItems') > 0 then
      if not exists (select 1 from public.plan_step_action_items where plan_step_id = v_step.id and status <> 'completed') then
        update public.plan_steps set status='completed' where id=v_step.id and status not in ('completed','blocked') returning * into v_next_step;
      else
        update public.plan_steps set status='in_progress' where id=v_step.id and status='completed' returning * into v_next_step;
      end if;
      if found then
        insert into public.activity_log (family_id,actor_user_id,action,entity_type,entity_id,details,source)
        values (p_family_id,v_actor,'step.status_changed','plan_step',v_step.id::text,
          jsonb_build_object('status',v_next_step.status,'source','action_items_auto'),'database');
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok',true);
end;
$function$;

REVOKE ALL ON FUNCTION public.save_plan_edits(uuid, uuid, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_plan_edits(uuid, uuid, jsonb) TO authenticated;


GRANT SELECT ON public.case_progress_updates TO authenticated;

-- Only signed-in, authorized staff may invoke these audited write operations.
revoke all on function public.save_plan_edits(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_plan_edits(uuid,uuid,jsonb) to authenticated;
revoke all on function public.capture_case_progress_update(uuid,uuid,date,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.capture_case_progress_update(uuid,uuid,date,text,uuid,jsonb) to authenticated;
