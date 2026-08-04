-- One meeting update can change several dated actions. Keep the narrative and
-- every before/after snapshot together so a partial save cannot distort history.
create table public.case_progress_updates (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  author_id uuid not null references public.app_users (id),
  occurred_on date not null,
  summary text not null check (char_length(btrim(summary)) between 1 and 12000),
  plan_changes jsonb not null default '[]'::jsonb check (jsonb_typeof(plan_changes) = 'array'),
  created_at timestamptz not null default now()
);

create index case_progress_updates_family_date_idx
  on public.case_progress_updates (family_id, occurred_on desc, created_at desc);

alter table public.case_progress_updates enable row level security;

create policy case_progress_updates_select on public.case_progress_updates
  for select to authenticated
  using (public.can_access_family(family_id));

create policy case_progress_updates_insert on public.case_progress_updates
  for insert to authenticated
  with check (
    public.can_access_family(family_id)
    and author_id = (select auth.uid())
  );

-- Explicit Data API access; RLS still decides which family rows are reachable.
revoke all on table public.case_progress_updates from anon, authenticated;
grant select, insert on table public.case_progress_updates to authenticated;

-- No update or delete policy is intentional: progress records are append-only.

create or replace function public.capture_case_progress_update(
  p_family_id uuid,
  p_plan_id uuid,
  p_occurred_on date,
  p_summary text,
  p_changes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_update_id uuid := gen_random_uuid();
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
  v_display jsonb;
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
  if jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 25 then
    raise exception 'too many plan changes';
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
    if v_status not in ('pending', 'in_progress', 'completed', 'blocked') then
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

    if char_length(coalesce(v_notes, '')) > 4000 or char_length(coalesce(v_outcome, '')) > 4000 then
      raise exception 'plan action note is too long';
    end if;
    if v_status in ('pending', 'in_progress') and v_target_date is null then
      raise exception 'open plan actions need a target date';
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
    plan_changes
  ) values (
    v_update_id,
    p_family_id,
    p_plan_id,
    v_actor_id,
    p_occurred_on,
    btrim(p_summary),
    v_recorded_changes
  );

  if jsonb_array_length(v_recorded_changes) > 0 then
    select coalesce(client_display, '{}'::jsonb)
    into v_display
    from public.plans
    where id = p_plan_id
    for update;

    v_display := v_display - 'reviewedAt' - 'reviewedById';
    update public.plans
    set client_display = v_display
    where id = p_plan_id;
  end if;

  update public.families set updated_at = now() where id = p_family_id;

  insert into public.activity_log (
    family_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
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
    )
  );

  return v_update_id;
end;
$$;

revoke all on function public.capture_case_progress_update(uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.capture_case_progress_update(uuid, uuid, date, text, jsonb) to authenticated;
