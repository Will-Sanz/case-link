-- Typed parent answers and deliberately renewed scope resume work without repeated routine approval.
alter table public.parent_requests add column facts jsonb not null default '[]' check(jsonb_typeof(facts)='array');
create table public.parent_mandates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  request_version integer not null,
  mandate jsonb not null,
  mandate_hash text not null,
  accepted_at timestamptz not null default now(),
  unique(request_id,request_version)
);
alter table public.parent_mandates enable row level security;
revoke all on public.parent_mandates from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
grant select on public.parent_mandates to authenticated;
create policy parent_mandate_read on public.parent_mandates for select to authenticated using(parent_private.owns_request(request_id));
insert into public.parent_mandates(request_id,request_version,mandate,mandate_hash)
  select id,version,mandate,encode(sha256(convert_to(mandate::text,'UTF8')),'hex') from public.parent_requests;
create function parent_private.record_mandate_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or new.mandate is distinct from old.mandate then
    insert into public.parent_mandates(request_id,request_version,mandate,mandate_hash) values(new.id,new.version,new.mandate,encode(sha256(convert_to(new.mandate::text,'UTF8')),'hex'));
  end if;
  return new;
end $$;
create trigger parent_mandate_snapshot after insert or update of mandate on public.parent_requests for each row execute function parent_private.record_mandate_version();
alter table public.parent_operations add column mandate_hash text;
alter table public.parent_operations add column authorization_snapshot jsonb;
create function parent_private.record_operation_authority() returns trigger language plpgsql security definer set search_path='' as $$
declare v_mandate jsonb;
begin
  select mandate into v_mandate from public.parent_requests where id=new.request_id;
  new.mandate_hash:=encode(sha256(convert_to(v_mandate::text,'UTF8')),'hex');
  new.authorization_snapshot:=jsonb_build_object('mandateHash',new.mandate_hash,'requestVersion',new.request_version,'need',new.need,'programId',new.program_id,'action',new.action,'dataCategories',new.data_categories,'documentIds',new.document_ids,'permissionVersion',new.permission_version,'artifactId',new.artifact_id,'evaluatedAt',now());
  return new;
end $$;
create trigger parent_operation_authority before insert on public.parent_operations for each row execute function parent_private.record_operation_authority();

create function parent_private.requeue_parent_change(p_request_id uuid,p_reason text) returns void
language plpgsql set search_path='' as $$
begin
  perform parent_private.invalidate_work(p_request_id,p_reason);
  update public.parent_requests set version=version+1,next_actor=case when status='active' then 'caselink' else 'parent' end,next_trigger=case when status='active' then 'job_due' else 'parent_resume' end,next_run_at=case when status='active' then now() else null end,updated_at=now() where id=p_request_id;
  update public.parent_jobs j set state=case when r.status='active' then 'queued' else 'cancelled' end,request_version=r.version,run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now() from public.parent_requests r where j.request_id=r.id and r.id=p_request_id;
end $$;
create function public.parent_answer_fact(p_request_id uuid,p_need text,p_field text,p_value jsonb,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_intake jsonb; v_category text; v_fact jsonb;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if v_request.version is distinct from p_expected_version or v_request.status not in ('active','paused') then raise exception 'request changed; reload before answering' using errcode='40001'; end if;
  if p_need is null or not(v_request.intake->'needs' ? p_need) or p_value is null or p_field is null or p_field not in ('zip','householdSize','income','incomeAmount','incomeFrequency','utilityProvider','accountAuthority','amountDue','totalBalance','dueDate','shutoffDate') then raise exception 'unsupported or missing factual answer' using errcode='23514'; end if;
  v_category:=case when p_field in ('zip','householdSize') then 'household' when p_field in ('income','incomeAmount','incomeFrequency') then 'income' else 'utility' end;
  if v_category='utility' and p_need not in ('electricity','gas','water') then raise exception 'utility facts must identify the utility need' using errcode='23514'; end if;
  v_intake:=v_request.intake;
  if p_field='income' then
    if jsonb_typeof(p_value)<>'object' or (select count(*) from jsonb_object_keys(p_value))<>2 or not(p_value ?& array['amount','frequency']) then raise exception 'income needs an amount and frequency together' using errcode='23514'; end if;
    perform parent_private.validate_packet(jsonb_build_object('incomeAmount',p_value->'amount','incomeFrequency',p_value->'frequency'),array['income'],array[]::uuid[],'prepare');
    v_intake:=jsonb_set(jsonb_set(v_intake,'{incomeAmount}',p_value->'amount'),'{incomeFrequency}',p_value->'frequency');
  else
    perform parent_private.validate_packet(jsonb_build_object(p_field,p_value),array[v_category],array[]::uuid[],'prepare');
    if p_field in ('zip','householdSize','incomeAmount','incomeFrequency') then v_intake:=jsonb_set(v_intake,array[p_field],p_value); end if;
  end if;
  perform parent_private.validate_intake(v_intake);
  v_fact:=jsonb_build_object('need',p_need,'field',p_field,'value',p_value,'source','parent','confirmedAt',now(),'asOf',current_date);
  update public.parent_requests set intake=v_intake,
    facts=(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements(facts) f where not(f->>'need'=p_need and f->>'field'=p_field))||jsonb_build_array(v_fact),
    required_actions=(select coalesce(jsonb_agg(case when a->>'need'=p_need and a->>'field'=p_field then a||'{"resolved":true}'::jsonb else a end),'[]') from jsonb_array_elements(required_actions) a)
    where id=p_request_id;
  perform parent_private.requeue_parent_change(p_request_id,'You answered a necessary question. CaseLink will use this current fact and resume the permitted work.');
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'fact.parent_answered','parent','You supplied a current fact for a support step.',jsonb_build_object('need',p_need,'field',p_field,'attribution','parent_reported'));
end $$;
create function public.parent_replace_mandate(p_request_id uuid,p_mandate jsonb,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if v_request.version is distinct from p_expected_version or v_request.status not in ('active','paused') then raise exception 'request changed; reload before updating permission' using errcode='40001'; end if;
  perform parent_private.validate_mandate(p_mandate);
  perform parent_private.requeue_parent_change(p_request_id,'You updated the named programs and service permission. Queued work has been revalidated for the new scope.');
  update public.parent_requests set mandate=p_mandate,mandate_revoked_at=null where id=p_request_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'mandate.replaced','parent','You gave an informed updated service permission.',jsonb_build_object('previousMandateHash',encode(sha256(convert_to(v_request.mandate::text,'UTF8')),'hex'),'mandateHash',encode(sha256(convert_to(p_mandate::text,'UTF8')),'hex')));
end $$;
create function public.parent_update_booking_preference(p_request_id uuid,p_preference text,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if v_request.version is distinct from p_expected_version or v_request.status not in ('active','paused') then raise exception 'request changed; reload before choosing' using errcode='40001'; end if;
  if p_preference is null or p_preference not in ('ask_me','weekday_morning','weekday_afternoon','any_weekday') then raise exception 'supported appointment preference required' using errcode='23514'; end if;
  perform parent_private.validate_mandate(jsonb_set(v_request.mandate,'{bookingPreference}',to_jsonb(p_preference)));
  perform parent_private.requeue_parent_change(p_request_id,'You chose an appointment preference. Other permission limits still apply.');
  update public.parent_requests set mandate=jsonb_set(mandate,'{bookingPreference}',to_jsonb(p_preference)) where id=p_request_id;
end $$;

create function parent_private.archive_request_evidence() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
    select encode(sha256(convert_to('parent-request:'||old.id::text,'UTF8')),'hex'),'mandate',mandate_hash,accepted_at from public.parent_mandates where request_id=old.id on conflict do nothing;
  insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
    select encode(sha256(convert_to('parent-request:'||old.id::text,'UTF8')),'hex'),'operation.'||state,packet_hash,coalesce(executed_at,created_at) from public.parent_operations where request_id=old.id on conflict do nothing;
  insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
    select encode(sha256(convert_to('parent-request:'||old.id::text,'UTF8')),'hex'),'form',content_sha256,created_at from public.parent_form_artifacts where request_id=old.id on conflict do nothing;
  return old;
end $$;
create trigger parent_archive_evidence before delete on public.parent_requests for each row execute function parent_private.archive_request_evidence();
revoke execute on function parent_private.record_mandate_version(),parent_private.record_operation_authority(),parent_private.requeue_parent_change(uuid,text),parent_private.archive_request_evidence() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
revoke execute on function public.parent_answer_fact(uuid,text,text,jsonb,integer),public.parent_replace_mandate(uuid,jsonb,integer),public.parent_update_booking_preference(uuid,text,integer) from public,anon,service_role,parent_worker,parent_retention_worker;
grant execute on function public.parent_answer_fact(uuid,text,text,jsonb,integer),public.parent_replace_mandate(uuid,jsonb,integer),public.parent_update_booking_preference(uuid,text,integer) to authenticated;

create or replace function parent_private.immutable_operation_packet() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.request_id,new.request_version,new.need,new.mandate_hash,new.authorization_snapshot,new.artifact_id,new.program_id,new.action,new.packet,new.packet_hash,new.data_categories,new.document_ids,new.idempotency_key,new.permission_version,new.created_at)
    is distinct from (old.request_id,old.request_version,old.need,old.mandate_hash,old.authorization_snapshot,old.artifact_id,old.program_id,old.action,old.packet,old.packet_hash,old.data_categories,old.document_ids,old.idempotency_key,old.permission_version,old.created_at) then raise exception 'attempted packet is immutable' using errcode='23514'; end if;
  return new;
end $$;


create function parent_private.parent_renew_job_lease(p_job_id uuid,p_lease_token uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_expiry timestamptz;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select least(now()+interval '300 seconds',v_job.lease_started_at+interval '15 minutes',(mandate->>'expiresAt')::timestamptz) into v_expiry from public.parent_requests where id=v_job.request_id;
  update public.parent_jobs set lease_until=v_expiry,updated_at=now() where id=p_job_id;
  return v_expiry;
end $$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='parent_storage_broker') then create role parent_storage_broker nologin noinherit nobypassrls; end if;
end $$;
grant usage on schema parent_private to parent_storage_broker;
create function parent_private.parent_authorize_storage(p_job_id uuid,p_lease_token uuid,p_bucket text,p_object_path text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_document public.parent_documents; v_form public.parent_form_artifacts; v_template parent_private.form_templates;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_mode is null or p_mode not in ('download','upload') or p_object_path is null or length(p_object_path) not between 1 and 300 then raise exception 'invalid storage purpose' using errcode='42501'; end if;
  if p_bucket='parent-documents' and p_mode='download' then
    select * into v_document from public.parent_documents where request_id=v_job.request_id and object_path=p_object_path and status in ('uploaded','processing','validated') and expires_at>now() and consent_version='2026-10-25'
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
revoke execute on function parent_private.parent_renew_job_lease(uuid,uuid) from public,anon,authenticated,service_role,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.parent_renew_job_lease(uuid,uuid) to parent_worker;
revoke execute on function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
grant execute on function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) to parent_storage_broker;

-- Public publishable keys cannot bypass the pre-pilot processing and identity gate.
create table parent_private.processing_controls (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  approval_reference text,
  approved_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into parent_private.processing_controls(singleton) values(true);
alter table parent_private.processing_controls enable row level security;
revoke all on parent_private.processing_controls from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
create function parent_private.processing_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select enabled and length(coalesce(approval_reference,''))>0 and approved_until>now() from parent_private.processing_controls where singleton),false);
$$;
create function public.parent_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not parent_private.processing_enabled() then return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Parent support is not accepting accounts in this environment.')); end if;
  return '{}'::jsonb;
end $$;
revoke execute on function parent_private.processing_enabled() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
revoke execute on function public.parent_before_user_created(jsonb) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_before_user_created(jsonb) to supabase_auth_admin;

create or replace function parent_private.verified_identity() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<now())
      and not coalesce(u.is_anonymous,false)
      and s.id=(select nullif(auth.jwt()->>'session_id','')::uuid)
      and (s.not_after is null or s.not_after>now())
      and not exists(select 1 from public.app_users staff where staff.id=u.id));
$$;

create or replace function parent_private.current_grant(p_request uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id
    where r.id=p_request and r.version=p_version and r.status='active' and r.mandate_revoked_at is null
      and a.status='active' and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')) and (u.banned_until is null or u.banned_until<now())
      and (r.mandate->>'expiresAt')::timestamptz>now());
$$;

create or replace function parent_private.trusted_identity() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<now()) and s.id=(select nullif(auth.jwt()->>'session_id','')::uuid)
      and (s.not_after is null or s.not_after>now()));
$$;
