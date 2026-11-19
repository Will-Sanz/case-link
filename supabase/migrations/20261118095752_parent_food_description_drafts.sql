-- Optional pre-mandate interpretation is a separate, default-closed purpose. No provider is enabled.
-- Proposed retention: content/source bindings 24h; opaque owned quota/usage evidence 48h, both from creation.
alter table parent_private.processing_controls
  add column food_description_enabled boolean not null default false,
  add column food_description_approval_reference text,
  add column food_description_approved_until timestamptz,
  add column food_description_notice_version text,
  add column food_description_processor_reference text,
  add column food_description_evaluation_reference text,
  add column food_description_evaluation_fingerprint text,
  add column food_description_retention_reference text,
  add column food_description_project_budget_reference text,
  add column food_description_project_id text check(food_description_project_id ~ '^proj_[A-Za-z0-9_-]{1,100}$'),
  add column food_description_budget_reference text,
  add column food_description_budget_started_at timestamptz,
  add column food_description_call_limit integer check(food_description_call_limit between 1 and 10000);
alter table parent_private.worker_health
  add column food_description_ready_until timestamptz,
  add column food_description_fingerprint text,
  add column food_description_project_id text;
alter table parent_private.model_call_reservations
  add column purpose text check(purpose is null or purpose='food_description');
create index parent_model_description_reservations_time on parent_private.model_call_reservations(created_at) where purpose='food_description';

create table parent_private.food_description_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  create_key uuid not null, revision integer not null default 0 check(revision>=0),
  state text not null default 'empty' check(state in ('empty','queued','running','result','failed','unknown','cancelled','expired')),
  notice_version text not null, consented_at timestamptz not null default clock_timestamp(),
  input jsonb, context jsonb, projection jsonb, selection jsonb, payload_hash text,
  queue_key uuid, dispatch_until timestamptz, lease_token uuid, lease_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(),
  content_expires_at timestamptz not null default now()+interval '24 hours',
  metadata_expires_at timestamptz not null default now()+interval '48 hours',
  unique(owner_id,create_key),
  check(content_expires_at=created_at+interval '24 hours' and metadata_expires_at=created_at+interval '48 hours')
);
create unique index parent_food_description_active on parent_private.food_description_drafts(owner_id) where state not in ('cancelled','expired');
create table parent_private.food_description_calls (
  draft_id uuid not null references parent_private.food_description_drafts(id) on delete cascade,
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  revision integer not null, charge_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  project_id text not null, usage jsonb, primary key(draft_id,revision)
);
create index parent_food_description_calls_owner_time on parent_private.food_description_calls(owner_id,created_at);
alter table parent_private.food_description_drafts enable row level security;
alter table parent_private.food_description_calls enable row level security;
revoke all on parent_private.food_description_drafts,parent_private.food_description_calls from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

create function parent_private.food_description_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and coalesce((select c.food_description_enabled
    and c.food_description_notice_version='food-description-2026-11-18.v1'
    and c.food_description_approved_until>clock_timestamp() and isfinite(c.food_description_approved_until)
    and length(btrim(coalesce(c.food_description_approval_reference,'')))>0
    and length(btrim(coalesce(c.food_description_processor_reference,'')))>0
    and length(btrim(coalesce(c.food_description_evaluation_reference,'')))>0
    and length(btrim(coalesce(c.food_description_retention_reference,'')))>0
    and length(btrim(coalesce(c.food_description_project_budget_reference,'')))>0
    and c.food_description_project_id is not null and h.food_description_project_id=c.food_description_project_id
    and length(btrim(coalesce(c.food_description_budget_reference,'')))>0
    and c.model_call_limit is not null and c.model_budget_started_at<=clock_timestamp()
    and c.food_description_call_limit is not null and c.food_description_budget_started_at<=clock_timestamp()
    and h.food_description_ready_until>clock_timestamp()
    and h.food_description_fingerprint=c.food_description_evaluation_fingerprint
    and length(coalesce(h.food_description_fingerprint,''))=64
    from parent_private.processing_controls c join parent_private.worker_health h on h.singleton=c.singleton where c.singleton),false);
$$;
create function parent_private.food_description_owner_available(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.food_description_enabled() and exists(select 1 from public.parent_accounts a join auth.users u on u.id=a.id
    where a.id=p_owner and a.status='active' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<clock_timestamp()) and parent_private.existing_account_available(a.id)
      and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')));
$$;
create function parent_private.parent_record_food_description_health(p_ready boolean,p_fingerprint text,p_project_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or (p_ready and (p_project_id is null or p_project_id !~ '^proj_[A-Za-z0-9_-]{1,100}$')) then raise exception 'invalid description fingerprint' using errcode='23514'; end if;
  insert into parent_private.worker_health(singleton,heartbeat_at,expires_at,planning_ready,assistant_ready,food_description_ready_until,food_description_fingerprint,food_description_project_id)
    values(true,clock_timestamp(),clock_timestamp(),false,false,case when p_ready then clock_timestamp()+interval '60 seconds' else null end,case when p_ready then p_fingerprint else null end,case when p_ready then p_project_id else null end)
    on conflict(singleton) do update set food_description_ready_until=excluded.food_description_ready_until,food_description_fingerprint=excluded.food_description_fingerprint,food_description_project_id=excluded.food_description_project_id;
end $$;

-- Preserve the old no-argument port and its exact shared project lock. Only the gated reservation below may label a charge.
create function parent_private.reserve_model_capacity(p_purpose text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_start timestamptz; v_limit integer; c parent_private.processing_controls;
begin
  if p_purpose is not null and p_purpose<>'food_description' then raise exception 'invalid model purpose' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(627281901);
  select * into c from parent_private.processing_controls where singleton;
  v_start:=c.model_budget_started_at; v_limit:=c.model_call_limit;
  if v_start>now() then return false; end if;
  if v_limit is not null and greatest(
    (select count(*) from parent_private.model_call_reservations where created_at>=v_start),
    (select count(*) from parent_private.ai_calls where created_at>=v_start)+(select count(*) from parent_private.assistant_calls where created_at>=v_start)
      +(select count(*) from parent_private.food_description_calls where created_at>=v_start)
  )>=v_limit then return false; end if;
  if p_purpose='food_description' and (not parent_private.food_description_enabled()
    or (select count(*) from parent_private.model_call_reservations where purpose='food_description' and created_at>=c.food_description_budget_started_at)>=c.food_description_call_limit) then return false; end if;
  insert into parent_private.model_call_reservations(purpose) values(p_purpose);
  return true;
end $$;
create or replace function parent_private.reserve_model_capacity() returns boolean
language sql security definer set search_path='' as $$select parent_private.reserve_model_capacity(null::text)$$;
-- Add the same owned counter once to both legacy account ceilings and the mixed readiness projection.
do $$declare target regprocedure; definition text; old_text text; new_text text;
begin
  foreach target in array array['parent_private.parent_reserve_ai_call(uuid,uuid)'::regprocedure,'parent_private.parent_reserve_assistant_call(uuid,uuid)'::regprocedure,'parent_private.mixed_food_snap_planning_ready(public.parent_requests)'::regprocedure] loop
    definition:=pg_get_functiondef(target);
    old_text:=case when target='parent_private.mixed_food_snap_planning_ready(public.parent_requests)'::regprocedure then
      '(select count(*) from parent_private.assistant_calls where account_id=owner_id and created_at>now()-interval ''24 hours'')'
      else '(select count(*) from parent_private.ai_calls where account_id=v_owner and created_at>now()-interval ''24 hours'')' end;
    new_text:=old_text||'+(select count(*) from parent_private.food_description_calls where food_description_calls.owner_id='||case when target='parent_private.mixed_food_snap_planning_ready(public.parent_requests)'::regprocedure then '(select h.owner_id from public.parent_households h where h.id=r.household_id)' else 'v_owner' end||' and created_at>now()-interval ''24 hours'')';
    if position(old_text in definition)=0 then raise exception 'description account budget migration target changed'; end if;
    definition:=replace(definition,old_text,new_text);
    if target='parent_private.mixed_food_snap_planning_ready(public.parent_requests)'::regprocedure then
      old_text:='(select count(*) from parent_private.assistant_calls where created_at>=controls.model_budget_started_at)';
      if position(old_text in definition)=0 then raise exception 'description project budget migration target changed'; end if;
      definition:=replace(definition,old_text,old_text||'+(select count(*) from parent_private.food_description_calls where created_at>=controls.model_budget_started_at)');
    end if;
    execute definition;
  end loop;
end $$;

create function parent_private.food_description_context(d parent_private.food_description_drafts) returns jsonb
language sql stable security definer set search_path='' as $$
  with capabilities as (
    select coalesce(jsonb_agg(jsonb_build_object('programId',program_id,'enabled',jsonb_array_length(actions)>0,'actions',actions) order by program_id),'[]') value
    from (select program_id,coalesce(jsonb_agg(action order by action) filter(where enabled and transport_verified and requires_form is not null and required_acts is not null and verified_until>clock_timestamp()),'[]') actions
      from parent_private.provider_capabilities where program_id=any(array['philly-food','share-community-fridge-19129','snap-pa','uesf-benefits']) group by program_id) grouped
  ), history as (
    select coalesce(jsonb_agg(item order by item->>'requestId',item->>'need'),'[]') value from (
      select jsonb_build_object('ownerId',d.owner_id,'requestId',r.id,'requestVersion',r.version,'requestStatus',r.status,'need',n.need,
        'state',coalesce((select observed.state from (
          select o.state,o.updated_at observed_at,case when o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed') then 0 else 1 end priority from public.parent_operations o
            left join lateral parent_private.current_program_operation(r.id,n.need,o.program_id) latest on true
            where o.request_id=r.id and o.need=n.need and parent_private.current_account_evidence(o.request_id,o.need,o.created_at)
              and ((o.state='prepared' and o.request_version=r.version and latest.state is null)
                or (o.state=latest.state and o.evidence is not distinct from latest.evidence))
          union all select e.evidence->>'outcome',e.created_at,1 from public.parent_events e where e.request_id=r.id and e.evidence->>'need'=n.need
            and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'attribution'='parent_reported'
            and parent_private.current_account_evidence(e.request_id,n.need,e.created_at)
            and e.evidence->>'outcome' in ('agency_submitted','assistance_approved','support_received','declined','unresolved','withdrawn')
        ) observed order by observed.priority,observed.observed_at desc limit 1),'checking'),
        'current',true) item
      from public.parent_requests r join public.parent_households h on h.id=r.household_id cross join lateral jsonb_array_elements_text(r.intake->'needs') n(need)
      where h.owner_id=d.owner_id and n.need=any(array['snap_new','snap_pending','snap_renewal','snap_problem'])
        and parent_private.current_account_evidence(r.id,n.need,r.created_at)
      -- Bounded history must retain active cases and prior real benefit progress before unused/cancelled drafts.
      order by case when r.status in ('active','paused') then 0 else 1 end,
        case when exists(select 1 from public.parent_operations o where o.request_id=r.id and o.need=n.need
          and parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.state in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved'))
          or exists(select 1 from public.parent_events e where e.request_id=r.id and e.evidence->>'need'=n.need
            and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'attribution'='parent_reported'
            and parent_private.current_account_evidence(e.request_id,n.need,e.created_at) and e.evidence->>'outcome' in ('agency_submitted','assistance_approved','support_received','declined','unresolved')) then 0 else 1 end,
        r.created_at desc,r.id desc limit 20
    ) owned
  ) select jsonb_build_object('expectedOwnerId',d.owner_id,'ownerId',d.owner_id,'expectedRevision',d.revision,'revision',d.revision,
    'catalogVersion',(select food_description_fingerprint from parent_private.worker_health where singleton),
    'capabilityVersion',encode(sha256(convert_to(jsonb_build_array(capabilities.value,(select food_description_project_id from parent_private.processing_controls where singleton))::text,'UTF8')),'hex'),
    'facts','{}'::jsonb,'history',history.value,'programIds',jsonb_build_array('philly-food','share-community-fridge-19129','snap-pa','uesf-benefits'),
    'capabilities',capabilities.value,'excludedNeedIds','[]'::jsonb) from capabilities,history;
$$;
create function parent_private.food_description_safe(p_input jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_input)='object' and p_input-'description'-'screenLocale'='{}'::jsonb
    and p_input->>'screenLocale' in ('en','es') and jsonb_typeof(p_input->'description')='string'
    and p_input->>'description'=btrim(p_input->>'description') and length(p_input->>'description') between 1 and 500
    and parent_private.assistant_question_safe(p_input->>'description')
    and regexp_replace(normalize(p_input->>'description',NFKD),'[̀-ͯ​‌‍⁠﻿]','','g') !~* '(pregnan|embaraz|postpartum|posparto|breastfeed|lactan|medical|diagnos|diabet|password|passcode|(^|[^[:alnum:]_])(pin|clave)([^[:alnum:]_]|$)|signature|firma|contras[eé]na|seguro social|n[uú]mero de cuenta|fecha de nacimiento|[0-9]{4}-[0-9]{2}-[0-9]{2}|my name is|me llamo|mi nombre es|my child.{0,30}(named|born)|mi hij[oa].{0,30}(llama|nacio)|full text|texto completo|private.{0,30}document|documento privado|[$€£][[:space:]]*[0-9])',false);
$$;
-- Known exhausted capacity never solicits new prose. Reservation still decides races, and last-slot results remain readable.
create function parent_private.food_description_collection_available(p_owner uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c parent_private.processing_controls;
begin
  if not parent_private.food_description_enabled() or (p_owner is not null and not parent_private.food_description_owner_available(p_owner)) then return false; end if;
  select * into c from parent_private.processing_controls where singleton;
  if greatest((select count(*) from parent_private.model_call_reservations where created_at>=c.model_budget_started_at),
      (select count(*) from parent_private.ai_calls where created_at>=c.model_budget_started_at)
      +(select count(*) from parent_private.assistant_calls where created_at>=c.model_budget_started_at)
      +(select count(*) from parent_private.food_description_calls where created_at>=c.model_budget_started_at))>=c.model_call_limit
    or (select count(*) from parent_private.model_call_reservations where purpose='food_description' and created_at>=c.food_description_budget_started_at)>=c.food_description_call_limit then return false; end if;
  if p_owner is not null and ((select count(*) from parent_private.food_description_calls where owner_id=p_owner and created_at>now()-interval '24 hours')>=3
    or (select count(*) from parent_private.food_description_calls where owner_id=p_owner and created_at>now()-interval '24 hours')
      +(select count(*) from parent_private.ai_calls where account_id=p_owner and created_at>now()-interval '24 hours')
      +(select count(*) from parent_private.assistant_calls where account_id=p_owner and created_at>now()-interval '24 hours')>=60) then return false; end if;
  return true;
end $$;
revoke execute on function parent_private.food_description_collection_available(uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
create function public.parent_food_description_available() returns boolean
language sql stable security definer set search_path='' as $$select parent_private.food_description_collection_available(null::uuid)$$;
create function public.parent_create_food_description(p_expected_owner uuid,p_create_key uuid,p_notice_version text,p_consented boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts;
begin
  if public.parent_get_deletion_status()<>'active' or auth.uid() is distinct from p_expected_owner then raise exception 'description owner unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_accounts where id=auth.uid() for update;
  select * into d from parent_private.food_description_drafts where owner_id=auth.uid() and create_key=p_create_key;
  if found then return d.id; end if;
  if not parent_private.food_description_collection_available(auth.uid()) or p_consented is distinct from true or p_notice_version is distinct from 'food-description-2026-11-18.v1' or p_create_key is null then raise exception 'description unavailable' using errcode='42501'; end if;
  update parent_private.food_description_drafts set state='expired',input=null,context=null,projection=null,selection=null,payload_hash=null,lease_token=null,lease_until=null where owner_id=auth.uid() and content_expires_at<=clock_timestamp() and state not in ('cancelled','expired');
  if exists(select 1 from parent_private.food_description_drafts where owner_id=auth.uid() and state not in ('cancelled','expired')) then raise exception 'description draft exists' using errcode='PT409'; end if;
  if (select count(*) from parent_private.food_description_drafts where owner_id=auth.uid())>=12 then raise exception 'description resource limit' using errcode='P0001'; end if;
  insert into parent_private.food_description_drafts(owner_id,create_key,notice_version) values(auth.uid(),p_create_key,p_notice_version) returning id into d.id;
  return d.id;
end $$;
create function public.parent_queue_food_description(p_draft_id uuid,p_expected_owner uuid,p_expected_revision integer,p_queue_key uuid,p_input jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts; v_hash text;
begin
  if public.parent_get_deletion_status()<>'active' or auth.uid() is distinct from p_expected_owner then raise exception 'description owner unavailable' using errcode='42501'; end if;
  select * into d from parent_private.food_description_drafts where id=p_draft_id and owner_id=auth.uid() for update;
  if not found then raise exception 'description owner unavailable' using errcode='42501'; end if;
  if not parent_private.food_description_safe(p_input) or p_queue_key is null then raise exception 'description invalid input' using errcode='23514'; end if;
  v_hash:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
  if d.queue_key=p_queue_key and d.payload_hash=v_hash and d.revision=p_expected_revision+1 and d.state not in ('cancelled','expired') then return d.revision; end if;
  if d.queue_key=p_queue_key or d.revision is distinct from p_expected_revision or d.state in ('cancelled','expired') or d.content_expires_at<=clock_timestamp() then raise exception 'description changed' using errcode='PT409'; end if;
  if not parent_private.food_description_collection_available(auth.uid()) then raise exception 'description unavailable' using errcode='42501'; end if;
  -- Editing supersedes queued/running work; old charged work cannot be reclaimed or committed.
  update parent_private.food_description_drafts set revision=revision+1,state='queued',input=p_input,payload_hash=v_hash,projection=null,selection=null,
    queue_key=p_queue_key,dispatch_until=least(content_expires_at,clock_timestamp()+interval '15 minutes'),lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where id=d.id returning * into d;
  update parent_private.food_description_drafts set context=parent_private.food_description_context(d) where id=d.id;
  return d.revision;
end $$;
create function public.parent_get_food_descriptions() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.parent_get_deletion_status();
  return jsonb_build_object('ownerId',auth.uid(),'available',parent_private.food_description_collection_available(auth.uid()),'drafts',
    (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'revision',d.revision,'state',case when d.content_expires_at<=clock_timestamp() then 'expired'
      when d.state in ('queued','running') and (d.dispatch_until<=clock_timestamp() or (d.state='running' and d.lease_until<=clock_timestamp()))
        then case when exists(select 1 from parent_private.food_description_calls c where c.draft_id=d.id and c.revision=d.revision) then 'unknown' else 'failed' end
      else d.state end,
      'noticeVersion',d.notice_version,'createdAt',d.created_at,'contentExpiresAt',d.content_expires_at,'metadataExpiresAt',d.metadata_expires_at,
      'consentedAt',d.consented_at,'input',case when d.content_expires_at>clock_timestamp() then d.input else null end,
      'projection',case when d.content_expires_at>clock_timestamp() then d.projection else null end,'selection',case when d.content_expires_at>clock_timestamp() then d.selection else null end,
      'queueKey',d.queue_key,'usage',(select coalesce(jsonb_agg(jsonb_build_object('revision',c.revision,'chargedAt',c.created_at,'usage',c.usage) order by c.revision),'[]') from parent_private.food_description_calls c where c.draft_id=d.id)) order by d.created_at desc),'[]')
    from parent_private.food_description_drafts d where d.owner_id=auth.uid() and d.metadata_expires_at>clock_timestamp()));
end $$;
create function public.parent_cancel_food_description(p_draft_id uuid,p_expected_owner uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.parent_get_deletion_status();
  if auth.uid() is distinct from p_expected_owner then raise exception 'description owner unavailable' using errcode='42501'; end if;
  update parent_private.food_description_drafts set state='cancelled',input=null,context=null,projection=null,selection=null,payload_hash=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=p_draft_id and owner_id=auth.uid();
  if not found then raise exception 'description owner unavailable' using errcode='42501'; end if;
end $$;

create function parent_private.parent_claim_food_description() returns jsonb
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts; token uuid:=gen_random_uuid();
begin
  update parent_private.food_description_drafts set state=case when exists(select 1 from parent_private.food_description_calls c where c.draft_id=id and c.revision=food_description_drafts.revision) then 'unknown' else 'failed' end,
    lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where state in ('queued','running') and (dispatch_until<=clock_timestamp() or content_expires_at<=clock_timestamp() or (state='running' and lease_until<=clock_timestamp()) or not parent_private.food_description_owner_available(owner_id));
  if not parent_private.food_description_enabled() then return null; end if;
  select * into d from parent_private.food_description_drafts where state='queued' and dispatch_until>clock_timestamp() and content_expires_at>clock_timestamp()
    and parent_private.food_description_owner_available(owner_id) order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  if d.context is distinct from parent_private.food_description_context(d) then
    update parent_private.food_description_drafts set state='failed',updated_at=clock_timestamp() where id=d.id; return null; end if;
  update parent_private.food_description_drafts set state='running',lease_token=token,lease_until=least(dispatch_until,clock_timestamp()+interval '2 minutes'),updated_at=clock_timestamp() where id=d.id;
  return jsonb_build_object('draftId',d.id,'revision',d.revision,'leaseToken',token,'projectId',(select food_description_project_id from parent_private.processing_controls where singleton),'input',d.input,'context',d.context,'dispatchUntil',d.dispatch_until);
end $$;
create function parent_private.require_food_description_lease(p_draft uuid,p_revision integer,p_token uuid) returns parent_private.food_description_drafts
language plpgsql set search_path='' as $$
declare d parent_private.food_description_drafts;
begin
  select * into d from parent_private.food_description_drafts where id=p_draft for update;
  if not found or d.state<>'running' or d.revision is distinct from p_revision or d.lease_token is distinct from p_token
    or d.lease_until<=clock_timestamp() or d.dispatch_until<=clock_timestamp() or d.content_expires_at<=clock_timestamp()
    or not parent_private.food_description_owner_available(d.owner_id) or d.context is distinct from parent_private.food_description_context(d) then raise exception 'description authority changed' using errcode='42501'; end if;
  return d;
end $$;
create function parent_private.parent_reserve_food_description(p_draft uuid,p_revision integer,p_token uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts; charge uuid;
begin
  -- Account before draft matches account deletion/creation; recheck the exact lease after any wait.
  select * into d from parent_private.food_description_drafts where id=p_draft;
  perform 1 from public.parent_accounts where id=d.owner_id for update;
  d:=parent_private.require_food_description_lease(p_draft,p_revision,p_token);
  if d.projection is null then raise exception 'description projection missing' using errcode='42501'; end if;
  if exists(select 1 from parent_private.food_description_calls where draft_id=d.id and revision=d.revision)
    or (select count(*) from parent_private.food_description_calls where owner_id=d.owner_id and created_at>now()-interval '24 hours')>=3
    or (select count(*) from parent_private.food_description_calls where owner_id=d.owner_id and created_at>now()-interval '24 hours')
      +(select count(*) from parent_private.ai_calls where account_id=d.owner_id and created_at>now()-interval '24 hours')
      +(select count(*) from parent_private.assistant_calls where account_id=d.owner_id and created_at>now()-interval '24 hours')>=60 then return null; end if;
  if not parent_private.reserve_model_capacity('food_description') then return null; end if;
  insert into parent_private.food_description_calls(draft_id,owner_id,revision,project_id) values(d.id,d.owner_id,d.revision,(select food_description_project_id from parent_private.processing_controls where singleton)) returning charge_token into charge;
  return charge;
end $$;
create function parent_private.parent_food_description_current(p_draft uuid,p_revision integer,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts;
begin d:=parent_private.require_food_description_lease(p_draft,p_revision,p_token); return d.context; end $$;
create function parent_private.parent_finish_food_description(p_draft uuid,p_revision integer,p_token uuid,p_selection jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts;
begin
  d:=parent_private.require_food_description_lease(p_draft,p_revision,p_token);
  if not exists(select 1 from parent_private.food_description_calls where draft_id=d.id and revision=d.revision) then raise exception 'description unreserved result' using errcode='42501'; end if;
  if p_selection is null or jsonb_typeof(p_selection)<>'object' or pg_column_size(p_selection)>12000
    or p_selection-array['needIds','selections','assertions','exclusions','questionIds','outOfScope']<>'{}'::jsonb then raise exception 'description invalid result' using errcode='23514'; end if;
  update parent_private.food_description_drafts set state='result',selection=p_selection,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=d.id;
end $$;
create function parent_private.parent_fail_food_description(p_draft uuid,p_revision integer,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update parent_private.food_description_drafts d set state=case when exists(select 1 from parent_private.food_description_calls c where c.draft_id=d.id and c.revision=d.revision) then 'unknown' else 'failed' end,
    lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=p_draft and revision=p_revision and state='running' and lease_token=p_token;
end $$;
-- A late response may add billing evidence to its exact charge after cancellation; it cannot restore content or authority.
create function parent_private.parent_record_food_description_usage(p_charge uuid,p_usage jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_usage is null or jsonb_typeof(p_usage)<>'object' or p_usage-array['inputTokens','outputTokens','cachedInputTokens','reasoningTokens','responseId','requestId','complete']<>'{}'::jsonb
    or pg_column_size(p_usage)>1024 or jsonb_typeof(p_usage->'complete') is distinct from 'boolean'
    or exists(select 1 from jsonb_each(p_usage) item where case
      when item.key in ('responseId','requestId') then jsonb_typeof(item.value)<>'string' or (item.value#>>'{}') !~ '^[A-Za-z0-9_-]{1,200}$'
      when item.key<>'complete' then jsonb_typeof(item.value)<>'number' or (item.value#>>'{}') !~ '^[0-9]{1,8}$' or (item.value#>>'{}')::bigint>10000000
      else false end)
    or (p_usage->'complete'='true' and (not(p_usage ?& array['inputTokens','outputTokens','cachedInputTokens','reasoningTokens'])
      or (p_usage->>'cachedInputTokens')::bigint>(p_usage->>'inputTokens')::bigint or (p_usage->>'reasoningTokens')::bigint>(p_usage->>'outputTokens')::bigint))
    or (p_usage->'complete'='false' and p_usage-array['complete','responseId','requestId']<>'{}'::jsonb)
    then raise exception 'description invalid usage' using errcode='23514'; end if;
  update parent_private.food_description_calls set usage=p_usage where charge_token=p_charge and usage is null;
end $$;
create function parent_private.parent_purge_food_descriptions(p_limit integer) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer; removed integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid purge limit' using errcode='23514'; end if;
  with due as (select d.id from parent_private.food_description_drafts d join public.parent_accounts a on a.id=d.owner_id
    where (d.content_expires_at<=clock_timestamp() or a.status<>'active') and (d.input is not null or d.context is not null or d.projection is not null or d.selection is not null or d.payload_hash is not null)
    order by d.created_at for update of d skip locked limit p_limit)
  update parent_private.food_description_drafts d set state=case when d.state='cancelled' then d.state else 'expired' end,input=null,context=null,projection=null,selection=null,payload_hash=null,lease_token=null,lease_until=null where d.id in (select id from due);
  get diagnostics n=row_count;
  with due as (select id from parent_private.food_description_drafts where metadata_expires_at<=clock_timestamp() order by created_at for update skip locked limit p_limit)
  delete from parent_private.food_description_drafts where id in (select id from due);
  get diagnostics removed=row_count; return n+removed;
end $$;
create function parent_private.food_description_account_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'active' then update parent_private.food_description_drafts set state='cancelled',input=null,context=null,projection=null,selection=null,payload_hash=null,lease_token=null,lease_until=null where owner_id=new.id; end if;
  return new;
end $$;
create trigger parent_food_description_account_status after update of status on public.parent_accounts for each row when(old.status is distinct from new.status) execute function parent_private.food_description_account_changed();

revoke execute on function parent_private.food_description_enabled(),parent_private.food_description_owner_available(uuid),parent_private.parent_record_food_description_health(boolean,text,text),parent_private.reserve_model_capacity(text),parent_private.food_description_context(parent_private.food_description_drafts),parent_private.food_description_safe(jsonb),parent_private.parent_claim_food_description(),parent_private.require_food_description_lease(uuid,integer,uuid),parent_private.parent_reserve_food_description(uuid,integer,uuid),parent_private.parent_food_description_current(uuid,integer,uuid),parent_private.parent_finish_food_description(uuid,integer,uuid,jsonb),parent_private.parent_fail_food_description(uuid,integer,uuid),parent_private.parent_record_food_description_usage(uuid,jsonb),parent_private.parent_purge_food_descriptions(integer),parent_private.food_description_account_changed()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
revoke execute on function public.parent_food_description_available(),public.parent_create_food_description(uuid,uuid,text,boolean),public.parent_queue_food_description(uuid,uuid,integer,uuid,jsonb),public.parent_get_food_descriptions(),public.parent_cancel_food_description(uuid,uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_food_description_available() to anon,authenticated;
grant execute on function public.parent_create_food_description(uuid,uuid,text,boolean),public.parent_queue_food_description(uuid,uuid,integer,uuid,jsonb),public.parent_get_food_descriptions(),public.parent_cancel_food_description(uuid,uuid) to authenticated;
grant execute on function parent_private.parent_record_food_description_health(boolean,text,text),parent_private.parent_claim_food_description(),parent_private.parent_reserve_food_description(uuid,integer,uuid),parent_private.parent_food_description_current(uuid,integer,uuid),parent_private.parent_finish_food_description(uuid,integer,uuid,jsonb),parent_private.parent_fail_food_description(uuid,integer,uuid),parent_private.parent_record_food_description_usage(uuid,jsonb) to parent_worker;
grant execute on function parent_private.parent_purge_food_descriptions(integer) to parent_retention_worker;

create function public.parent_food_description_result(p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts;
begin
  if public.parent_get_deletion_status()<>'active' then raise exception 'description owner unavailable' using errcode='42501'; end if;
  select * into d from parent_private.food_description_drafts where id=p_draft and owner_id=auth.uid();
  if not found or d.state<>'result' or d.content_expires_at<=clock_timestamp() or not parent_private.food_description_owner_available(d.owner_id) then raise exception 'description unavailable' using errcode='42501'; end if;
  return jsonb_build_object('projection',d.projection,'selection',d.selection,'currentContext',parent_private.food_description_context(d));
end $$;
revoke execute on function public.parent_food_description_result(uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_food_description_result(uuid) to authenticated;
-- The upload endpoint establishes current ownership of the server-created ID before reading prose.
create function public.parent_food_description_upload_allowed(p_draft uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if public.parent_get_deletion_status()<>'active' or not parent_private.food_description_collection_available(auth.uid()) then return false; end if;
  return exists(select 1 from parent_private.food_description_drafts where id=p_draft and owner_id=auth.uid()
    and state not in ('cancelled','expired') and content_expires_at>clock_timestamp());
end $$;
revoke execute on function public.parent_food_description_upload_allowed(uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_food_description_upload_allowed(uuid) to authenticated;

create function parent_private.parent_prepare_food_description(p_draft uuid,p_revision integer,p_token uuid,p_projection jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts;
begin
  d:=parent_private.require_food_description_lease(p_draft,p_revision,p_token);
  if p_projection is null or jsonb_typeof(p_projection)<>'object' or pg_column_size(p_projection)>24000
    or p_projection-array['description','screenLocale','revision','catalogVersion','capabilityVersion','routingFacts','ownedFoodHistory','candidates','questionReasons','excludedNeedIds']<>'{}'::jsonb
    or p_projection->'description' is distinct from d.input->'description' or p_projection->'screenLocale' is distinct from d.input->'screenLocale'
    or p_projection->'revision' is distinct from to_jsonb(d.revision)
    or p_projection->'catalogVersion' is distinct from d.context->'catalogVersion'
    or p_projection->'capabilityVersion' is distinct from d.context->'capabilityVersion'
    or (d.projection is not null and d.projection is distinct from p_projection)
    or exists(select 1 from parent_private.food_description_calls where draft_id=d.id and revision=d.revision) then raise exception 'description projection changed' using errcode='PT409'; end if;
  update parent_private.food_description_drafts set projection=p_projection where id=d.id;
end $$;
revoke execute on function parent_private.parent_prepare_food_description(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_prepare_food_description(uuid,integer,uuid,jsonb) to parent_worker;
