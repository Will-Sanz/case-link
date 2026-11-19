alter table public.parent_requests add column closed_reason text check(closed_reason in ('completed','parent_choice','all_permitted_routes_exhausted','provider_declined','out_of_area'));
-- Persist useful resumptions and safe notifications without copying household content into workflow logs.
alter table public.parent_documents add column upload_confirmed_at timestamptz;
alter table public.parent_documents add column source_observed_at timestamptz;
alter table public.parent_documents add column facts_valid_until timestamptz;
alter table parent_private.form_templates add column required_fields text[] not null default '{}';
alter table parent_private.form_templates add column personal_fields text[] not null default '{}';
alter table public.parent_events add column source_key text;
create unique index parent_service_event_key on public.parent_events(request_id,source_key) where source_key is not null;

create function parent_private.parent_get_form_artifact(p_job_id uuid,p_lease_token uuid,p_program_id text,p_need text,p_template_id text,p_template_version text,p_form_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  return (select to_jsonb(f) from public.parent_form_artifacts f join parent_private.form_templates t on t.id=f.template_id and t.version=f.template_version
    where f.request_id=v_job.request_id and f.request_version=v_job.request_version and f.need=p_need and f.program_id=p_program_id and f.template_id=p_template_id and f.template_version=p_template_version and f.form_input_digest=encode(sha256(convert_to(p_form_input::text,'UTF8')),'hex') and f.status='stored' and f.expires_at>now() and t.active and t.verified_until>now() and t.content_sha256=f.template_hash order by f.created_at desc limit 1);
end $$;
create function parent_private.parent_reconcile_operation(p_job_id uuid,p_lease_token uuid,p_operation_id uuid,p_state text,p_evidence jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  if not found or v_operation.request_id is distinct from v_job.request_id or v_operation.state<>'delivery_unknown'
    or not exists(select 1 from public.parent_requests r where r.id=v_job.request_id and r.mandate->'recipientIds' ? v_operation.program_id and r.mandate->'allowedActions' ? 'follow_up') then raise exception 'reconciliation scope unavailable' using errcode='42501'; end if;
  if p_state is null or p_state not in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved')
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object' or pg_column_size(p_evidence)>2000
    or coalesce(p_evidence->>'source','') not in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed') or length(coalesce(p_evidence->>'reference','')) not between 1 and 200 then raise exception 'verified reconciliation evidence required' using errcode='23514'; end if;
  update public.parent_operations set state=p_state,evidence=p_evidence,updated_at=now() where id=p_operation_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'operation.reconciled','caselink','CaseLink reconciled a previously uncertain delivery.',jsonb_build_object('operationId',p_operation_id,'need',v_operation.need,'state',p_state,'reference',p_evidence->>'reference','source',p_evidence->>'source'));
end $$;

create table parent_private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  completion_notice boolean not null default false,
  event_id uuid not null unique references public.parent_events(id) on delete cascade,
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  request_version integer not null,
  kind text not null check(kind in ('progress','action_required','outcome')),
  state text not null default 'queued' check(state in ('queued','leased','sending','sent','delivery_unknown','cancelled','failed')),
  not_before timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table parent_private.notification_outbox enable row level security;
revoke all on parent_private.notification_outbox from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
create index parent_notification_due on parent_private.notification_outbox(state,not_before);
create function parent_private.notification_due_at(p_now timestamptz,p_preferences jsonb) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare v_local timestamp:=p_now at time zone 'America/New_York'; v_start integer:=(p_preferences->>'quietHoursStart')::integer; v_end integer:=(p_preferences->>'quietHoursEnd')::integer; v_hour integer:=extract(hour from v_local); v_end_local timestamp;
begin
  if v_start is null or v_end is null or v_start not between 0 and 23 or v_end not between 0 and 23 then return p_now+interval '1 day'; end if;
  if v_start=v_end or (v_start<v_end and (v_hour<v_start or v_hour>=v_end)) or (v_start>v_end and v_hour>=v_end and v_hour<v_start) then return p_now; end if;
  v_end_local:=date_trunc('day',v_local)+make_interval(hours=>v_end);
  if v_end_local<=v_local then v_end_local:=v_end_local+interval '1 day'; end if;
  return v_end_local at time zone 'America/New_York';
end $$;
create function parent_private.notification_allowed(p_request uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select (parent_private.current_grant(p_request,p_version) or exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id where r.id=p_request and r.version=p_version and r.status='closed' and r.closed_reason in ('completed','all_permitted_routes_exhausted') and (r.mandate->>'expiresAt')::timestamptz>now() and a.status='active' and (u.banned_until is null or u.banned_until<now()) and parent_private.processing_enabled() and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')) and exists(select 1 from parent_private.notification_outbox n where n.request_id=r.id and n.request_version=r.version and n.completion_notice and n.created_at>now()-interval '24 hours'))) and exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id where r.id=p_request and r.intake->>'contactPreference'='email' and a.preferences->>'contactPreference'='email' and u.email_confirmed_at is not null and length(coalesce(u.email,''))>0);
$$;
create function parent_private.parent_record_service_event(p_job_id uuid,p_lease_token uuid,p_event jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_request public.parent_requests; v_state text; v_id uuid; v_evidence jsonb; v_preferences jsonb;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select * into v_request from public.parent_requests where id=v_job.request_id;
  v_state:=replace(p_event->>'kind','support.','');
  if p_event is null or jsonb_typeof(p_event)<>'object' or pg_column_size(p_event)>5000 or coalesce(p_event->>'id','')!~'^[a-f0-9]{64}$'
    or p_event->>'kind' is null or p_event->>'need' is null or p_event->>'programId' is null or not(v_request.intake->'needs' ? (p_event->>'need')) or not(v_request.mandate->'recipientIds' ? (p_event->>'programId'))
    or not parent_private.program_supports_need(p_event->>'programId',p_event->>'need')
    or p_event->>'kind' is distinct from 'support.'||v_state
    or v_state not in ('checking','prepared','sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved') then raise exception 'invalid scoped service event' using errcode='23514'; end if;
  select id into v_id from public.parent_events where request_id=v_job.request_id and source_key=p_event->>'id';
  if found then return v_id; end if;
  if v_state not in ('checking','prepared','unresolved') and not exists(select 1 from public.parent_operations o where o.request_id=v_job.request_id and o.need=p_event->>'need' and o.program_id=p_event->>'programId' and o.state=v_state and o.evidence->>'reference'=p_event->'receipt'->>'reference') then raise exception 'service progress needs matching real evidence' using errcode='23514'; end if;
  v_evidence:=jsonb_build_object('need',p_event->>'need','programId',p_event->>'programId','state',v_state);
  insert into public.parent_events(request_id,source_key,kind,actor,summary,evidence) values(v_job.request_id,p_event->>'id',p_event->>'kind','caselink','Your support request has a new update.',v_evidence) returning id into v_id;
  if parent_private.notification_allowed(v_job.request_id,v_job.request_version) then
    select a.preferences into v_preferences from public.parent_accounts a join public.parent_households h on h.owner_id=a.id where h.id=v_request.household_id;
    insert into parent_private.notification_outbox(event_id,request_id,request_version,kind,not_before) values(v_id,v_job.request_id,v_job.request_version,case when v_state in ('support_received','declined') then 'outcome' else 'progress' end,parent_private.notification_due_at(now(),v_preferences));
  end if;
  return v_id;
end $$;
create function parent_private.parent_claim_notification(p_lease_seconds integer default 60) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_request uuid; v_notice parent_private.notification_outbox; v_token uuid:=gen_random_uuid();
begin
  if p_lease_seconds is null or p_lease_seconds not between 15 and 120 then raise exception 'invalid notification lease' using errcode='23514'; end if;
  select r.id,n.id into v_request,v_id from public.parent_requests r join parent_private.notification_outbox n on n.request_id=r.id
    where ((n.state='queued' and n.not_before<=now()) or (n.state in ('leased','sending') and n.lease_until<now())) and n.attempts<3
      and parent_private.notification_allowed(n.request_id,n.request_version) order by n.not_before for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_notice from parent_private.notification_outbox where id=v_id for update;
  if v_notice.state='sending' then update parent_private.notification_outbox set state='delivery_unknown',updated_at=now() where id=v_id; return jsonb_build_object('notificationId',v_id,'state','delivery_unknown','providerReference',v_notice.provider_reference,'idempotencyKey',v_id); end if;
  update parent_private.notification_outbox set state='leased',lease_token=v_token,lease_until=now()+make_interval(secs=>p_lease_seconds),attempts=attempts+1,updated_at=now() where id=v_id;
  return jsonb_build_object('notificationId',v_id,'leaseToken',v_token,'state','leased','idempotencyKey',v_id);
end $$;
create function parent_private.parent_begin_notification(p_notification_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_notice parent_private.notification_outbox; v_preferences jsonb; v_email text; v_due timestamptz;
begin
  select * into v_notice from parent_private.notification_outbox where id=p_notification_id;
  perform 1 from public.parent_requests where id=v_notice.request_id for update;
  select * into v_notice from parent_private.notification_outbox where id=p_notification_id for update;
  if not found or v_notice.state<>'leased' or v_notice.lease_token is distinct from p_lease_token or v_notice.lease_until is null or v_notice.lease_until<=now() or not parent_private.notification_allowed(v_notice.request_id,v_notice.request_version) then raise exception 'notification permission unavailable' using errcode='42501'; end if;
  select a.preferences,u.email into v_preferences,v_email from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id where r.id=v_notice.request_id;
  v_due:=parent_private.notification_due_at(now(),v_preferences);
  if v_due>now() then update parent_private.notification_outbox set state='queued',not_before=v_due,lease_token=null,lease_until=null,updated_at=now() where id=p_notification_id; return null; end if;
  update parent_private.notification_outbox set state='sending',updated_at=now() where id=p_notification_id;
  return jsonb_build_object('notificationId',v_notice.id,'recipient',v_email,'language',v_preferences->>'language','kind',v_notice.kind,'requestPath','/support/'||v_notice.request_id::text,'idempotencyKey',v_notice.id);
end $$;
create function parent_private.parent_finish_notification(p_notification_id uuid,p_lease_token uuid,p_state text,p_provider_reference text) returns void
language plpgsql security definer set search_path='' as $$
declare v_notice parent_private.notification_outbox;
begin
  select * into v_notice from parent_private.notification_outbox where id=p_notification_id for update;
  if not found or v_notice.lease_token is distinct from p_lease_token or v_notice.lease_until is null or v_notice.lease_until+interval '10 minutes'<=now() then raise exception 'notification receipt scope unavailable' using errcode='42501'; end if;
  if v_notice.state='sent' and p_state='sent' and v_notice.provider_reference=p_provider_reference then return; end if;
  if v_notice.state not in ('sending','delivery_unknown') or p_state is null or p_state not in ('sent','failed','delivery_unknown') or (p_state='sent' and length(coalesce(p_provider_reference,'')) not between 1 and 200) then raise exception 'invalid notification transport result' using errcode='23514'; end if;
  update parent_private.notification_outbox set state=p_state,provider_reference=p_provider_reference,updated_at=now() where id=p_notification_id;
end $$;
create function parent_private.parent_reconcile_notification(p_notification_id uuid,p_state text,p_provider_reference text) returns void
language plpgsql security definer set search_path='' as $$
declare v_notice parent_private.notification_outbox;
begin
  select * into v_notice from parent_private.notification_outbox where id=p_notification_id;
  perform 1 from public.parent_requests where id=v_notice.request_id for update;
  select * into v_notice from parent_private.notification_outbox where id=p_notification_id for update;
  if not found or v_notice.state<>'delivery_unknown' or p_state is null or p_state not in ('sent','not_delivered') or length(coalesce(p_provider_reference,'')) not between 1 and 200 then raise exception 'verified notification reconciliation required' using errcode='23514'; end if;
  update parent_private.notification_outbox set state=case when p_state='sent' then 'sent' when parent_private.notification_allowed(request_id,request_version) and attempts<3 and created_at>now()-interval '24 hours' then 'queued' else 'cancelled' end,provider_reference=p_provider_reference,not_before=now()+interval '1 minute',lease_token=null,lease_until=null,updated_at=now() where id=p_notification_id;
end $$;
create function parent_private.invalidate_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare v_final uuid;
begin
  if new.status='closed' and old.status in ('active','paused') and new.closed_reason in ('completed','all_permitted_routes_exhausted') then
    select id into v_final from parent_private.notification_outbox where request_id=new.id and request_version=old.version and kind='outcome' and state='queued' and created_at>now()-interval '15 minutes' order by created_at desc,id desc limit 1;
    if found then update parent_private.notification_outbox set completion_notice=true,request_version=new.version,updated_at=now() where id=v_final; end if;
  end if;
  if new.status<>'active' or new.version<>old.version then update parent_private.notification_outbox set state=case when state='sending' then 'delivery_unknown' else 'cancelled' end,updated_at=now() where request_id=new.id and state in ('queued','leased','sending') and id is distinct from v_final; end if;
  return new;
end $$;
create trigger parent_notification_authority after update of status,version on public.parent_requests for each row execute function parent_private.invalidate_notifications();

revoke execute on function parent_private.parent_get_form_artifact(uuid,uuid,text,text,text,text,jsonb),parent_private.parent_reconcile_operation(uuid,uuid,uuid,text,jsonb),parent_private.notification_due_at(timestamptz,jsonb),parent_private.notification_allowed(uuid,integer),parent_private.parent_record_service_event(uuid,uuid,jsonb),parent_private.parent_claim_notification(integer),parent_private.parent_begin_notification(uuid,uuid),parent_private.parent_finish_notification(uuid,uuid,text,text),parent_private.parent_reconcile_notification(uuid,text,text),parent_private.invalidate_notifications() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.parent_get_form_artifact(uuid,uuid,text,text,text,text,jsonb),parent_private.parent_reconcile_operation(uuid,uuid,uuid,text,jsonb),parent_private.parent_record_service_event(uuid,uuid,jsonb),parent_private.parent_claim_notification(integer),parent_private.parent_begin_notification(uuid,uuid),parent_private.parent_finish_notification(uuid,uuid,text,text),parent_private.parent_reconcile_notification(uuid,text,text) to parent_worker;

-- Runtime contracts preserve metadata and exact resumption ownership.
drop function parent_private.parent_save_document_facts(uuid,uuid,uuid,jsonb,text[],integer);
create function parent_private.parent_save_document_facts(p_job_id uuid,p_lease_token uuid,p_document_id uuid,p_facts jsonb,p_source_pages text[],p_page_count integer default null,p_source_observed_at timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_doc public.parent_documents; v_field jsonb; v_name text; v_value jsonb; v_records jsonb:='[]'; v_source text; v_label text;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select * into v_doc from public.parent_documents where id=p_document_id for update;
  if v_doc.request_id is distinct from v_job.request_id or v_doc.upload_confirmed_at is null or v_doc.status not in ('uploaded','processing') or v_doc.expires_at<=now() or v_doc.consent_version<>'2026-10-25' or not exists(select 1 from public.parent_requests r where r.id=v_job.request_id and r.mandate->'allowedData' ? 'documents' and r.mandate->'allowedActions' ?| array['research','prepare'])
    or p_facts is null or jsonb_typeof(p_facts)<>'object' or pg_column_size(p_facts)>8000 or (select count(*) from jsonb_object_keys(p_facts))<>6
    or not(p_facts ?& array['provider','amountDue','totalBalance','dueDate','shutoffDate','fields'])
    or jsonb_typeof(p_facts->'fields') is distinct from 'array' or jsonb_array_length(p_facts->'fields')>5
    or coalesce(p_page_count,v_doc.page_count) is null or coalesce(p_page_count,v_doc.page_count) not between 1 and 5
    or p_source_pages is null or array_position(p_source_pages,null) is not null or cardinality(p_source_pages) not between 1 and 5 or octet_length(array_to_string(p_source_pages,''))>100000 then raise exception 'document source or processing authority unavailable' using errcode='42501'; end if;
  if p_source_observed_at is not null and (p_source_observed_at>now()+interval '1 day' or p_source_observed_at<now()-interval '2 years' or not exists(select 1 from unnest(p_source_pages) page where page~*'(bill date|statement date|issued on)' and strpos(page,to_char(p_source_observed_at at time zone 'UTC','YYYY-MM-DD'))>0)) then raise exception 'source observation date needs original bill evidence' using errcode='23514'; end if;
  if coalesce(p_facts->>'provider','') not in ('peco','pgw','pwd','unknown') then raise exception 'invalid extracted provider' using errcode='23514'; end if;
  for v_name,v_value in select key,value from jsonb_each(p_facts) where key<>'fields' loop
    if v_value='null'::jsonb or (v_name='provider' and v_value='"unknown"'::jsonb) then continue; end if;
    select f into v_field from jsonb_array_elements(p_facts->'fields') f where f->>'field'=v_name;
    v_source:=v_field->>'sourceText';
    if v_field is null or (select count(*) from jsonb_object_keys(v_field))<>3 or jsonb_typeof(v_field->'page')<>'number' or (v_field->>'page')::numeric<>trunc((v_field->>'page')::numeric)
      or (v_field->>'page')::integer not between 1 and cardinality(p_source_pages) or length(coalesce(v_source,'')) not between 1 and 120
      or strpos(p_source_pages[(v_field->>'page')::integer],v_source)=0 or v_source~'\m[0-9]{3}[- ][0-9]{2}[- ][0-9]{4}\M' then raise exception 'extracted fact lacks a safe original source' using errcode='23514'; end if;
    v_label:=case v_name when 'provider' then '(PECO|PGW|Philadelphia Water|PWD)' when 'amountDue' then '(amount due|payment due|current charges)' when 'totalBalance' then '(total balance|account balance|balance due)' when 'dueDate' then '(due date|payment due|pay by)' when 'shutoffDate' then '(shut.?off|termination|disconnect)' end;
    if v_label is null or v_source!~*v_label then raise exception 'fact reference has another meaning' using errcode='23514'; end if;
    if v_name='provider' and ((p_facts->>'provider'='peco' and v_source!~*'\mPECO\M') or (p_facts->>'provider'='pgw' and v_source!~*'\mPGW\M') or (p_facts->>'provider'='pwd' and v_source!~*'(PWD|Philadelphia Water)')) then raise exception 'provider does not match source' using errcode='23514'; end if;
    if v_name in ('amountDue','totalBalance') then
      if jsonb_typeof(v_value)<>'number' or (v_value#>>'{}')::numeric not between 0 and 1000000
        or (select count(*) from regexp_matches(v_source,'[0-9][0-9,]*(\.[0-9]{1,2})?','g'))<>1
        or replace(substring(v_source from '[0-9][0-9,]*(?:\.[0-9]{1,2})?'),',','')::numeric<>(v_value#>>'{}')::numeric then raise exception 'amount does not uniquely match source' using errcode='23514'; end if;
    end if;
    if v_name in ('dueDate','shutoffDate') and (jsonb_typeof(v_value)<>'string' or (v_value#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' or to_char((v_value#>>'{}')::date,'YYYY-MM-DD')<>v_value#>>'{}' or strpos(v_source,v_value#>>'{}')=0) then raise exception 'date does not match source' using errcode='23514'; end if;
    v_records:=v_records||jsonb_build_array(jsonb_build_object('field',v_name,'value',v_value,'page',(v_field->>'page')::integer,'sourceText',v_source,'validatedAt',now(),'documentId',p_document_id));
  end loop;
  update public.parent_documents set page_count=coalesce(p_page_count,v_doc.page_count),facts=v_records,source_observed_at=p_source_observed_at,facts_valid_until=least(now()+interval '30 days',coalesce(p_source_observed_at+interval '45 days',now()+interval '24 hours')),status='validated',expires_at=least(expires_at,now()+interval '24 hours') where id=p_document_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'document.validated','caselink','CaseLink checked supported document values against their original source.',jsonb_build_object('documentId',p_document_id,'fieldCount',jsonb_array_length(v_records)));
end $$;
drop function parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamptz);
create function parent_private.parent_save_job_plan(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_plan jsonb,p_required_actions jsonb,p_next_run_at timestamptz default null,p_next_actor text default null,p_next_trigger text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_actor text; v_trigger text; v_plan jsonb;
begin
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,p_expected_version);
  if p_plan is null or p_required_actions is null or jsonb_typeof(p_plan)<>'object' or pg_column_size(p_plan)>100000 or p_plan->>'version' is distinct from '1' or jsonb_typeof(p_plan->'routes') is distinct from 'array'
    or jsonb_array_length(p_plan->'routes')>30 or jsonb_typeof(p_required_actions)<>'array' or jsonb_array_length(p_required_actions)>30 or pg_column_size(p_required_actions)>50000
    or (p_next_run_at is not null and p_next_run_at<now()+interval '30 seconds') then raise exception 'invalid work result' using errcode='23514'; end if;
  if p_next_actor is not null and p_next_actor not in ('caselink','parent','operator','service_operator','partner','agency') then raise exception 'invalid next owner' using errcode='23514'; end if;
  if p_next_trigger is not null and p_next_trigger not in ('scheduled_follow_up','parent_action_completed','provider_capability_enabled','verified_receipt_available','authorization_renewed','route_review_required','none') then raise exception 'invalid next trigger' using errcode='23514'; end if;
  v_actor:=case when p_next_actor='operator' then 'service_operator' else p_next_actor end;
  v_trigger:=p_next_trigger;
  if v_actor is null then v_actor:=case when p_next_run_at is not null then 'caselink' when exists(select 1 from jsonb_array_elements(p_required_actions) a where not coalesce((a->>'resolved')::boolean,false) and coalesce(a->>'resolver','parent')='parent') then 'parent' else 'service_operator' end; end if;
  if v_trigger is null then v_trigger:=case when p_next_run_at is not null then 'scheduled_follow_up' when v_actor='parent' then 'parent_action_completed' else 'provider_capability_enabled' end; end if;
  -- A late or replayed model snapshot cannot overwrite independently recorded delivery evidence.
  select jsonb_set(p_plan,'{routes}',coalesce(jsonb_agg(case when o.state is null then route else jsonb_set(route,'{state}',to_jsonb(o.state)) end),'[]')) into v_plan
    from jsonb_array_elements(p_plan->'routes') route left join lateral (select state from public.parent_operations o where o.request_id=v_job.request_id and o.need=route->>'need' and o.program_id=route->>'programId' and o.state in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved') order by case when state='support_received' then 0 else 1 end,updated_at desc limit 1) o on true;
  update public.parent_requests set plan=v_plan,required_actions=p_required_actions,next_actor=v_actor,next_trigger=v_trigger,
    next_run_at=p_next_run_at,updated_at=now() where id=v_job.request_id;
  if not exists(select 1 from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n(need) where r.id=v_job.request_id and not (
    exists(select 1 from public.parent_operations o where o.request_id=r.id and o.need=n.need and o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) or exists(select 1 from public.parent_events e where e.request_id=r.id and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'need'=n.need and e.evidence->>'outcome'='support_received' and e.evidence->>'attribution'='parent_reported'))) then
    perform parent_private.close_request(v_job.request_id,'completed','Every requested need has an attributed report of support received.','parent','Start a new request whenever support is needed again.','caselink');
    return;
  end if;
  if not exists(select 1 from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n(need) where r.id=v_job.request_id and not (
    exists(select 1 from public.parent_operations o where o.request_id=r.id and o.need=n.need and o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) or exists(select 1 from public.parent_events e where e.request_id=r.id and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'need'=n.need and e.evidence->>'outcome'='support_received' and e.evidence->>'attribution'='parent_reported') or (
      exists(select 1 from public.parent_operations o where o.request_id=r.id and o.need=n.need and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) and not exists(select 1 from jsonb_array_elements_text(r.mandate->'recipientIds') p(program) where parent_private.program_supports_need(p.program,n.need) and not exists(select 1 from public.parent_operations o where o.request_id=r.id and o.need=n.need and o.program_id=p.program and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')))) )) then
    perform parent_private.close_request(v_job.request_id,'all_permitted_routes_exhausted','Recorded outcomes show the permitted routes are exhausted for each remaining need.','parent','Start a new request if circumstances change or more program options become available.','caselink');
    return;
  end if;
  update public.parent_jobs set state='waiting',run_at=coalesce(p_next_run_at,'infinity'::timestamptz),lease_token=null,lease_until=null,updated_at=now() where id=p_job_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'plan.prepared','caselink','CaseLink checked your options and prepared the next steps.',jsonb_build_object('requestVersion',p_expected_version,'nextRunAt',p_next_run_at,'waitingFor',case when p_next_run_at is null then 'required_step_or_provider_connection' else 'scheduled_work' end));
end $$;
create or replace function parent_private.parent_claim_job(p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_token uuid:=gen_random_uuid(); v_request jsonb; v_request_id uuid;
begin
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'invalid lease duration' using errcode='23514'; end if;
  select r.id into v_request_id from public.parent_requests r join public.parent_jobs j on j.request_id=r.id
    where ((j.state in ('queued','waiting') and j.run_at<=now()) or (j.state='leased' and j.lease_until<now()))
      and j.attempts<48 and parent_private.current_grant(r.id,j.request_version)
    order by j.run_at for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_job from public.parent_jobs where request_id=v_request_id for update;
  if not parent_private.current_grant(v_request_id,v_job.request_version) then return null; end if;
  -- Lock order is request, job, operation for claims, cancellation and dispatch alike.
  update public.parent_operations set state='delivery_unknown',updated_at=now()
    where request_id=v_request_id and state='executing';
  update public.parent_jobs set state='leased',lease_token=v_token,lease_until=now()+make_interval(secs=>p_lease_seconds),lease_started_at=now(),attempts=attempts+1,updated_at=now() where id=v_job.id;
  select to_jsonb(r)-'mandate_revoked_at'-'start_key' into v_request from public.parent_requests r where r.id=v_request_id;
  return jsonb_build_object('jobId',v_job.id,'leaseToken',v_token,'request',v_request,
    'documents',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('object_path',case when d.status='raw_deleted' or d.expires_at<=now() then null else d.object_path end,'raw_available',d.status in ('uploaded','processing','validated') and d.expires_at>now())),'[]') from public.parent_documents d where d.request_id=v_request_id and d.upload_confirmed_at is not null and d.status not in ('deleted','deletion_pending') and (d.expires_at>now() or (d.status in ('validated','raw_deleted') and d.facts_valid_until>now()))),
    'unknownOperations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.parent_operations o where o.request_id=v_request_id and o.state='delivery_unknown'));
end $$;
revoke execute on function parent_private.parent_save_document_facts(uuid,uuid,uuid,jsonb,text[],integer,timestamptz),parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamptz,text,text) from public,anon,authenticated,service_role,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.parent_save_document_facts(uuid,uuid,uuid,jsonb,text[],integer,timestamptz),parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamptz,text,text) to parent_worker;
-- A real trusted update wakes work; unknown delivery never queues a new submission.
create function parent_private.wake_after_receipt() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.state is distinct from old.state and new.state in ('partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved') then
    update public.parent_jobs set state='queued',run_at=now(),updated_at=now() where request_id=new.request_id and state='waiting' and parent_private.current_grant(request_id,request_version);
  end if;
  return new;
end $$;
create trigger parent_receipt_resumption after update of state on public.parent_operations for each row execute function parent_private.wake_after_receipt();
revoke execute on function parent_private.wake_after_receipt() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

-- Follow-up cycles share an external reference but keep a separate stable cycle key.
do $$ declare v_name text; begin
  select conname into v_name from pg_constraint where conrelid='public.parent_operations'::regclass and contype='u' and pg_get_constraintdef(oid) like '%request_version, need, program_id, action, packet_hash, permission_version)%';
  if v_name is not null then execute format('alter table public.parent_operations drop constraint %I',v_name); end if;
end $$;
create unique index parent_operation_exact_action on public.parent_operations(request_id,request_version,need,program_id,action,packet_hash,permission_version) where action<>'follow_up';
create function parent_private.parent_get_unknown_notifications(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'invalid reconciliation limit' using errcode='23514'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('notificationId',n.id,'idempotencyKey',n.id,'providerReference',n.provider_reference,'createdAt',n.created_at)),'[]') from (select * from parent_private.notification_outbox where state='delivery_unknown' order by updated_at limit p_limit) n);
end $$;
revoke execute on function parent_private.parent_get_unknown_notifications(integer) from public,anon,authenticated,service_role,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.parent_get_unknown_notifications(integer) to parent_worker;

create or replace function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.current_grant(p_request,p_version) and exists(select 1 from public.parent_requests r
    where r.id=p_request and r.mandate->'recipientIds' ? p_program and r.mandate->'allowedActions' ? p_action
    and p_data<@array(select jsonb_array_elements_text(r.mandate->'allowedData'))
    and (cardinality(p_documents)=0 or ('documents'=any(p_data) and not exists(select 1 from unnest(p_documents) d_id where not exists(select 1 from public.parent_documents d where d.id=d_id and d.request_id=r.id and d.status='validated' and d.expires_at>now()))))
    and (p_action in ('research','prepare') or (r.mandate->>'mode'='full' and exists(select 1 from parent_private.provider_capabilities c where c.program_id=p_program and c.action=p_action and c.enabled and c.transport_verified and c.requires_form is not null and c.verified_until>now() and c.required_acts is not null
      and not exists(select 1 from jsonb_each(p_packet) f where not f.key=any(c.allowed_fields) or c.field_categories->>f.key is null or not(c.field_categories->>f.key=any(p_data))))))
    and (p_action in ('research','prepare') or not('utility'=any(p_data)) or (p_need is not null and coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority') in ('self','authorized_caregiver') and (not(p_packet ? 'accountAuthority') or p_packet->>'accountAuthority'=coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority'))))
    and (p_action<>'schedule' or r.mandate->>'bookingPreference'<>'ask_me'));
$$;

create or replace function public.parent_correct_request(p_request_id uuid,p_intake jsonb,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  perform parent_private.validate_intake(p_intake);
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if v_request.version is distinct from p_expected_version or v_request.status in ('cancelled','closed') then raise exception 'request changed; reload before correcting' using errcode='40001'; end if;
  perform parent_private.invalidate_work(p_request_id,'You corrected your information. CaseLink will use the updated facts and reconcile work already sent.');
  update public.parent_requests set intake=p_intake,facts='[]',version=version+1,plan=null,required_actions='[]',updated_at=now() where id=p_request_id;
  update public.parent_jobs set state=case when v_request.status='active' then 'queued' else 'cancelled' end,request_version=v_request.version+1,run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now() where request_id=p_request_id;
end $$;

create or replace function public.parent_resolve_action(p_request_id uuid,p_action_id text,p_value text) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_action jsonb;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  select v into v_action from jsonb_array_elements(v_request.required_actions) v where v->>'id'=p_action_id and not coalesce((v->>'resolved')::boolean,false);
  if v_action is null or v_request.status<>'active' or length(btrim(coalesce(p_value,''))) not between 1 and 2000 then raise exception 'action unavailable' using errcode='23514'; end if;
  if v_action->>'field'='accountAuthority' then
    if p_value not in ('self','authorized_caregiver') then raise exception 'account authority answer required' using errcode='23514'; end if;
    perform public.parent_answer_fact(p_request_id,v_action->>'need','accountAuthority',to_jsonb(p_value),v_request.version);
    return;
  end if;
  -- Reports resume reconciliation; they never establish agency submission or an award.
  update public.parent_requests set required_actions=(select jsonb_agg(case when v->>'id'=p_action_id then v||'{"resolved":true}'::jsonb else v end) from jsonb_array_elements(required_actions) v),version=version+1,updated_at=now() where id=p_request_id;
  perform parent_private.invalidate_work(p_request_id,'You provided an update. CaseLink will check the next step.');
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'parent.reported','parent','You reported an update for a required step.',jsonb_build_object('actionId',p_action_id,'reportedValue',p_value,'attribution','parent_reported'));
  update public.parent_jobs set state='queued',request_version=v_request.version+1,run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now() where request_id=p_request_id;
end $$;

create or replace function parent_private.close_request(p_request_id uuid,p_reason text,p_detail text,p_next_owner text,p_reentry text,p_actor text) returns void
language plpgsql set search_path='' as $$
declare v_request public.parent_requests; v_need text; v_program text; v_received boolean; v_all_received boolean:=true;
begin
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if not found or v_request.status not in ('active','paused') or p_reason is null or p_reason not in ('completed','parent_choice','all_permitted_routes_exhausted','provider_declined','out_of_area')
    or length(btrim(coalesce(p_detail,''))) not between 1 and 500 or p_next_owner is null or p_next_owner not in ('parent','partner','service_operator')
    or length(btrim(coalesce(p_reentry,''))) not between 1 and 500 then raise exception 'closure needs a reason, owner and re-entry path' using errcode='23514'; end if;
  if p_reason<>'parent_choice' then
    for v_need in select jsonb_array_elements_text(v_request.intake->'needs') loop
      select exists(select 1 from public.parent_operations o where o.request_id=p_request_id and o.need=v_need and o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed'))
        or exists(select 1 from public.parent_events e where e.request_id=p_request_id and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'attribution'='parent_reported' and e.evidence->>'need'=v_need and e.evidence->>'outcome'='support_received') into v_received;
      if v_received then continue; end if;
      v_all_received:=false;
      if p_reason='completed' then raise exception 'every need requires attributed support received evidence' using errcode='23514'; end if;
      -- Missing connectors, unattempted needs and silence never count as exhausted routes.
      for v_program in select jsonb_array_elements_text(v_request.mandate->'recipientIds') loop
        if parent_private.program_supports_need(v_program,v_need) and not exists(select 1 from public.parent_operations o where o.request_id=p_request_id and o.need=v_need and o.program_id=v_program and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed') and (p_reason<>'out_of_area' or o.evidence->>'reason'='out_of_area')) then raise exception 'permitted routes are not evidenced as exhausted for this need' using errcode='23514'; end if;
      end loop;
      if not exists(select 1 from public.parent_operations o where o.request_id=p_request_id and o.need=v_need and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) then raise exception 'every unresolved need requires an attributed outcome' using errcode='23514'; end if;
    end loop;
    if v_all_received and p_reason<>'completed' then raise exception 'successful needs require completed closure' using errcode='23514'; end if;
  end if;
  perform parent_private.invalidate_work(p_request_id,'This request was closed with a recorded reason and re-entry path.');
  update public.parent_requests set status='closed',closed_reason=p_reason,mandate_revoked_at=now(),version=version+1,next_actor=p_next_owner,next_trigger='parent_reentry',next_run_at=null,updated_at=now() where id=p_request_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'request.closed',p_actor,'This request is closed. You can return for support.',jsonb_build_object('reason',p_reason,'detail',p_detail,'nextOwner',p_next_owner,'reentry',p_reentry));
end $$;

create or replace function parent_private.parent_claim_cleanup(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_artifacts uuid[]; v_docs uuid[]; v_accounts uuid[]; v_requests uuid[]; v_batch parent_private.cleanup_batches; v_request uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid cleanup batch limit' using errcode='23514'; end if;
  -- Expiry erases reusable values; immutable attempted packets and receipts keep their own retention rules.
  for v_request in select r.id from public.parent_requests r where exists(select 1 from public.parent_documents d where d.request_id=r.id and d.facts_valid_until<=now() and d.facts<>'[]'::jsonb) order by r.id for update skip locked limit p_limit loop
    update public.parent_documents set facts='[]',source_observed_at=null,facts_valid_until=null where request_id=v_request and facts_valid_until<=now();
  end loop;
  -- Reapply deletion intent after a restore before any worker can obtain a current grant.
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id
    join parent_private.deletion_tombstones t on t.subject_hash=encode(sha256(convert_to('parent-account:'||h.owner_id::text,'UTF8')),'hex')
    where r.status<>'cancelled' order by r.id for update of r skip locked limit 100 loop
    perform parent_private.invalidate_work(v_request,'A prior account deletion was reapplied after restore.');
    update public.parent_requests set status='cancelled',mandate_revoked_at=now(),version=version+1,updated_at=now() where id=v_request;
  end loop;
  update public.parent_accounts a set status='deletion_requested',updated_at=now()
    where a.status<>'deletion_requested' and exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex'));
  select coalesce(array_agg(id),'{}') into v_docs from (
    select d.id from public.parent_documents d join public.parent_requests r on r.id=d.request_id join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id
    where ((d.status not in ('deleted','raw_deleted') and (d.status='deletion_pending' or d.expires_at<=now())) or (a.status='deletion_requested' and d.status not in ('deleted','raw_deleted')))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and d.id=any(b.document_ids))
    order by d.expires_at for update of d skip locked limit p_limit
  ) expired;
  select coalesce(array_agg(id),'{}') into v_artifacts from (
    select f.id from public.parent_form_artifacts f join public.parent_requests r on r.id=f.request_id join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id
    where f.status<>'deleted' and (a.status='deletion_requested' or (r.status in ('closed','cancelled') and r.updated_at<now()-interval '90 days') or (f.status='registered' and f.created_at<now()-interval '1 day'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and f.id=any(b.artifact_ids))
    order by f.created_at for update of f skip locked limit p_limit
  ) expired;
  select coalesce(array_agg(id),'{}') into v_accounts from (
    select a.id from public.parent_accounts a where a.status='deletion_requested'
      and not exists(select 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id join public.parent_documents d on d.request_id=r.id where h.owner_id=a.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and a.id=any(b.account_ids))
      and not exists(select 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id join public.parent_form_artifacts f on f.request_id=r.id where h.owner_id=a.id and f.status<>'deleted')
    order by a.updated_at limit p_limit
  ) eligible;
  select coalesce(array_agg(id),'{}') into v_requests from (
    select r.id from public.parent_requests r where r.status in ('closed','cancelled') and r.updated_at<now()-interval '90 days'
      and not exists(select 1 from public.parent_documents d where d.request_id=r.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and r.id=any(b.request_ids))
      and not exists(select 1 from public.parent_form_artifacts f where f.request_id=r.id and f.status<>'deleted')
    order by r.updated_at limit p_limit
  ) eligible;
  delete from parent_private.cleanup_batches where expires_at<now()-interval '1 day';
  delete from parent_private.retained_evidence where expires_at<now();
  delete from parent_private.deletion_tombstones where expires_at<now();
  if cardinality(v_docs)+cardinality(v_accounts)+cardinality(v_requests)+cardinality(v_artifacts)=0 then return null; end if;
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=any(v_accounts) order by r.id for update of r loop
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'mandate',encode(sha256(convert_to(mandate::text,'UTF8')),'hex'),created_at from public.parent_requests where id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'operation.'||state,packet_hash,coalesce(executed_at,created_at) from public.parent_operations where request_id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at) select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'form',content_sha256,created_at from public.parent_form_artifacts where request_id=v_request on conflict do nothing;
  end loop;
  insert into parent_private.cleanup_batches(document_ids,account_ids,request_ids,artifact_ids) values(v_docs,v_accounts,v_requests,v_artifacts) returning * into v_batch;
  return jsonb_build_object('batchId',v_batch.id,'leaseToken',v_batch.lease_token,
    'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'objectPath',d.object_path)),'[]') from public.parent_documents d where d.id=any(v_docs)),
    'artifacts',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'objectPath',f.object_path)),'[]') from public.parent_form_artifacts f where f.id=any(v_artifacts)),
    'accountIds',v_accounts,'requestIds',v_requests);
end $$;
create function parent_private.wake_after_capability() returns trigger language plpgsql security definer set search_path='' as $$
declare v_request uuid;
begin
  if not(new.enabled and new.transport_verified and new.requires_form is not null and new.required_acts is not null and new.verified_until>now()) then return new; end if;
  for v_request in select r.id from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where j.state='waiting' and r.next_trigger='provider_capability_enabled' and parent_private.current_grant(r.id,j.request_version) and r.mandate->'recipientIds' ? new.program_id and r.mandate->'allowedActions' ? new.action and exists(select 1 from jsonb_array_elements_text(r.intake->'needs') n where parent_private.program_supports_need(new.program_id,n)) order by r.id for update of r skip locked loop
    update public.parent_jobs set state='queued',run_at=now(),updated_at=now() where request_id=v_request and state='waiting';
    update public.parent_requests set next_actor='caselink',next_trigger='job_due',next_run_at=now(),updated_at=now() where id=v_request;
    insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_request,'capability.available','operator','A verified program connection is available. CaseLink will recheck the next permitted step.',jsonb_build_object('programId',new.program_id,'action',new.action,'permissionVersion',new.permission_version));
  end loop;
  return new;
end $$;
create trigger parent_capability_resumption after insert or update of enabled,transport_verified,verified_until,permission_version,requires_form,required_acts on parent_private.provider_capabilities for each row execute function parent_private.wake_after_capability();
revoke execute on function parent_private.wake_after_capability() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

-- Registration quarantines metadata only; confirmed immutable bytes resume the current request.
create function public.parent_confirm_document_upload(p_request_id uuid,p_document_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_document public.parent_documents;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'document unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  select * into v_document from public.parent_documents where id=p_document_id and request_id=p_request_id;
  if not found or v_request.status not in ('active','paused') or v_document.status not in ('uploaded','processing','validated') or v_document.expires_at<=now() or v_document.consent_version<>'2026-10-25' or not exists(select 1 from storage.objects o where o.bucket_id='parent-documents' and o.name=v_document.object_path and coalesce((o.metadata->>'size')::bigint,-1)=v_document.size_bytes and o.metadata->>'mimetype'=v_document.media_type) then raise exception 'private upload has not been confirmed' using errcode='42501'; end if;
  if v_document.upload_confirmed_at is not null then return; end if;
  perform parent_private.requeue_parent_change(p_request_id,'Your document upload is complete. CaseLink will check it and resume the permitted work.');
  update public.parent_documents set upload_confirmed_at=now() where id=p_document_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'document.upload_confirmed','parent','Your private document upload is complete.',jsonb_build_object('documentId',p_document_id));
end $$;
revoke execute on function public.parent_confirm_document_upload(uuid,uuid) from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_confirm_document_upload(uuid,uuid) to authenticated;

create or replace function parent_private.parent_authorize_storage(p_job_id uuid,p_lease_token uuid,p_bucket text,p_object_path text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_document public.parent_documents; v_form public.parent_form_artifacts; v_template parent_private.form_templates;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_mode is null or p_mode not in ('download','upload') or p_object_path is null or length(p_object_path) not between 1 and 300 then raise exception 'invalid storage purpose' using errcode='42501'; end if;
  if p_bucket='parent-documents' and p_mode='download' then
    select * into v_document from public.parent_documents where request_id=v_job.request_id and upload_confirmed_at is not null and object_path=p_object_path and status in ('uploaded','processing','validated') and expires_at>now() and consent_version='2026-10-25'
      and exists(select 1 from public.parent_requests r where r.id=v_job.request_id and r.mandate->'allowedData' ? 'documents' and r.mandate->'allowedActions' ?| array['research','prepare']);
    if not found then raise exception 'document purpose unavailable' using errcode='42501'; end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType',v_document.media_type,'maxBytes',v_document.size_bytes);
  elsif p_bucket='parent-form-artifacts' then
    select * into v_form from public.parent_form_artifacts where request_id=v_job.request_id and request_version=v_job.request_version and object_path=p_object_path and status in ('registered','stored') and expires_at>now();
    if not found or (p_mode='upload' and v_form.status<>'registered') then raise exception 'form purpose unavailable' using errcode='42501'; end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType','application/pdf','maxBytes',10485760,'expectedSha256',v_form.content_sha256);
  elsif p_bucket='parent-known-forms' and p_mode='download' then
    select t.* into v_template from parent_private.form_templates t join public.parent_requests r on r.id=v_job.request_id
      where t.object_path=p_object_path and t.active and t.verified_until>now() and r.mandate->'recipientIds' ? t.program_id;
    if not found then raise exception 'verified template purpose unavailable' using errcode='42501'; end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType','application/pdf','maxBytes',10485760,'expectedSha256',v_template.content_sha256);
  end if;
  raise exception 'unsupported storage purpose' using errcode='42501';
end $$;
