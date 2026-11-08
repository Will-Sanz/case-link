-- Schema-only fixture captured from the restored CaseLink project after approved containment.
-- No user, family, resource or authentication rows are included. Local rehearsal only.
set search_path = public;
set check_function_bodies = false;

create type public."family_status" as enum ('active', 'on_hold', 'closed');
create type public."family_urgency" as enum ('low', 'medium', 'high', 'crisis');
create type public."match_status" as enum ('suggested', 'accepted', 'dismissed');
create type public."plan_generation_source" as enum ('openai', 'rules', 'manual');
create type public."plan_phase" as enum ('30', '60', '90');
create type public."plan_step_status" as enum ('pending', 'in_progress', 'completed', 'blocked');
create type public."referral_status" as enum ('planned', 'attempted', 'in_progress', 'connected', 'closed');
create type public."task_source" as enum ('manual', 'plan_step', 'ai');
create type public."user_role" as enum ('admin', 'case_manager');

create table public."activity_log" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "actor_user_id" uuid,
  "action" text not null,
  "entity_type" text,
  "entity_id" text,
  "details" jsonb,
  "created_at" timestamp with time zone default now() not null
);

create table public."app_users" (
  "id" uuid not null,
  "email" text not null,
  "role" user_role default 'case_manager'::user_role not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "display_name" text,
  "job_title" text,
  "organization" text,
  "phone" text,
  "pronouns" text,
  "service_area" text,
  "bio" text,
  "preferred_contact_method" text,
  "notes_signature" text
);

create table public."barrier_plan_records" (
  "id" uuid default gen_random_uuid() not null,
  "owner_user_id" uuid not null,
  "reference_id" text not null,
  "family_id" uuid not null,
  "selected_barriers" jsonb default '[]'::jsonb not null,
  "additional_details" text,
  "generated_plan_json" jsonb,
  "matched_resources_json" jsonb,
  "status" text default 'active'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."case_notes" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "author_id" uuid not null,
  "body" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."case_progress_updates" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "plan_id" uuid,
  "author_id" uuid not null,
  "occurred_on" date not null,
  "summary" text not null,
  "plan_changes" jsonb default '[]'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."families" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "summary" text,
  "urgency" family_urgency,
  "household_notes" text,
  "status" family_status default 'active'::family_status not null,
  "created_by_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "archived_at" timestamp with time zone
);

create table public."family_barriers" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "preset_key" text,
  "label" text not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."family_case_managers" (
  "family_id" uuid not null,
  "user_id" uuid not null,
  "assigned_at" timestamp with time zone default now() not null
);

create table public."family_goals" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "preset_key" text,
  "label" text not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."family_members" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "display_name" text not null,
  "relationship" text,
  "notes" text,
  "age_approx" integer,
  "created_at" timestamp with time zone default now() not null
);

create table public."plan_step_action_items" (
  "id" uuid default gen_random_uuid() not null,
  "plan_step_id" uuid not null,
  "title" text not null,
  "description" text,
  "week_index" integer default 1 not null,
  "target_date" date,
  "status" text default 'pending'::text not null,
  "sort_order" integer default 0 not null,
  "outcome" text,
  "notes" text,
  "follow_up_date" date,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."plan_step_activity" (
  "id" uuid default gen_random_uuid() not null,
  "plan_step_id" uuid not null,
  "family_id" uuid not null,
  "actor_user_id" uuid,
  "action" text not null,
  "activity_type" text,
  "notes" text,
  "details" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null
);

create table public."plan_step_resources" (
  "plan_step_id" uuid not null,
  "resource_id" uuid not null
);

create table public."plan_steps" (
  "id" uuid default gen_random_uuid() not null,
  "plan_id" uuid not null,
  "phase" plan_phase not null,
  "title" text not null,
  "description" text not null,
  "status" plan_step_status default 'pending'::plan_step_status not null,
  "due_date" timestamp with time zone,
  "assigned_to_id" uuid,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "details" jsonb,
  "workflow_data" jsonb,
  "priority" text default 'medium'::text,
  "ai_helper_data" jsonb
);

create table public."plans" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "version" integer not null,
  "summary" text,
  "generation_source" plan_generation_source default 'rules'::plan_generation_source not null,
  "ai_model" text,
  "created_at" timestamp with time zone default now() not null,
  "client_display" jsonb default '{}'::jsonb not null,
  "generation_state" jsonb
);

create table public."referrals" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "resource_id" uuid,
  "organization_label" text not null,
  "contact_person" text,
  "contact_attempted_at" timestamp with time zone,
  "method" text,
  "status" referral_status default 'planned'::referral_status not null,
  "outcome" text,
  "next_follow_up_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."resource_import_runs" (
  "id" uuid default gen_random_uuid() not null,
  "started_at" timestamp with time zone default now() not null,
  "finished_at" timestamp with time zone,
  "source_path" text,
  "row_count" integer default 0 not null,
  "success_count" integer default 0 not null,
  "error_count" integer default 0 not null,
  "error_log" jsonb
);

create table public."resource_matches" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "resource_id" uuid not null,
  "match_reason" text not null,
  "score" double precision not null,
  "status" match_status default 'suggested'::match_status not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "plan_step_id" uuid
);

create table public."resources" (
  "id" uuid default gen_random_uuid() not null,
  "slug" text not null,
  "active" boolean default true not null,
  "import_key" text not null,
  "office_or_department" text not null,
  "program_name" text not null,
  "description" text,
  "category" text,
  "invite_march_partner_fair" boolean,
  "partner_fair_attended" text,
  "recruit_for_grocery_giveaways" boolean,
  "primary_contact_name" text,
  "primary_contact_title" text,
  "primary_contact_email" text,
  "primary_contact_phone" text,
  "primary_contact_phone_norm" text,
  "secondary_contact_name" text,
  "secondary_contact_title" text,
  "secondary_contact_email" text,
  "secondary_contact_phone" text,
  "secondary_contact_phone_norm" text,
  "services_select_all" text,
  "additional_info" text,
  "tabling_at_events" boolean default false not null,
  "promotional_materials" boolean default false not null,
  "educational_workshops" boolean default false not null,
  "volunteer_recruitment_support" boolean default false not null,
  "tags" text[] default '{}'::text[] not null,
  "search_text" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."tasks" (
  "id" uuid default gen_random_uuid() not null,
  "family_id" uuid not null,
  "title" text not null,
  "description" text,
  "completed" boolean default false not null,
  "completed_at" timestamp with time zone,
  "source" task_source default 'manual'::task_source not null,
  "plan_step_id" uuid,
  "created_by_id" uuid,
  "due_date" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table public."activity_log" add constraint "activity_log_pkey" PRIMARY KEY (id);
alter table public."app_users" add constraint "app_users_email_key" UNIQUE (email);
alter table public."app_users" add constraint "app_users_pkey" PRIMARY KEY (id);
alter table public."app_users" add constraint "app_users_preferred_contact_method_check" CHECK (preferred_contact_method IS NULL OR (preferred_contact_method = ANY (ARRAY['email'::text, 'phone'::text, 'either'::text])));
alter table public."barrier_plan_records" add constraint "barrier_plan_records_owner_user_id_reference_id_key" UNIQUE (owner_user_id, reference_id);
alter table public."barrier_plan_records" add constraint "barrier_plan_records_pkey" PRIMARY KEY (id);
alter table public."case_notes" add constraint "case_notes_pkey" PRIMARY KEY (id);
alter table public."case_progress_updates" add constraint "case_progress_updates_pkey" PRIMARY KEY (id);
alter table public."case_progress_updates" add constraint "case_progress_updates_plan_changes_check" CHECK (jsonb_typeof(plan_changes) = 'array'::text);
alter table public."case_progress_updates" add constraint "case_progress_updates_summary_check" CHECK (char_length(btrim(summary)) >= 1 AND char_length(btrim(summary)) <= 12000);
alter table public."families" add constraint "families_pkey" PRIMARY KEY (id);
alter table public."family_barriers" add constraint "family_barriers_pkey" PRIMARY KEY (id);
alter table public."family_case_managers" add constraint "family_case_managers_pkey" PRIMARY KEY (family_id, user_id);
alter table public."family_goals" add constraint "family_goals_pkey" PRIMARY KEY (id);
alter table public."family_members" add constraint "family_members_pkey" PRIMARY KEY (id);
alter table public."plan_step_action_items" add constraint "plan_step_action_items_pkey" PRIMARY KEY (id);
alter table public."plan_step_action_items" add constraint "plan_step_action_items_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'blocked'::text]));
alter table public."plan_step_activity" add constraint "plan_step_activity_pkey" PRIMARY KEY (id);
alter table public."plan_step_resources" add constraint "plan_step_resources_pkey" PRIMARY KEY (plan_step_id, resource_id);
alter table public."plan_steps" add constraint "plan_steps_pkey" PRIMARY KEY (id);
alter table public."plan_steps" add constraint "plan_steps_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]));
alter table public."plans" add constraint "plans_family_id_version_key" UNIQUE (family_id, version);
alter table public."plans" add constraint "plans_pkey" PRIMARY KEY (id);
alter table public."referrals" add constraint "referrals_pkey" PRIMARY KEY (id);
alter table public."resource_import_runs" add constraint "resource_import_runs_pkey" PRIMARY KEY (id);
alter table public."resource_matches" add constraint "resource_matches_family_id_resource_id_key" UNIQUE (family_id, resource_id);
alter table public."resource_matches" add constraint "resource_matches_pkey" PRIMARY KEY (id);
alter table public."resources" add constraint "resources_import_key_key" UNIQUE (import_key);
alter table public."resources" add constraint "resources_pkey" PRIMARY KEY (id);
alter table public."resources" add constraint "resources_slug_key" UNIQUE (slug);
alter table public."tasks" add constraint "tasks_pkey" PRIMARY KEY (id);
alter table public."activity_log" add constraint "activity_log_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES app_users(id);
alter table public."activity_log" add constraint "activity_log_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."app_users" add constraint "app_users_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."barrier_plan_records" add constraint "barrier_plan_records_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."barrier_plan_records" add constraint "barrier_plan_records_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."case_notes" add constraint "case_notes_author_id_fkey" FOREIGN KEY (author_id) REFERENCES app_users(id);
alter table public."case_notes" add constraint "case_notes_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."case_progress_updates" add constraint "case_progress_updates_author_id_fkey" FOREIGN KEY (author_id) REFERENCES app_users(id);
alter table public."case_progress_updates" add constraint "case_progress_updates_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."case_progress_updates" add constraint "case_progress_updates_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
alter table public."families" add constraint "families_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES app_users(id);
alter table public."family_barriers" add constraint "family_barriers_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."family_case_managers" add constraint "family_case_managers_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."family_case_managers" add constraint "family_case_managers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."family_goals" add constraint "family_goals_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."family_members" add constraint "family_members_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."plan_step_action_items" add constraint "plan_step_action_items_plan_step_id_fkey" FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id) ON DELETE CASCADE;
alter table public."plan_step_activity" add constraint "plan_step_activity_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES app_users(id);
alter table public."plan_step_activity" add constraint "plan_step_activity_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."plan_step_activity" add constraint "plan_step_activity_plan_step_id_fkey" FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id) ON DELETE CASCADE;
alter table public."plan_step_resources" add constraint "plan_step_resources_plan_step_id_fkey" FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id) ON DELETE CASCADE;
alter table public."plan_step_resources" add constraint "plan_step_resources_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
alter table public."plan_steps" add constraint "plan_steps_assigned_to_id_fkey" FOREIGN KEY (assigned_to_id) REFERENCES app_users(id);
alter table public."plan_steps" add constraint "plan_steps_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE;
alter table public."plans" add constraint "plans_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."referrals" add constraint "referrals_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."referrals" add constraint "referrals_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES resources(id);
alter table public."resource_matches" add constraint "resource_matches_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."resource_matches" add constraint "resource_matches_plan_step_id_fkey" FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id) ON DELETE SET NULL;
alter table public."resource_matches" add constraint "resource_matches_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
alter table public."tasks" add constraint "tasks_created_by_id_fkey" FOREIGN KEY (created_by_id) REFERENCES app_users(id);
alter table public."tasks" add constraint "tasks_family_id_fkey" FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public."tasks" add constraint "tasks_plan_step_id_fkey" FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id);
CREATE INDEX activity_log_created_at_idx ON public.activity_log USING btree (created_at);
CREATE INDEX activity_log_family_id_idx ON public.activity_log USING btree (family_id);
CREATE INDEX idx_barrier_plan_records_owner_updated ON public.barrier_plan_records USING btree (owner_user_id, updated_at DESC);
CREATE INDEX case_notes_family_id_idx ON public.case_notes USING btree (family_id);
CREATE INDEX case_progress_updates_family_date_idx ON public.case_progress_updates USING btree (family_id, occurred_on DESC, created_at DESC);
CREATE INDEX families_archived_at_list_idx ON public.families USING btree (archived_at) WHERE (archived_at IS NULL);
CREATE INDEX families_created_by_id_idx ON public.families USING btree (created_by_id);
CREATE INDEX families_status_idx ON public.families USING btree (status);
CREATE INDEX family_barriers_family_id_idx ON public.family_barriers USING btree (family_id);
CREATE INDEX family_goals_family_id_idx ON public.family_goals USING btree (family_id);
CREATE INDEX family_members_family_id_idx ON public.family_members USING btree (family_id);
CREATE INDEX plan_step_action_items_step_idx ON public.plan_step_action_items USING btree (plan_step_id);
CREATE INDEX plan_step_action_items_target_date_idx ON public.plan_step_action_items USING btree (target_date);
CREATE INDEX plan_step_activity_created_idx ON public.plan_step_activity USING btree (created_at);
CREATE INDEX plan_step_activity_family_idx ON public.plan_step_activity USING btree (family_id);
CREATE INDEX plan_step_activity_step_idx ON public.plan_step_activity USING btree (plan_step_id);
CREATE INDEX plan_steps_plan_id_idx ON public.plan_steps USING btree (plan_id);
CREATE INDEX plans_family_id_idx ON public.plans USING btree (family_id);
CREATE INDEX referrals_family_id_idx ON public.referrals USING btree (family_id);
CREATE INDEX resource_matches_family_id_idx ON public.resource_matches USING btree (family_id);
CREATE INDEX resource_matches_plan_step_idx ON public.resource_matches USING btree (plan_step_id);
CREATE INDEX tasks_family_id_idx ON public.tasks USING btree (family_id);

CREATE OR REPLACE FUNCTION public.can_access_family(p_family_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_app_admin()
    or exists (
      select 1
      from public.families f
      where f.id = p_family_id
        and f.created_by_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.family_case_managers m
      where m.family_id = p_family_id
        and m.user_id = (select auth.uid())
    );
$function$
;

CREATE OR REPLACE FUNCTION public.capture_case_progress_update(p_family_id uuid, p_plan_id uuid, p_occurred_on date, p_summary text, p_changes jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_family_intake_row(p_name text, p_summary text, p_urgency family_urgency, p_household_notes text, p_status family_status DEFAULT 'active'::family_status)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  insert into public.families (
    name,
    summary,
    urgency,
    household_notes,
    status,
    created_by_id
  )
  values (
    p_name,
    p_summary,
    p_urgency,
    p_household_notes,
    coalesce(p_status, 'active'),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_app_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.app_users u
    where u.id = (select auth.uid())
      and u.role = 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE TRIGGER app_users_set_updated_at BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER barrier_plan_records_set_updated_at BEFORE UPDATE ON barrier_plan_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER families_set_updated_at BEFORE UPDATE ON families FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER plan_step_action_items_set_updated_at BEFORE UPDATE ON plan_step_action_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER plan_steps_set_updated_at BEFORE UPDATE ON plan_steps FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER referrals_set_updated_at BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER resource_matches_set_updated_at BEFORE UPDATE ON resource_matches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER resources_set_updated_at BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
alter table public."activity_log" enable row level security;
alter table public."app_users" enable row level security;
alter table public."barrier_plan_records" enable row level security;
alter table public."case_notes" enable row level security;
alter table public."case_progress_updates" enable row level security;
alter table public."families" enable row level security;
alter table public."family_barriers" enable row level security;
alter table public."family_case_managers" enable row level security;
alter table public."family_goals" enable row level security;
alter table public."family_members" enable row level security;
alter table public."plan_step_action_items" enable row level security;
alter table public."plan_step_activity" enable row level security;
alter table public."plan_step_resources" enable row level security;
alter table public."plan_steps" enable row level security;
alter table public."plans" enable row level security;
alter table public."referrals" enable row level security;
alter table public."resource_import_runs" enable row level security;
alter table public."resource_matches" enable row level security;
alter table public."resources" enable row level security;
alter table public."tasks" enable row level security;
create policy "activity_log_insert" on public."activity_log" as PERMISSIVE for INSERT to "authenticated" with check ((can_access_family(family_id) AND ((actor_user_id IS NULL) OR (actor_user_id = ( SELECT auth.uid() AS uid)))));
create policy "activity_log_select" on public."activity_log" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "app_users_insert_self" on public."app_users" as PERMISSIVE for INSERT to "authenticated" with check ((id = ( SELECT auth.uid() AS uid)));
create policy "app_users_select_family_peers" on public."app_users" as PERMISSIVE for SELECT to "authenticated" using (((EXISTS ( SELECT 1
   FROM families f
  WHERE ((f.created_by_id = app_users.id) AND can_access_family(f.id)))) OR (EXISTS ( SELECT 1
   FROM family_case_managers m
  WHERE ((m.user_id = app_users.id) AND can_access_family(m.family_id)))) OR (EXISTS ( SELECT 1
   FROM case_notes cn
  WHERE ((cn.author_id = app_users.id) AND can_access_family(cn.family_id))))));
create policy "app_users_select_self" on public."app_users" as PERMISSIVE for SELECT to "authenticated" using ((id = ( SELECT auth.uid() AS uid)));
create policy "app_users_update_self" on public."app_users" as PERMISSIVE for UPDATE to "authenticated" using ((id = ( SELECT auth.uid() AS uid))) with check ((id = ( SELECT auth.uid() AS uid)));
create policy "barrier_plan_records_delete" on public."barrier_plan_records" as PERMISSIVE for DELETE to "authenticated" using ((owner_user_id = ( SELECT auth.uid() AS uid)));
create policy "barrier_plan_records_insert" on public."barrier_plan_records" as PERMISSIVE for INSERT to "authenticated" with check ((owner_user_id = ( SELECT auth.uid() AS uid)));
create policy "barrier_plan_records_select" on public."barrier_plan_records" as PERMISSIVE for SELECT to "authenticated" using ((owner_user_id = ( SELECT auth.uid() AS uid)));
create policy "barrier_plan_records_update" on public."barrier_plan_records" as PERMISSIVE for UPDATE to "authenticated" using ((owner_user_id = ( SELECT auth.uid() AS uid))) with check ((owner_user_id = ( SELECT auth.uid() AS uid)));
create policy "case_notes_delete_own" on public."case_notes" as PERMISSIVE for DELETE to "authenticated" using (((author_id = ( SELECT auth.uid() AS uid)) OR is_app_admin()));
create policy "case_notes_insert" on public."case_notes" as PERMISSIVE for INSERT to "authenticated" with check ((can_access_family(family_id) AND (author_id = ( SELECT auth.uid() AS uid))));
create policy "case_notes_select" on public."case_notes" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "case_notes_update_own" on public."case_notes" as PERMISSIVE for UPDATE to "authenticated" using (((author_id = ( SELECT auth.uid() AS uid)) OR is_app_admin())) with check (((author_id = ( SELECT auth.uid() AS uid)) OR is_app_admin()));
create policy "case_progress_updates_insert" on public."case_progress_updates" as PERMISSIVE for INSERT to "authenticated" with check ((can_access_family(family_id) AND (author_id = ( SELECT auth.uid() AS uid))));
create policy "case_progress_updates_select" on public."case_progress_updates" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "families_delete_owner_or_admin" on public."families" as PERMISSIVE for DELETE to "authenticated" using ((is_app_admin() OR (created_by_id = ( SELECT auth.uid() AS uid))));
create policy "families_insert_creator" on public."families" as PERMISSIVE for INSERT to "authenticated" with check ((created_by_id = ( SELECT auth.uid() AS uid)));
create policy "families_select_access" on public."families" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(id));
create policy "families_update_access" on public."families" as PERMISSIVE for UPDATE to "authenticated" using (can_access_family(id)) with check (can_access_family(id));
create policy "family_barriers_all" on public."family_barriers" as PERMISSIVE for ALL to "authenticated" using (can_access_family(family_id)) with check (can_access_family(family_id));
create policy "family_case_managers_delete" on public."family_case_managers" as PERMISSIVE for DELETE to "authenticated" using ((is_app_admin() OR (EXISTS ( SELECT 1
   FROM families f
  WHERE ((f.id = family_case_managers.family_id) AND (f.created_by_id = ( SELECT auth.uid() AS uid)))))));
create policy "family_case_managers_insert" on public."family_case_managers" as PERMISSIVE for INSERT to "authenticated" with check ((can_access_family(family_id) AND (is_app_admin() OR (EXISTS ( SELECT 1
   FROM families f
  WHERE ((f.id = family_case_managers.family_id) AND (f.created_by_id = ( SELECT auth.uid() AS uid))))))));
create policy "family_case_managers_select" on public."family_case_managers" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "family_goals_all" on public."family_goals" as PERMISSIVE for ALL to "authenticated" using (can_access_family(family_id)) with check (can_access_family(family_id));
create policy "family_members_all" on public."family_members" as PERMISSIVE for ALL to "authenticated" using (can_access_family(family_id)) with check (can_access_family(family_id));
create policy "plan_step_action_items_delete" on public."plan_step_action_items" as PERMISSIVE for DELETE to "authenticated" using ((EXISTS ( SELECT 1
   FROM (plan_steps ps
     JOIN plans p ON ((p.id = ps.plan_id)))
  WHERE ((ps.id = plan_step_action_items.plan_step_id) AND can_access_family(p.family_id)))));
create policy "plan_step_action_items_insert" on public."plan_step_action_items" as PERMISSIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM (plan_steps ps
     JOIN plans p ON ((p.id = ps.plan_id)))
  WHERE ((ps.id = plan_step_action_items.plan_step_id) AND can_access_family(p.family_id)))));
create policy "plan_step_action_items_select" on public."plan_step_action_items" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM (plan_steps ps
     JOIN plans p ON ((p.id = ps.plan_id)))
  WHERE ((ps.id = plan_step_action_items.plan_step_id) AND can_access_family(p.family_id)))));
create policy "plan_step_action_items_update" on public."plan_step_action_items" as PERMISSIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM (plan_steps ps
     JOIN plans p ON ((p.id = ps.plan_id)))
  WHERE ((ps.id = plan_step_action_items.plan_step_id) AND can_access_family(p.family_id)))));
create policy "plan_step_activity_insert" on public."plan_step_activity" as PERMISSIVE for INSERT to "authenticated" with check ((can_access_family(family_id) AND ((actor_user_id IS NULL) OR (actor_user_id = ( SELECT auth.uid() AS uid)))));
create policy "plan_step_activity_select" on public."plan_step_activity" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "plan_step_resources_delete" on public."plan_step_resources" as PERMISSIVE for DELETE to "authenticated" using ((EXISTS ( SELECT 1
   FROM (plan_steps ps
     JOIN plans p ON ((p.id = ps.plan_id)))
  WHERE ((ps.id = plan_step_resources.plan_step_id) AND can_access_family(p.family_id)))));
create policy "plan_step_resources_insert" on public."plan_step_resources" as PERMISSIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM (plan_steps ps
     JOIN plans p ON ((p.id = ps.plan_id)))
  WHERE ((ps.id = plan_step_resources.plan_step_id) AND can_access_family(p.family_id)))));
create policy "plan_step_resources_select" on public."plan_step_resources" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM (plan_steps ps
     JOIN plans p ON ((p.id = ps.plan_id)))
  WHERE ((ps.id = plan_step_resources.plan_step_id) AND can_access_family(p.family_id)))));
create policy "plan_steps_delete" on public."plan_steps" as PERMISSIVE for DELETE to "authenticated" using ((EXISTS ( SELECT 1
   FROM plans p
  WHERE ((p.id = plan_steps.plan_id) AND can_access_family(p.family_id)))));
create policy "plan_steps_insert" on public."plan_steps" as PERMISSIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM plans p
  WHERE ((p.id = plan_steps.plan_id) AND can_access_family(p.family_id)))));
create policy "plan_steps_select" on public."plan_steps" as PERMISSIVE for SELECT to "authenticated" using ((EXISTS ( SELECT 1
   FROM plans p
  WHERE ((p.id = plan_steps.plan_id) AND can_access_family(p.family_id)))));
create policy "plan_steps_update" on public."plan_steps" as PERMISSIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM plans p
  WHERE ((p.id = plan_steps.plan_id) AND can_access_family(p.family_id))))) with check ((EXISTS ( SELECT 1
   FROM plans p
  WHERE ((p.id = plan_steps.plan_id) AND can_access_family(p.family_id)))));
create policy "plans_delete" on public."plans" as PERMISSIVE for DELETE to "authenticated" using (can_access_family(family_id));
create policy "plans_insert" on public."plans" as PERMISSIVE for INSERT to "authenticated" with check (can_access_family(family_id));
create policy "plans_select" on public."plans" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "plans_update" on public."plans" as PERMISSIVE for UPDATE to "authenticated" using (can_access_family(family_id)) with check (can_access_family(family_id));
create policy "referrals_delete" on public."referrals" as PERMISSIVE for DELETE to "authenticated" using (can_access_family(family_id));
create policy "referrals_insert" on public."referrals" as PERMISSIVE for INSERT to "authenticated" with check (can_access_family(family_id));
create policy "referrals_select" on public."referrals" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "referrals_update" on public."referrals" as PERMISSIVE for UPDATE to "authenticated" using (can_access_family(family_id)) with check (can_access_family(family_id));
create policy "resource_import_runs_deny_anon" on public."resource_import_runs" as PERMISSIVE for ALL to "anon" using (false) with check (false);
create policy "resource_import_runs_deny_authenticated" on public."resource_import_runs" as PERMISSIVE for ALL to "authenticated" using (false) with check (false);
create policy "resource_matches_delete" on public."resource_matches" as PERMISSIVE for DELETE to "authenticated" using (can_access_family(family_id));
create policy "resource_matches_insert" on public."resource_matches" as PERMISSIVE for INSERT to "authenticated" with check (can_access_family(family_id));
create policy "resource_matches_select" on public."resource_matches" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "resource_matches_update" on public."resource_matches" as PERMISSIVE for UPDATE to "authenticated" using (can_access_family(family_id)) with check (can_access_family(family_id));
create policy "resources_select_authenticated" on public."resources" as PERMISSIVE for SELECT to "authenticated" using (true);
create policy "tasks_delete" on public."tasks" as PERMISSIVE for DELETE to "authenticated" using (can_access_family(family_id));
create policy "tasks_insert" on public."tasks" as PERMISSIVE for INSERT to "authenticated" with check (can_access_family(family_id));
create policy "tasks_select" on public."tasks" as PERMISSIVE for SELECT to "authenticated" using (can_access_family(family_id));
create policy "tasks_update" on public."tasks" as PERMISSIVE for UPDATE to "authenticated" using (can_access_family(family_id)) with check (can_access_family(family_id));
revoke all on all tables in schema public from public, anon, authenticated, service_role;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."activity_log" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."activity_log" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."activity_log" to "service_role";
grant SELECT on public."app_users" to "anon";
grant SELECT on public."app_users" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."app_users" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."barrier_plan_records" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."barrier_plan_records" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."barrier_plan_records" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."case_notes" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."case_notes" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."case_notes" to "service_role";
grant INSERT, SELECT on public."case_progress_updates" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."case_progress_updates" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."families" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."families" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."families" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_barriers" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_barriers" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_barriers" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_case_managers" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_case_managers" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_case_managers" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_goals" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_goals" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_goals" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_members" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_members" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."family_members" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_action_items" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_action_items" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_action_items" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_activity" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_activity" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_activity" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_resources" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_resources" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_step_resources" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_steps" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_steps" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plan_steps" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plans" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plans" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."plans" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."referrals" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."referrals" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."referrals" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resource_import_runs" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resource_import_runs" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resource_import_runs" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resource_matches" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resource_matches" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resource_matches" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resources" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resources" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."resources" to "service_role";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tasks" to "anon";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tasks" to "authenticated";
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public."tasks" to "service_role";
grant UPDATE ("bio") on public."app_users" to "authenticated";
grant UPDATE ("display_name") on public."app_users" to "authenticated";
grant UPDATE ("job_title") on public."app_users" to "authenticated";
grant UPDATE ("notes_signature") on public."app_users" to "authenticated";
grant UPDATE ("organization") on public."app_users" to "authenticated";
grant UPDATE ("phone") on public."app_users" to "authenticated";
grant UPDATE ("preferred_contact_method") on public."app_users" to "authenticated";
grant UPDATE ("pronouns") on public."app_users" to "authenticated";
grant UPDATE ("service_area") on public."app_users" to "authenticated";
revoke all on function public."can_access_family"(p_family_id uuid) from public, anon, authenticated, service_role;
grant execute on function public."can_access_family"(p_family_id uuid) to "authenticated";
grant execute on function public."can_access_family"(p_family_id uuid) to "service_role";
revoke all on function public."capture_case_progress_update"(p_family_id uuid, p_plan_id uuid, p_occurred_on date, p_summary text, p_changes jsonb) from public, anon, authenticated, service_role;
grant execute on function public."capture_case_progress_update"(p_family_id uuid, p_plan_id uuid, p_occurred_on date, p_summary text, p_changes jsonb) to "authenticated";
grant execute on function public."capture_case_progress_update"(p_family_id uuid, p_plan_id uuid, p_occurred_on date, p_summary text, p_changes jsonb) to "service_role";
revoke all on function public."create_family_intake_row"(p_name text, p_summary text, p_urgency family_urgency, p_household_notes text, p_status family_status) from public, anon, authenticated, service_role;
grant execute on function public."create_family_intake_row"(p_name text, p_summary text, p_urgency family_urgency, p_household_notes text, p_status family_status) to "authenticated";
grant execute on function public."create_family_intake_row"(p_name text, p_summary text, p_urgency family_urgency, p_household_notes text, p_status family_status) to "service_role";
revoke all on function public."is_app_admin"() from public, anon, authenticated, service_role;
grant execute on function public."is_app_admin"() to "authenticated";
grant execute on function public."is_app_admin"() to "service_role";
revoke all on function public."set_updated_at"() from public, anon, authenticated, service_role;
grant execute on function public."set_updated_at"() to PUBLIC;
grant execute on function public."set_updated_at"() to "anon";
grant execute on function public."set_updated_at"() to "authenticated";
grant execute on function public."set_updated_at"() to "service_role";
set check_function_bodies = true;
grant MAINTAIN on "public"."activity_log" to "anon";
grant MAINTAIN on "public"."activity_log" to "authenticated";
grant MAINTAIN on "public"."activity_log" to "service_role";
grant MAINTAIN on "public"."app_users" to "anon";
grant MAINTAIN on "public"."app_users" to "authenticated";
grant MAINTAIN on "public"."app_users" to "service_role";
grant MAINTAIN on "public"."barrier_plan_records" to "anon";
grant MAINTAIN on "public"."barrier_plan_records" to "authenticated";
grant MAINTAIN on "public"."barrier_plan_records" to "service_role";
grant MAINTAIN on "public"."case_notes" to "anon";
grant MAINTAIN on "public"."case_notes" to "authenticated";
grant MAINTAIN on "public"."case_notes" to "service_role";
grant MAINTAIN on "public"."case_progress_updates" to "service_role";
grant MAINTAIN on "public"."families" to "anon";
grant MAINTAIN on "public"."families" to "authenticated";
grant MAINTAIN on "public"."families" to "service_role";
grant MAINTAIN on "public"."family_barriers" to "anon";
grant MAINTAIN on "public"."family_barriers" to "authenticated";
grant MAINTAIN on "public"."family_barriers" to "service_role";
grant MAINTAIN on "public"."family_case_managers" to "anon";
grant MAINTAIN on "public"."family_case_managers" to "authenticated";
grant MAINTAIN on "public"."family_case_managers" to "service_role";
grant MAINTAIN on "public"."family_goals" to "anon";
grant MAINTAIN on "public"."family_goals" to "authenticated";
grant MAINTAIN on "public"."family_goals" to "service_role";
grant MAINTAIN on "public"."family_members" to "anon";
grant MAINTAIN on "public"."family_members" to "authenticated";
grant MAINTAIN on "public"."family_members" to "service_role";
grant MAINTAIN on "public"."plan_step_action_items" to "anon";
grant MAINTAIN on "public"."plan_step_action_items" to "authenticated";
grant MAINTAIN on "public"."plan_step_action_items" to "service_role";
grant MAINTAIN on "public"."plan_step_activity" to "anon";
grant MAINTAIN on "public"."plan_step_activity" to "authenticated";
grant MAINTAIN on "public"."plan_step_activity" to "service_role";
grant MAINTAIN on "public"."plan_step_resources" to "anon";
grant MAINTAIN on "public"."plan_step_resources" to "authenticated";
grant MAINTAIN on "public"."plan_step_resources" to "service_role";
grant MAINTAIN on "public"."plan_steps" to "anon";
grant MAINTAIN on "public"."plan_steps" to "authenticated";
grant MAINTAIN on "public"."plan_steps" to "service_role";
grant MAINTAIN on "public"."plans" to "anon";
grant MAINTAIN on "public"."plans" to "authenticated";
grant MAINTAIN on "public"."plans" to "service_role";
grant MAINTAIN on "public"."referrals" to "anon";
grant MAINTAIN on "public"."referrals" to "authenticated";
grant MAINTAIN on "public"."referrals" to "service_role";
grant MAINTAIN on "public"."resource_import_runs" to "anon";
grant MAINTAIN on "public"."resource_import_runs" to "authenticated";
grant MAINTAIN on "public"."resource_import_runs" to "service_role";
grant MAINTAIN on "public"."resource_matches" to "anon";
grant MAINTAIN on "public"."resource_matches" to "authenticated";
grant MAINTAIN on "public"."resource_matches" to "service_role";
grant MAINTAIN on "public"."resources" to "anon";
grant MAINTAIN on "public"."resources" to "authenticated";
grant MAINTAIN on "public"."resources" to "service_role";
grant MAINTAIN on "public"."tasks" to "anon";
grant MAINTAIN on "public"."tasks" to "authenticated";
grant MAINTAIN on "public"."tasks" to "service_role";

-- The restored project's postgres defaults affect future migration objects.
alter default privileges for role postgres in schema public grant SELECT on sequences to "postgres";
alter default privileges for role postgres in schema public grant UPDATE on sequences to "postgres";
alter default privileges for role postgres in schema public grant USAGE on sequences to "postgres";
alter default privileges for role postgres in schema public grant SELECT on sequences to "anon";
alter default privileges for role postgres in schema public grant UPDATE on sequences to "anon";
alter default privileges for role postgres in schema public grant USAGE on sequences to "anon";
alter default privileges for role postgres in schema public grant SELECT on sequences to "authenticated";
alter default privileges for role postgres in schema public grant UPDATE on sequences to "authenticated";
alter default privileges for role postgres in schema public grant USAGE on sequences to "authenticated";
alter default privileges for role postgres in schema public grant SELECT on sequences to "service_role";
alter default privileges for role postgres in schema public grant UPDATE on sequences to "service_role";
alter default privileges for role postgres in schema public grant USAGE on sequences to "service_role";
alter default privileges for role postgres in schema public grant EXECUTE on functions to "postgres";
alter default privileges for role postgres in schema public grant EXECUTE on functions to "anon";
alter default privileges for role postgres in schema public grant EXECUTE on functions to "authenticated";
alter default privileges for role postgres in schema public grant EXECUTE on functions to "service_role";
alter default privileges for role postgres in schema public grant DELETE on tables to "postgres";
alter default privileges for role postgres in schema public grant INSERT on tables to "postgres";
alter default privileges for role postgres in schema public grant MAINTAIN on tables to "postgres";
alter default privileges for role postgres in schema public grant REFERENCES on tables to "postgres";
alter default privileges for role postgres in schema public grant SELECT on tables to "postgres";
alter default privileges for role postgres in schema public grant TRIGGER on tables to "postgres";
alter default privileges for role postgres in schema public grant TRUNCATE on tables to "postgres";
alter default privileges for role postgres in schema public grant UPDATE on tables to "postgres";
alter default privileges for role postgres in schema public grant DELETE on tables to "anon";
alter default privileges for role postgres in schema public grant INSERT on tables to "anon";
alter default privileges for role postgres in schema public grant MAINTAIN on tables to "anon";
alter default privileges for role postgres in schema public grant REFERENCES on tables to "anon";
alter default privileges for role postgres in schema public grant SELECT on tables to "anon";
alter default privileges for role postgres in schema public grant TRIGGER on tables to "anon";
alter default privileges for role postgres in schema public grant TRUNCATE on tables to "anon";
alter default privileges for role postgres in schema public grant UPDATE on tables to "anon";
alter default privileges for role postgres in schema public grant DELETE on tables to "authenticated";
alter default privileges for role postgres in schema public grant INSERT on tables to "authenticated";
alter default privileges for role postgres in schema public grant MAINTAIN on tables to "authenticated";
alter default privileges for role postgres in schema public grant REFERENCES on tables to "authenticated";
alter default privileges for role postgres in schema public grant SELECT on tables to "authenticated";
alter default privileges for role postgres in schema public grant TRIGGER on tables to "authenticated";
alter default privileges for role postgres in schema public grant TRUNCATE on tables to "authenticated";
alter default privileges for role postgres in schema public grant UPDATE on tables to "authenticated";
alter default privileges for role postgres in schema public grant DELETE on tables to "service_role";
alter default privileges for role postgres in schema public grant INSERT on tables to "service_role";
alter default privileges for role postgres in schema public grant MAINTAIN on tables to "service_role";
alter default privileges for role postgres in schema public grant REFERENCES on tables to "service_role";
alter default privileges for role postgres in schema public grant SELECT on tables to "service_role";
alter default privileges for role postgres in schema public grant TRIGGER on tables to "service_role";
alter default privileges for role postgres in schema public grant TRUNCATE on tables to "service_role";
alter default privileges for role postgres in schema public grant UPDATE on tables to "service_role";
