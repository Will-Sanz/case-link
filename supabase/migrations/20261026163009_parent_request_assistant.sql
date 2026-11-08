-- Read-only, parent-requested conversation has a fresh purpose grant, separate from execution authority.
create table public.parent_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  request_version integer not null,
  idempotency_key uuid not null,
  question text not null check(length(question) between 1 and 2000),
  status text not null default 'queued' check(status in ('queued','running','answered','failed')),
  answer jsonb,
  error text,
  consented_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(request_id,idempotency_key)
);
create index parent_assistant_request_time on public.parent_assistant_messages(request_id,created_at);
create unique index parent_assistant_pending on public.parent_assistant_messages(request_id) where status in ('queued','running');
alter table public.parent_assistant_messages enable row level security;
revoke all on public.parent_assistant_messages from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant select(id,request_id,question,status,answer,error,created_at,updated_at) on public.parent_assistant_messages to authenticated;
create policy parent_assistant_read on public.parent_assistant_messages for select to authenticated using(parent_private.owns_request(request_id));

create table parent_private.assistant_calls (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.parent_accounts(id) on delete cascade,
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  message_id uuid not null unique references public.parent_assistant_messages(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index parent_assistant_calls_account_time on parent_private.assistant_calls(account_id,created_at);
create index parent_assistant_calls_request_time on parent_private.assistant_calls(request_id,created_at);
alter table parent_private.assistant_calls enable row level security;
revoke all on parent_private.assistant_calls from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;


-- An anonymous reservation survives household deletion so a privacy request never refunds a project cap.
alter table parent_private.processing_controls
  add column model_budget_started_at timestamptz,
  add column model_call_limit integer check(model_call_limit between 1 and 10000),
  add constraint parent_model_budget_config check((model_budget_started_at is null)=(model_call_limit is null));
create table parent_private.model_call_reservations(created_at timestamptz not null default now());
create index parent_model_call_reservations_time on parent_private.model_call_reservations(created_at);
alter table parent_private.model_call_reservations enable row level security;
revoke all on parent_private.model_call_reservations from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
create function parent_private.reserve_model_capacity() returns boolean
language plpgsql security definer set search_path='' as $$
declare v_start timestamptz; v_limit integer;
begin
  perform pg_advisory_xact_lock(627281901);
  select model_budget_started_at,model_call_limit into v_start,v_limit from parent_private.processing_controls where singleton;
  if v_start>now() then return false; end if;
  if v_limit is not null and greatest(
    (select count(*) from parent_private.model_call_reservations where created_at>=v_start),
    (select count(*) from parent_private.ai_calls where created_at>=v_start)+(select count(*) from parent_private.assistant_calls where created_at>=v_start)
  )>=v_limit then return false; end if;
  insert into parent_private.model_call_reservations default values;
  return true;
end $$;

create function parent_private.assistant_question_safe(p_question text) returns boolean
language sql immutable set search_path='' as $$
  with input as (select regexp_replace(normalize(p_question,NFKC),'[​‌‍⁠﻿]','','g') value)
  select length(btrim(coalesce(value,''))) between 1 and 2000
    and not public.contains_direct_identifier(value)
    and value !~* '([0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4})|[0-9]{12,19}|(date[[:space:]]+of[[:space:]]+birth|d\.?o\.?b\.?|born)[[:space:]]*[:#-]?[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}|(password|passcode|pin|ssn|social[[:space:]]+security([[:space:]]+number)?|account[[:space:]]+(number|no)|ebt)[[:space:]]*(is[[:space:]]+|[:=#][[:space:]]*)[^[:space:]]+'
  from input;
$$;
create function public.parent_assistant_available(p_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.owns_request(p_request_id) and exists(select 1 from parent_private.worker_health h where h.singleton and h.assistant_ready and h.expires_at>now());
$$;
create function public.parent_ask_assistant(p_request_id uuid,p_question text,p_idempotency_key uuid,p_consented boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_existing public.parent_assistant_messages; v_id uuid;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if p_consented is distinct from true or p_idempotency_key is null or not parent_private.assistant_question_safe(p_question) then raise exception 'assistant_question_invalid' using errcode='23514'; end if;
  select * into v_existing from public.parent_assistant_messages where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.question is distinct from btrim(p_question) then raise exception 'assistant_question_invalid' using errcode='23514'; end if;
    return v_existing.id;
  end if;
  if not public.parent_assistant_available(p_request_id) then raise exception 'assistant_unavailable' using errcode='P0001'; end if;
  update public.parent_assistant_messages set status='failed',error='This question expired or the request changed. Send it again with the latest information.',lease_token=null,lease_until=null,updated_at=now()
    where request_id=p_request_id and status in ('queued','running') and (expires_at<=now() or request_version<>v_request.version);
  if exists(select 1 from public.parent_assistant_messages where request_id=p_request_id and status in ('queued','running')) then raise exception 'assistant_pending' using errcode='P0001'; end if;
  if (select count(*) from public.parent_assistant_messages where request_id=p_request_id)>=200 then raise exception 'assistant_history_limit' using errcode='P0001'; end if;
  if (select count(*) from public.parent_assistant_messages where request_id=p_request_id and created_at>now()-interval '24 hours')>=20 then raise exception 'assistant_daily_limit' using errcode='P0001'; end if;
  insert into public.parent_assistant_messages(request_id,request_version,question,idempotency_key) values(p_request_id,v_request.version,btrim(p_question),p_idempotency_key) returning id into v_id;
  return v_id;
end $$;

create function public.parent_cancel_assistant(p_request_id uuid,p_message_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  update public.parent_assistant_messages set status='failed',error='You cancelled this question. Your support request is unchanged.',lease_token=null,lease_until=null,updated_at=now() where id=p_message_id and request_id=p_request_id and status in ('queued','running');
end $$;

create function parent_private.assistant_owner_available(p_request_id uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id
    where r.id=p_request_id and r.version=p_version and a.status='active' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<now()) and parent_private.existing_account_available(a.id)
      and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')));
$$;
create function parent_private.require_assistant_lease(p_message_id uuid,p_lease_token uuid) returns public.parent_assistant_messages
language plpgsql set search_path='' as $$
declare v_message public.parent_assistant_messages;
begin
  select * into v_message from public.parent_assistant_messages where id=p_message_id;
  perform 1 from public.parent_requests where id=v_message.request_id for update;
  select * into v_message from public.parent_assistant_messages where id=p_message_id for update;
  if not found or v_message.status<>'running' or v_message.lease_token is distinct from p_lease_token or v_message.lease_until<=now() or v_message.expires_at<=now()
    or not parent_private.assistant_owner_available(v_message.request_id,v_message.request_version) then raise exception 'assistant authority changed or lease expired' using errcode='42501'; end if;
  return v_message;
end $$;
create function parent_private.parent_claim_assistant() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_request uuid; v_message public.parent_assistant_messages; v_token uuid:=gen_random_uuid();
begin
  update public.parent_assistant_messages m set status='failed',error='This question expired or the request changed. Send it again with the latest information.',lease_token=null,lease_until=null,updated_at=now()
    where m.status in ('queued','running') and (m.expires_at<=now() or not parent_private.assistant_owner_available(m.request_id,m.request_version) or (m.status='running' and m.lease_until<=now()));
  if not exists(select 1 from parent_private.worker_health h where h.singleton and h.assistant_ready and h.expires_at>now()) then return null; end if;
  select r.id into v_request from public.parent_requests r join public.parent_assistant_messages m on m.request_id=r.id where m.status='queued' and m.expires_at>now() and parent_private.assistant_owner_available(r.id,m.request_version) order by m.created_at for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_message from public.parent_assistant_messages where request_id=v_request and status='queued' for update;
  if not found or not parent_private.assistant_owner_available(v_request,v_message.request_version) then return null; end if;
  update public.parent_assistant_messages set status='running',lease_token=v_token,lease_until=least(expires_at,now()+interval '2 minutes'),updated_at=now() where id=v_message.id;
  return jsonb_build_object('messageId',v_message.id,'leaseToken',v_token,'question',v_message.question,'request',
    (select jsonb_build_object('id',r.id,'household_id',r.household_id,'version',r.version,'status',r.status,'intake',r.intake,'mandate',r.mandate,'plan',r.plan,'required_actions',r.required_actions,'facts',r.facts,'account_changed_at',r.account_changed_at,'created_at',r.created_at,'updated_at',r.updated_at,'next_actor',r.next_actor,'next_trigger',r.next_trigger,'next_run_at',r.next_run_at) from public.parent_requests r where r.id=v_request),
    'operations',(select coalesce(jsonb_agg(v),'[]') from (select id,program_id,need,state,evidence,updated_at from public.parent_operations o where request_id=v_request and parent_private.current_account_evidence(o.request_id,o.need,o.created_at) order by created_at desc limit 50) v),
    'reports',(select coalesce(jsonb_agg(v),'[]') from (select evidence->>'need' need,evidence->>'outcome' outcome,created_at from public.parent_events where request_id=v_request and parent_private.current_account_evidence(request_id,evidence->>'need',created_at) and kind='parent.outcome_reported' and actor='parent' and evidence->>'attribution'='parent_reported' order by created_at desc limit 10) v),
    'documents',(select coalesce(jsonb_agg(v),'[]') from (select status,count(*) total from public.parent_documents where request_id=v_request and status not in ('deleted','deletion_pending') group by status) v),
    'history',(select coalesce(jsonb_agg(v),'[]') from (select question,answer from public.parent_assistant_messages where request_id=v_request and status='answered' order by created_at desc limit 4) v),
    'progress',parent_private.request_progress(v_request),
    'runtime',(select jsonb_build_object('planningReady',planning_ready and expires_at>now(),'assistantReady',assistant_ready and expires_at>now()) from parent_private.worker_health where singleton));
end $$;
create function parent_private.parent_reserve_assistant_call(p_message_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_message public.parent_assistant_messages; v_owner uuid;
begin
  v_message:=parent_private.require_assistant_lease(p_message_id,p_lease_token);
  select h.owner_id into v_owner from public.parent_requests r join public.parent_households h on h.id=r.household_id where r.id=v_message.request_id;
  perform 1 from public.parent_accounts where id=v_owner for update;
  if exists(select 1 from parent_private.assistant_calls where message_id=p_message_id) then return false; end if;
  if (select count(*) from parent_private.assistant_calls where request_id=v_message.request_id and created_at>now()-interval '24 hours')>=20
    or (select count(*) from parent_private.assistant_calls where account_id=v_owner and created_at>now()-interval '24 hours')+(select count(*) from parent_private.ai_calls where account_id=v_owner and created_at>now()-interval '24 hours')>=60 then return false; end if;
  if not parent_private.reserve_model_capacity() then return false; end if;
  insert into parent_private.assistant_calls(account_id,request_id,message_id) values(v_owner,v_message.request_id,p_message_id);
  return true;
end $$;
-- Share the account ceiling without charging chat against the execution request's 12-call allowance.
create or replace function parent_private.parent_reserve_ai_call(p_job_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_owner uuid;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select h.owner_id into v_owner from public.parent_requests r join public.parent_households h on h.id=r.household_id where r.id=v_job.request_id;
  perform 1 from public.parent_accounts where id=v_owner for update;
  if (select count(*) from parent_private.ai_calls where request_id=v_job.request_id)>=12
    or (select count(*) from parent_private.ai_calls where account_id=v_owner and created_at>now()-interval '24 hours')+(select count(*) from parent_private.assistant_calls where account_id=v_owner and created_at>now()-interval '24 hours')>=60 then return false; end if;
  if not parent_private.reserve_model_capacity() then return false; end if;
  insert into parent_private.ai_calls(account_id,request_id) values(v_owner,v_job.request_id);
  return true;
end $$;
create function parent_private.parent_finish_assistant(p_message_id uuid,p_lease_token uuid,p_answer jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_message public.parent_assistant_messages;
begin
  v_message:=parent_private.require_assistant_lease(p_message_id,p_lease_token);
  if p_answer is null or jsonb_typeof(p_answer)<>'object' or pg_column_size(p_answer)>16000 or jsonb_typeof(p_answer->'intro') is distinct from 'string' or jsonb_typeof(p_answer->'paragraphs') is distinct from 'array' or jsonb_array_length(p_answer->'paragraphs')>12 or jsonb_typeof(p_answer->'actionIds') is distinct from 'array' or jsonb_array_length(p_answer->'actionIds')>3 then raise exception 'invalid assistant response' using errcode='23514'; end if;
  update public.parent_assistant_messages set status='answered',answer=p_answer,error=null,lease_token=null,lease_until=null,updated_at=now() where id=p_message_id;
end $$;
create function parent_private.parent_fail_assistant(p_message_id uuid,p_lease_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.parent_assistant_messages set status='failed',error='The assistant could not confirm an answer. Your support request has not changed. Try again.',lease_token=null,lease_until=null,updated_at=now() where id=p_message_id and status='running' and lease_token=p_lease_token;
end $$;
revoke execute on function parent_private.reserve_model_capacity(),parent_private.assistant_question_safe(text),parent_private.assistant_owner_available(uuid,integer),parent_private.require_assistant_lease(uuid,uuid),parent_private.parent_claim_assistant(),parent_private.parent_reserve_assistant_call(uuid,uuid),parent_private.parent_finish_assistant(uuid,uuid,jsonb),parent_private.parent_fail_assistant(uuid,uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
revoke execute on function public.parent_assistant_available(uuid),public.parent_ask_assistant(uuid,text,uuid,boolean),public.parent_cancel_assistant(uuid,uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_assistant_available(uuid),public.parent_ask_assistant(uuid,text,uuid,boolean),public.parent_cancel_assistant(uuid,uuid) to authenticated;
grant execute on function parent_private.parent_claim_assistant(),parent_private.parent_reserve_assistant_call(uuid,uuid),parent_private.parent_finish_assistant(uuid,uuid,jsonb),parent_private.parent_fail_assistant(uuid,uuid) to parent_worker;
