-- Parent purpose, ownership and worker authority are independent of school casework.
create schema if not exists parent_private;
revoke all on schema parent_private from public, anon, authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='parent_worker') then
    create role parent_worker nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname='parent_retention_worker') then
    create role parent_retention_worker nologin noinherit nobypassrls;
  end if;
end $$;
grant usage on schema parent_private to parent_worker,parent_retention_worker;

create table public.parent_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','security_hold','deletion_requested','disabled')),
  preferences jsonb not null default '{"contactPreference":"in_app","language":"en","quietHoursStart":19,"quietHoursEnd":9}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.parent_households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.parent_accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.parent_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.parent_households(id) on delete cascade,
  start_key uuid not null default gen_random_uuid(),
  status text not null default 'active' check (status in ('active','paused','cancelled','closed')),
  intake jsonb not null check (jsonb_typeof(intake)='object'),
  mandate jsonb not null check (jsonb_typeof(mandate)='object'),
  mandate_revoked_at timestamptz,
  plan jsonb,
  required_actions jsonb not null default '[]' check (jsonb_typeof(required_actions)='array'),
  version integer not null default 1 check (version>0),
  next_actor text not null default 'caselink' check(next_actor in ('caselink','parent','partner','agency','service_operator')),
  next_trigger text not null default 'job_due',
  next_run_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index parent_requests_start_key on public.parent_requests(household_id,start_key);
create index parent_requests_household on public.parent_requests(household_id,created_at desc);
create table public.parent_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.parent_requests(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','leased','waiting','done','cancelled','failed')),
  request_version integer not null,
  run_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  lease_started_at timestamptz,
  attempts integer not null default 0 check (attempts>=0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parent_jobs_due on public.parent_jobs(state,run_at);
create table public.parent_operations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  request_version integer not null,
  program_id text not null,
  need text not null check(need in ('food_now','snap_new','snap_renewal','snap_pending','snap_problem','wic_new','wic_continuing','electricity','gas','water')),
  action text not null check (action in ('research','prepare','share','submit','schedule','follow_up')),
  packet jsonb not null check (jsonb_typeof(packet)='object'),
  packet_hash text not null,
  data_categories text[] not null,
  document_ids uuid[] not null default '{}',
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  permission_version text,
  state text not null default 'prepared' check (state in ('prepared','executing','sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved','delivery_unknown','failed','invalidated')),
  evidence jsonb,
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(request_id,idempotency_key),
  unique(request_id,request_version,need,program_id,action,packet_hash,permission_version)
);
create index parent_operations_request on public.parent_operations(request_id,created_at);
create table public.parent_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  kind text not null,
  actor text not null check (actor in ('parent','caselink','partner','agency','operator')),
  summary text not null check(length(summary) between 1 and 2000),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index parent_events_request on public.parent_events(request_id,created_at);
create table public.parent_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  filename text not null check(length(filename) between 1 and 200),
  media_type text not null check(media_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  page_count integer check(page_count between 1 and 5),
  object_path text not null unique,
  consent_version text not null check(consent_version='2026-10-25'),
  consented_at timestamptz not null default now(),
  status text not null default 'uploaded' check(status in ('uploaded','processing','validated','unreadable','raw_deleted','deletion_pending','deleted')),
  facts jsonb not null default '[]' check(jsonb_typeof(facts)='array'),
  expires_at timestamptz not null default now()+interval '7 days',
  created_at timestamptz not null default now()
);
create index parent_documents_request on public.parent_documents(request_id);
create table parent_private.provider_capabilities (
  program_id text not null check(program_id in ('snap-pa','wic-pa','uesf-benefits','uesf-utilities','peco-cap','pgw-crp','pwd-tap','philly-food')),
  action text not null check(action in ('share','submit','schedule','follow_up')),
  enabled boolean not null default false,
  transport_verified boolean not null default false,
  requires_form boolean default false,
  permission_version text not null,
  permission_reference text not null,
  allowed_fields text[] not null default '{}',
  field_categories jsonb not null default '{}',
  required_acts text[],
  verified_until timestamptz not null,
  primary key(program_id,action)
);
-- No external capability is enabled by the migration. Operator verification is a separate gate.
revoke all on all tables in schema parent_private from public,anon,authenticated,service_role,parent_worker;
alter table parent_private.provider_capabilities enable row level security;

create table parent_private.deletion_tombstones (
  subject_hash text primary key,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now()+interval '365 days'
);
alter table parent_private.deletion_tombstones enable row level security;
revoke all on parent_private.deletion_tombstones from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;

create function parent_private.verified_identity() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<now())
      and not coalesce(u.is_anonymous,false)
      and s.id=(select nullif(auth.jwt()->>'session_id','')::uuid)
      and (s.not_after is null or s.not_after>now())
      and not exists(select 1 from public.app_users staff where staff.id=u.id));
$$;
create function public.is_parent_session() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.verified_identity() and exists(select 1 from public.parent_accounts a
    where a.id=(select auth.uid()) and a.status='active' and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')));
$$;
create function parent_private.owns_request(p_request uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_parent_session() and exists(select 1 from public.parent_requests r
    join public.parent_households h on h.id=r.household_id
    where r.id=p_request and h.owner_id=(select auth.uid()));
$$;

alter table public.parent_accounts enable row level security;
alter table public.parent_households enable row level security;
alter table public.parent_requests enable row level security;
alter table public.parent_jobs enable row level security;
alter table public.parent_operations enable row level security;
alter table public.parent_events enable row level security;
alter table public.parent_documents enable row level security;
create policy parent_account_read on public.parent_accounts for select to authenticated
  using(id=(select auth.uid()) and public.is_parent_session());
create policy parent_household_read on public.parent_households for select to authenticated
  using(owner_id=(select auth.uid()) and public.is_parent_session());
create policy parent_request_read on public.parent_requests for select to authenticated
  using(parent_private.owns_request(id));
create policy parent_operation_read on public.parent_operations for select to authenticated
  using(parent_private.owns_request(request_id));
create policy parent_event_read on public.parent_events for select to authenticated
  using(parent_private.owns_request(request_id));
create policy parent_document_read on public.parent_documents for select to authenticated
  using(parent_private.owns_request(request_id) and status<>'deleted');
revoke all on public.parent_accounts,public.parent_households,public.parent_requests,public.parent_jobs,public.parent_operations,public.parent_events,public.parent_documents from public,anon,authenticated,service_role,parent_worker;
grant select on public.parent_accounts,public.parent_households,public.parent_requests,public.parent_operations,public.parent_events,public.parent_documents to authenticated;
-- RLS invokes this private helper; its schema is not exposed through PostgREST.
grant usage on schema parent_private to authenticated;
grant execute on function parent_private.owns_request(uuid) to authenticated;
grant execute on function public.is_parent_session() to authenticated;

create function public.parent_ensure_account() returns uuid
language plpgsql security definer set search_path='' as $$
declare v_household uuid;
begin
  if not parent_private.verified_identity() then raise exception 'verified parent session required' using errcode='42501'; end if;
  if exists(select 1 from parent_private.deletion_tombstones where subject_hash=encode(sha256(convert_to('parent-account:'||auth.uid()::text,'UTF8')),'hex')) then raise exception 'deleted account cannot be restored by sign-in' using errcode='42501'; end if;
  insert into public.parent_accounts(id) values(auth.uid()) on conflict do nothing;
  if not public.is_parent_session() then raise exception 'parent account unavailable' using errcode='42501'; end if;
  insert into public.parent_households(owner_id) values(auth.uid()) on conflict(owner_id) do nothing;
  select id into v_household from public.parent_households where owner_id=auth.uid();
  return v_household;
end $$;

create function parent_private.validate_intake(p_intake jsonb) returns void
language plpgsql set search_path='' as $$
declare v_needs text[];
begin
  if p_intake is null or jsonb_typeof(p_intake)<>'object' or pg_column_size(p_intake)>12000
    or p_intake->'adultConfirmed' is distinct from 'true'::jsonb
    or coalesce(p_intake->>'zip','')!~'^\d{5}$'
    or coalesce(p_intake->>'urgency','') not in ('today','soon','planning')
    or coalesce(p_intake->>'language','') not in ('en','es')
    or coalesce(p_intake->>'incomeFrequency','') not in ('weekly','biweekly','twice_monthly','monthly','yearly','unknown')
    or coalesce(p_intake->>'accountAuthority','') not in ('self','authorized_caregiver','not_sure')
    or coalesce(p_intake->>'contactPreference','') not in ('in_app','email')
    or jsonb_typeof(p_intake->'needs') is distinct from 'array' then
    raise exception 'invalid parent intake' using errcode='23514';
  end if;
  select array_agg(v) into v_needs from jsonb_array_elements_text(p_intake->'needs') v;
  if coalesce(cardinality(v_needs),0) not between 1 and 10 or not v_needs<@array['food_now','snap_new','snap_renewal','snap_pending','snap_problem','wic_new','wic_continuing','electricity','gas','water']
    or cardinality(v_needs)<>(select count(distinct v) from unnest(v_needs) v)
    or (select count(*) from jsonb_object_keys(p_intake))<>14 then
    raise exception 'invalid intake needs or fields' using errcode='23514';
  end if;
  if not (p_intake ?& array['needs','urgency','zip','language','householdSize','childrenUnderFive','pregnantOrPostpartum','incomeAmount','incomeFrequency','utilityProviders','shutoffDate','accountAuthority','contactPreference','adultConfirmed']) then
    raise exception 'missing intake fields' using errcode='23514';
  end if;
  if p_intake->'householdSize'<>'null'::jsonb and (jsonb_typeof(p_intake->'householdSize')<>'number' or (p_intake->>'householdSize')::numeric not between 1 and 30 or (p_intake->>'householdSize')::numeric<>trunc((p_intake->>'householdSize')::numeric)) then raise exception 'invalid household size' using errcode='23514'; end if;
  if p_intake->'incomeAmount'<>'null'::jsonb and (jsonb_typeof(p_intake->'incomeAmount')<>'number' or (p_intake->>'incomeAmount')::numeric not between 0 and 1000000 or p_intake->>'incomeFrequency'='unknown') then raise exception 'invalid income' using errcode='23514'; end if;
  if jsonb_typeof(p_intake->'utilityProviders')<>'array' or jsonb_array_length(p_intake->'utilityProviders')>5 or exists(select 1 from jsonb_array_elements_text(p_intake->'utilityProviders') v where v not in ('peco','pgw','pwd','other','unknown')) then raise exception 'invalid utility providers' using errcode='23514'; end if;
  if p_intake->'childrenUnderFive' not in ('null'::jsonb,'true'::jsonb,'false'::jsonb) or p_intake->'pregnantOrPostpartum' not in ('null'::jsonb,'true'::jsonb,'false'::jsonb) then raise exception 'invalid household facts' using errcode='23514'; end if;
  if p_intake->'shutoffDate'<>'null'::jsonb and (select count(*) from unnest(v_needs) n where n in ('electricity','gas','water'))>1 then raise exception 'combined utility dates need account-specific facts' using errcode='23514'; end if;
  if p_intake->'shutoffDate'<>'null'::jsonb and ((p_intake->>'shutoffDate')!~'^\d{4}-\d{2}-\d{2}$' or to_char((p_intake->>'shutoffDate')::date,'YYYY-MM-DD')<>p_intake->>'shutoffDate') then raise exception 'invalid shutoff date' using errcode='23514'; end if;
end $$;

create function parent_private.validate_mandate(p_mandate jsonb) returns void
language plpgsql set search_path='' as $$
declare v_recipients text[]; v_actions text[]; v_data text[];
begin
  if p_mandate is null or jsonb_typeof(p_mandate)<>'object' or pg_column_size(p_mandate)>8000
    or p_mandate->'version' is distinct from '1'::jsonb or p_mandate->'accepted' is distinct from 'true'::jsonb
    or jsonb_typeof(p_mandate->'maxAttempts') is distinct from 'number'
    or jsonb_typeof(p_mandate->'maxRecipients') is distinct from 'number'
    or jsonb_typeof(p_mandate->'expiresAt') is distinct from 'string'
    or coalesce(p_mandate->>'mode','') not in ('full','prepare_only')
    or coalesce(p_mandate->>'bookingPreference','') not in ('ask_me','weekday_morning','weekday_afternoon','any_weekday')
    or jsonb_typeof(p_mandate->'recipientIds') is distinct from 'array'
    or jsonb_typeof(p_mandate->'allowedActions') is distinct from 'array'
    or jsonb_typeof(p_mandate->'allowedData') is distinct from 'array'
    or not(p_mandate ?& array['version','mode','recipientIds','allowedActions','allowedData','expiresAt','maxAttempts','maxRecipients','bookingPreference','accepted'])
    or (select count(*) from jsonb_object_keys(p_mandate))<>10 then raise exception 'invalid service mandate' using errcode='23514'; end if;
  select array_agg(v) into v_recipients from jsonb_array_elements_text(p_mandate->'recipientIds') v;
  select array_agg(v) into v_actions from jsonb_array_elements_text(p_mandate->'allowedActions') v;
  select array_agg(v) into v_data from jsonb_array_elements_text(p_mandate->'allowedData') v;
  if coalesce(cardinality(v_recipients),0) not between 1 and 12 or not v_recipients<@array['snap-pa','wic-pa','uesf-benefits','uesf-utilities','peco-cap','pgw-crp','pwd-tap','philly-food']
    or cardinality(v_recipients)<>(select count(distinct v) from unnest(v_recipients) v)
    or coalesce(cardinality(v_actions),0) not between 1 and 6 or not v_actions<@array['research','prepare','share','submit','schedule','follow_up']
    or coalesce(cardinality(v_data),0) not between 1 and 4 or not v_data<@array['household','income','utility','documents']
    or (p_mandate->>'maxAttempts')::numeric not between 1 and 24 or (p_mandate->>'maxAttempts')::numeric<>trunc((p_mandate->>'maxAttempts')::numeric)
    or (p_mandate->>'maxRecipients')::numeric not between cardinality(v_recipients) and 12 or (p_mandate->>'maxRecipients')::numeric<>trunc((p_mandate->>'maxRecipients')::numeric)
    or (p_mandate->>'expiresAt')::timestamptz<=now() or (p_mandate->>'expiresAt')::timestamptz>now()+interval '30 days'
    or (p_mandate->>'mode'='prepare_only' and not v_actions<@array['research','prepare']) then raise exception 'mandate exceeds supported limits' using errcode='23514'; end if;
end $$;

create function public.parent_start_request(p_intake jsonb,p_mandate jsonb,p_idempotency_key uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_household uuid; v_request uuid; v_existing public.parent_requests;
begin
  v_household:=public.parent_ensure_account();
  perform parent_private.validate_intake(p_intake); perform parent_private.validate_mandate(p_mandate);
  perform 1 from public.parent_households where id=v_household for update;
  if p_idempotency_key is not null then
    select * into v_existing from public.parent_requests where household_id=v_household and start_key=p_idempotency_key;
    if found then
      if v_existing.intake<>p_intake or v_existing.mandate<>p_mandate then raise exception 'start key already binds another request' using errcode='23514'; end if;
      return v_existing.id;
    end if;
  end if;
  if (select count(*) from public.parent_requests where household_id=v_household and status in ('active','paused'))>=12 then raise exception 'active request limit reached' using errcode='23514'; end if;
  if p_intake->>'contactPreference'='email' then update public.parent_accounts set preferences=jsonb_set(preferences,'{contactPreference}','"email"') where id=auth.uid(); end if;
  insert into public.parent_requests(household_id,start_key,intake,mandate) values(v_household,coalesce(p_idempotency_key,gen_random_uuid()),p_intake,p_mandate) returning id into v_request;
  insert into public.parent_jobs(request_id,request_version) values(v_request,1);
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_request,'request.started','parent','You asked CaseLink to start getting support.',jsonb_build_object('mandateVersion',1,'expiresAt',p_mandate->>'expiresAt'));
  return v_request;
end $$;

create function parent_private.invalidate_work(p_request uuid,p_reason text) returns void
language plpgsql set search_path='' as $$
begin
  update public.parent_jobs set state='cancelled',lease_token=null,lease_until=null,updated_at=now() where request_id=p_request;
  update public.parent_operations set state=case when state='executing' then 'delivery_unknown' else 'invalidated' end,updated_at=now()
    where request_id=p_request and state in ('prepared','executing');
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request,'authority.changed','parent',p_reason,'{}');
end $$;
create function public.parent_control_request(p_request_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if p_action is null or p_action not in ('pause','resume','cancel') or v_request.status in ('cancelled','closed') then raise exception 'invalid request change' using errcode='23514'; end if;
  if p_action='resume' then
    if v_request.mandate_revoked_at is not null or (v_request.mandate->>'expiresAt')::timestamptz<=now() then raise exception 'authorization expired' using errcode='23514'; end if;
    update public.parent_requests set status='active',version=version+1,updated_at=now() where id=p_request_id;
    update public.parent_jobs set state='queued',request_version=v_request.version+1,run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now() where request_id=p_request_id;
  else
    perform parent_private.invalidate_work(p_request_id,case p_action when 'pause' then 'You paused support. Future actions have stopped.' else 'You cancelled support and revoked permission for future actions.' end);
    update public.parent_requests set status=case p_action when 'pause' then 'paused' else 'cancelled' end,version=version+1,
      mandate_revoked_at=case when p_action='cancel' then now() else mandate_revoked_at end,updated_at=now() where id=p_request_id;
  end if;
end $$;
create function public.parent_correct_request(p_request_id uuid,p_intake jsonb,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  perform parent_private.validate_intake(p_intake);
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if v_request.version is distinct from p_expected_version or v_request.status in ('cancelled','closed') then raise exception 'request changed; reload before correcting' using errcode='40001'; end if;
  perform parent_private.invalidate_work(p_request_id,'You corrected your information. CaseLink will use the updated facts and reconcile work already sent.');
  update public.parent_requests set intake=p_intake,version=version+1,plan=null,required_actions='[]',updated_at=now() where id=p_request_id;
  update public.parent_jobs set state=case when v_request.status='active' then 'queued' else 'cancelled' end,request_version=v_request.version+1,run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now() where request_id=p_request_id;
end $$;
create function public.parent_update_preferences(p_preferences jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_parent_session() then raise exception 'parent session required' using errcode='42501'; end if;
  if jsonb_typeof(p_preferences)<>'object' or (select count(*) from jsonb_object_keys(p_preferences))<>4
    or not(p_preferences ?& array['contactPreference','language','quietHoursStart','quietHoursEnd'])
    or coalesce(p_preferences->>'contactPreference','') not in ('in_app','email') or coalesce(p_preferences->>'language','') not in ('en','es')
    or jsonb_typeof(p_preferences->'quietHoursStart') is distinct from 'number' or jsonb_typeof(p_preferences->'quietHoursEnd') is distinct from 'number'
    or (p_preferences->>'quietHoursStart')::numeric<>trunc((p_preferences->>'quietHoursStart')::numeric) or (p_preferences->>'quietHoursEnd')::numeric<>trunc((p_preferences->>'quietHoursEnd')::numeric)
    or (p_preferences->>'quietHoursStart')::integer not between 0 and 23 or (p_preferences->>'quietHoursEnd')::integer not between 0 and 23 then raise exception 'invalid preferences' using errcode='23514'; end if;
  update public.parent_accounts set preferences=p_preferences,updated_at=now() where id=auth.uid();
end $$;
create function public.parent_request_deletion() returns void
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.is_parent_session() then raise exception 'parent session required' using errcode='42501'; end if;
  for v_id in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=auth.uid() order by r.id for update of r loop
    perform parent_private.invalidate_work(v_id,'Account deletion requested. Future sharing and processing have stopped.');
    update public.parent_requests set status='cancelled',mandate_revoked_at=now(),version=version+1,updated_at=now() where id=v_id;
    update public.parent_documents set status='deletion_pending',expires_at=least(expires_at,now()) where request_id=v_id and status<>'deleted';
  end loop;
  insert into parent_private.deletion_tombstones(subject_hash) values(encode(sha256(convert_to('parent-account:'||auth.uid()::text,'UTF8')),'hex')) on conflict do nothing;
  update public.parent_accounts set status='deletion_requested',updated_at=now() where id=auth.uid();
end $$;

create function public.parent_register_document(p_request_id uuid,p_filename text,p_media_type text,p_size_bytes integer,p_page_count integer,p_consent_version text) returns public.parent_documents
language plpgsql security definer set search_path='' as $$
declare v_doc public.parent_documents; v_id uuid:=gen_random_uuid();
begin
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from public.parent_requests where id=p_request_id and status in ('active','paused')) then raise exception 'request unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from public.parent_requests where id=p_request_id and status in ('active','paused')) then raise exception 'request unavailable' using errcode='42501'; end if;
  if p_filename is null or p_filename~'[[:cntrl:]/\\]' then raise exception 'invalid document filename' using errcode='23514'; end if;
  if (select count(*) from public.parent_documents where request_id=p_request_id and status not in ('deleted','deletion_pending','raw_deleted') and expires_at>now())>=10
    or coalesce((select sum(size_bytes) from public.parent_documents where request_id=p_request_id and status not in ('deleted','deletion_pending','raw_deleted') and expires_at>now()),0)+p_size_bytes>52428800 then raise exception 'parent_document_limit' using errcode='P0001'; end if;
  insert into public.parent_documents(id,request_id,filename,media_type,size_bytes,page_count,object_path,consent_version)
    values(v_id,p_request_id,p_filename,p_media_type,p_size_bytes,p_page_count,auth.uid()::text||'/'||p_request_id::text||'/'||v_id::text,p_consent_version) returning * into v_doc;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'document.added','parent','You added a document with permission to process it.',jsonb_build_object('documentId',v_id));
  return v_doc;
end $$;
create function public.parent_delete_document(p_request_id uuid,p_document_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_path text;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  update public.parent_documents set status='deletion_pending',expires_at=least(expires_at,now()) where id=p_document_id and request_id=p_request_id returning object_path into v_path;
  if v_path is null then raise exception 'document unavailable' using errcode='42501'; end if;
  perform parent_private.invalidate_work(p_request_id,'You removed a document. Queued work using it has stopped.');
  update public.parent_requests set version=version+1,updated_at=now() where id=p_request_id;
  update public.parent_jobs j set state=case when r.status='active' then 'queued' else 'cancelled' end,request_version=r.version,run_at=now(),updated_at=now() from public.parent_requests r where j.request_id=r.id and r.id=p_request_id;
  return v_path;
end $$;

create function public.parent_resolve_action(p_request_id uuid,p_action_id text,p_value text) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_action jsonb;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  select v into v_action from jsonb_array_elements(v_request.required_actions) v where v->>'id'=p_action_id and not coalesce((v->>'resolved')::boolean,false);
  if v_action is null or v_request.status<>'active' or length(btrim(coalesce(p_value,''))) not between 1 and 2000 then raise exception 'action unavailable' using errcode='23514'; end if;
  if v_action->>'field'='accountAuthority' then
    if p_value not in ('self','authorized_caregiver') then raise exception 'account authority answer required' using errcode='23514'; end if;
    update public.parent_requests set intake=jsonb_set(intake,'{accountAuthority}',to_jsonb(p_value)) where id=p_request_id;
  end if;
  -- Reports resume reconciliation; they never establish agency submission or an award.
  update public.parent_requests set required_actions=(select jsonb_agg(case when v->>'id'=p_action_id then v||'{"resolved":true}'::jsonb else v end) from jsonb_array_elements(required_actions) v),version=version+1,updated_at=now() where id=p_request_id;
  perform parent_private.invalidate_work(p_request_id,'You provided an update. CaseLink will check the next step.');
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'parent.reported','parent','You reported an update for a required step.',jsonb_build_object('actionId',p_action_id,'reportedValue',p_value,'attribution','parent_reported'));
  update public.parent_jobs set state='queued',request_version=v_request.version+1,run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now() where request_id=p_request_id;
end $$;

-- Scoped service grant follows current account/request/mandate, independent of browser sessions.
create function parent_private.current_grant(p_request uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id
    where r.id=p_request and r.version=p_version and r.status='active' and r.mandate_revoked_at is null
      and a.status='active' and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')) and (u.banned_until is null or u.banned_until<now())
      and (r.mandate->>'expiresAt')::timestamptz>now());
$$;
create function parent_private.parent_claim_job(p_lease_seconds integer default 120) returns jsonb
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
    'documents',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('object_path',case when d.status='raw_deleted' then null else d.object_path end)),'[]') from public.parent_documents d where d.request_id=v_request_id and d.status not in ('deleted','deletion_pending') and d.expires_at>now()),
    'unknownOperations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.parent_operations o where o.request_id=v_request_id and o.state='delivery_unknown'));
end $$;
create function parent_private.require_lease(p_job uuid,p_lease uuid,p_version integer) returns public.parent_jobs
language plpgsql set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job;
  perform 1 from public.parent_requests where id=v_job.request_id for update;
  select * into v_job from public.parent_jobs where id=p_job for update;
  if not found or v_job.state<>'leased' or v_job.lease_token is distinct from p_lease or v_job.lease_until is null or v_job.lease_until<=now()
    or v_job.lease_started_at is null or v_job.lease_started_at<now()-interval '15 minutes'
    or v_job.request_version is distinct from p_version or not parent_private.current_grant(v_job.request_id,p_version) then raise exception 'work authority changed or lease expired' using errcode='42501'; end if;
  return v_job;
end $$;

create table parent_private.ai_calls (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.parent_accounts(id) on delete cascade,
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table parent_private.ai_calls enable row level security;
create index parent_ai_calls_account_time on parent_private.ai_calls(account_id,created_at);
create index parent_ai_calls_request on parent_private.ai_calls(request_id);
revoke all on parent_private.ai_calls from public,anon,authenticated,service_role,parent_worker;
create function parent_private.parent_reserve_ai_call(p_job_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_owner uuid;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select h.owner_id into v_owner from public.parent_requests r join public.parent_households h on h.id=r.household_id where r.id=v_job.request_id;
  perform 1 from public.parent_accounts where id=v_owner for update;
  if (select count(*) from parent_private.ai_calls where request_id=v_job.request_id)>=12
    or (select count(*) from parent_private.ai_calls where account_id=v_owner and created_at>now()-interval '24 hours')>=60 then return false; end if;
  insert into parent_private.ai_calls(account_id,request_id) values(v_owner,v_job.request_id);
  return true;
end $$;
create function parent_private.parent_save_job_plan(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_plan jsonb,p_required_actions jsonb,p_next_run_at timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,p_expected_version);
  if p_plan is null or p_required_actions is null or jsonb_typeof(p_plan)<>'object' or pg_column_size(p_plan)>100000 or p_plan->>'version' is distinct from '1' or jsonb_typeof(p_plan->'routes') is distinct from 'array'
    or jsonb_array_length(p_plan->'routes')>30 or jsonb_typeof(p_required_actions)<>'array' or jsonb_array_length(p_required_actions)>30 or pg_column_size(p_required_actions)>50000
    or (p_next_run_at is not null and p_next_run_at<now()+interval '30 seconds') then raise exception 'invalid work result' using errcode='23514'; end if;
  update public.parent_requests set plan=p_plan,required_actions=p_required_actions,
    next_actor=case when p_next_run_at is not null then 'caselink' when exists(select 1 from jsonb_array_elements(p_required_actions) a where not coalesce((a->>'resolved')::boolean,false) and coalesce(a->>'resolver','parent')='parent') then 'parent' else 'service_operator' end,
    next_trigger=case when p_next_run_at is not null then 'job_due' when exists(select 1 from jsonb_array_elements(p_required_actions) a where not coalesce((a->>'resolved')::boolean,false) and coalesce(a->>'resolver','parent')='parent') then 'parent_action' else 'provider_capability_enabled' end,
    next_run_at=p_next_run_at,updated_at=now() where id=v_job.request_id;
  update public.parent_jobs set state='waiting',run_at=coalesce(p_next_run_at,'infinity'::timestamptz),lease_token=null,lease_until=null,updated_at=now() where id=p_job_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'plan.prepared','caselink','CaseLink checked your options and prepared the next steps.',jsonb_build_object('requestVersion',p_expected_version,'nextRunAt',p_next_run_at,'waitingFor',case when p_next_run_at is null then 'required_step_or_provider_connection' else 'scheduled_work' end));
end $$;
create function parent_private.program_supports_need(p_program text,p_need text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce((p_need='food_now' and p_program='philly-food')
    or (p_need in ('snap_new','snap_renewal','snap_pending','snap_problem') and p_program in ('snap-pa','uesf-benefits'))
    or (p_need in ('wic_new','wic_continuing') and p_program in ('wic-pa','uesf-benefits'))
    or (p_need='electricity' and p_program in ('peco-cap','uesf-utilities'))
    or (p_need='gas' and p_program='pgw-crp') or (p_need='water' and p_program in ('pwd-tap','uesf-utilities')),false);
$$;

create function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.current_grant(p_request,p_version) and exists(select 1 from public.parent_requests r
    where r.id=p_request and r.mandate->'recipientIds' ? p_program and r.mandate->'allowedActions' ? p_action
    and p_data<@array(select jsonb_array_elements_text(r.mandate->'allowedData'))
    and (cardinality(p_documents)=0 or ('documents'=any(p_data) and not exists(select 1 from unnest(p_documents) d_id where not exists(select 1 from public.parent_documents d where d.id=d_id and d.request_id=r.id and d.status='validated' and d.expires_at>now()))))
    and (p_action in ('research','prepare') or (r.mandate->>'mode'='full' and exists(select 1 from parent_private.provider_capabilities c where c.program_id=p_program and c.action=p_action and c.enabled and c.transport_verified and c.requires_form is not null and c.verified_until>now() and c.required_acts is not null
      and not exists(select 1 from jsonb_each(p_packet) f where not f.key=any(c.allowed_fields) or c.field_categories->>f.key is null or not(c.field_categories->>f.key=any(p_data))))))
    and (p_action in ('research','prepare') or not('utility'=any(p_data)) or r.intake->>'accountAuthority' in ('self','authorized_caregiver'))
    and (p_action<>'schedule' or r.mandate->>'bookingPreference'<>'ask_me'));
$$;
create function parent_private.parent_save_document_facts(p_job_id uuid,p_lease_token uuid,p_document_id uuid,p_facts jsonb,p_source_pages text[],p_page_count integer default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_doc public.parent_documents; v_field jsonb; v_name text; v_value jsonb; v_records jsonb:='[]'; v_source text; v_label text;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select * into v_doc from public.parent_documents where id=p_document_id for update;
  if v_doc.request_id is distinct from v_job.request_id or v_doc.status not in ('uploaded','processing') or v_doc.expires_at<=now() or v_doc.consent_version<>'2026-10-25' or not exists(select 1 from public.parent_requests r where r.id=v_job.request_id and r.mandate->'allowedData' ? 'documents' and r.mandate->'allowedActions' ?| array['research','prepare'])
    or p_facts is null or jsonb_typeof(p_facts)<>'object' or pg_column_size(p_facts)>8000 or (select count(*) from jsonb_object_keys(p_facts))<>6
    or not(p_facts ?& array['provider','amountDue','totalBalance','dueDate','shutoffDate','fields'])
    or jsonb_typeof(p_facts->'fields') is distinct from 'array' or jsonb_array_length(p_facts->'fields')>5
    or coalesce(p_page_count,v_doc.page_count) is null or coalesce(p_page_count,v_doc.page_count) not between 1 and 5
    or p_source_pages is null or array_position(p_source_pages,null) is not null or cardinality(p_source_pages) not between 1 and 5 or octet_length(array_to_string(p_source_pages,''))>100000 then raise exception 'document source or processing authority unavailable' using errcode='42501'; end if;
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
  update public.parent_documents set page_count=coalesce(p_page_count,v_doc.page_count),facts=v_records,status='validated',expires_at=least(expires_at,now()+interval '24 hours') where id=p_document_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'document.validated','caselink','CaseLink checked supported document values against their original source.',jsonb_build_object('documentId',p_document_id,'fieldCount',jsonb_array_length(v_records)));
end $$;

create function parent_private.parent_reject_document(p_job_id uuid,p_lease_token uuid,p_document_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_reason is null or p_reason not in ('unsupported_type','unreadable','encrypted','too_many_pages','unsafe_content','processing_failed') then raise exception 'invalid document failure code' using errcode='23514'; end if;
  update public.parent_documents set status='unreadable',facts='[]',expires_at=now() where id=p_document_id and request_id=v_job.request_id and status in ('uploaded','processing');
  if not found then raise exception 'document unavailable' using errcode='42501'; end if;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'document.unreadable','caselink','This document could not be safely read. Manual entry or a plain replacement is available.',jsonb_build_object('documentId',p_document_id,'reason',p_reason));
end $$;

create function parent_private.parent_fail_job(p_job_id uuid,p_lease_token uuid,p_reason text,p_retry_at timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_retry boolean;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_reason is null or p_reason not in ('ai_unavailable','ai_budget_exhausted','invalid_ai_result','provider_unavailable','delivery_unknown','execution_error','configuration_unavailable') then raise exception 'invalid worker failure reason' using errcode='23514'; end if;
  v_retry:=p_retry_at is not null and v_job.attempts<5 and p_reason in ('ai_unavailable','provider_unavailable','execution_error');
  update public.parent_jobs set state=case when v_retry then 'waiting' else 'failed' end,run_at=case when v_retry then greatest(p_retry_at,now()+make_interval(secs=>least(3600,30*power(2,v_job.attempts)::integer))) else run_at end,last_error=p_reason,lease_token=null,lease_until=null,updated_at=now() where id=p_job_id;
  if not v_retry then
    update public.parent_requests set next_actor='service_operator',next_trigger='execution_issue_resolved',next_run_at=null,required_actions=required_actions||jsonb_build_array(jsonb_build_object('id','execution-'||p_job_id::text,'need',intake->'needs'->>0,'reason','execution_issue','title','A support specialist is needed','resolver','operator','explanation','CaseLink could not safely continue this step. Your request and prepared work are saved.','resolved',false)),updated_at=now() where id=v_job.request_id;
  end if;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'work.recoverable_failure','caselink',case when v_retry then 'CaseLink will retry a temporary interruption. Your information is saved.' else 'This step needs help before it can continue. Your information and prepared work are saved.' end,jsonb_build_object('reason',p_reason,'nextRunAt',case when v_retry then p_retry_at else null end));
end $$;

create function parent_private.validate_packet(p_packet jsonb,p_data text[],p_documents uuid[],p_action text) returns void
language plpgsql set search_path='' as $$
declare v_field record; v_category text; v_document_ids uuid[];
begin
  if p_packet is null or jsonb_typeof(p_packet)<>'object' or pg_column_size(p_packet)>50000 or p_packet='{}' or p_data is null or p_documents is null then raise exception 'invalid operation packet' using errcode='23514'; end if;
  for v_field in select key,value from jsonb_each(p_packet) loop
    v_category:=case when v_field.key in ('zip','householdSize','statusReference') then 'household' when v_field.key in ('incomeAmount','incomeFrequency') then 'income' when v_field.key in ('utilityProvider','accountAuthority','amountDue','totalBalance','dueDate','shutoffDate') then 'utility' when v_field.key='documentIds' then 'documents' else null end;
    if v_category is null or not v_category=any(p_data) then raise exception 'undeclared or unsupported packet data' using errcode='42501'; end if;
    if v_field.key='statusReference' and (p_action<>'follow_up' or jsonb_typeof(v_field.value)<>'string' or length(v_field.value#>>'{}') not between 1 and 200) then raise exception 'invalid status reference' using errcode='23514'; end if;
    if v_field.key='zip' and (jsonb_typeof(v_field.value)<>'string' or v_field.value#>>'{}'!~'^\d{5}$') then raise exception 'invalid packet zip' using errcode='23514'; end if;
    if v_field.key='householdSize' and (jsonb_typeof(v_field.value)<>'number' or (v_field.value#>>'{}')::numeric not between 1 and 30 or (v_field.value#>>'{}')::numeric<>trunc((v_field.value#>>'{}')::numeric)) then raise exception 'invalid packet household size' using errcode='23514'; end if;
    if v_field.key in ('incomeAmount','amountDue','totalBalance') and (jsonb_typeof(v_field.value)<>'number' or (v_field.value#>>'{}')::numeric not between 0 and 1000000) then raise exception 'invalid packet amount' using errcode='23514'; end if;
    if v_field.key='incomeFrequency' and (v_field.value#>>'{}') not in ('weekly','biweekly','twice_monthly','monthly','yearly') then raise exception 'invalid income frequency' using errcode='23514'; end if;
    if v_field.key='utilityProvider' and (v_field.value#>>'{}') not in ('peco','pgw','pwd','other','unknown') then raise exception 'invalid utility provider' using errcode='23514'; end if;
    if v_field.key='accountAuthority' and (v_field.value#>>'{}') not in ('self','authorized_caregiver') then raise exception 'unresolved account authority' using errcode='23514'; end if;
    if v_field.key in ('dueDate','shutoffDate') and (jsonb_typeof(v_field.value)<>'string' or (v_field.value#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' or to_char((v_field.value#>>'{}')::date,'YYYY-MM-DD')<>v_field.value#>>'{}') then raise exception 'invalid packet date' using errcode='23514'; end if;
    if v_field.key='documentIds' then
      if jsonb_typeof(v_field.value)<>'array' or jsonb_array_length(v_field.value)>10 then raise exception 'invalid packet attachments' using errcode='23514'; end if;
      select coalesce(array_agg(x::uuid order by x),'{}') into v_document_ids from jsonb_array_elements_text(v_field.value) x;
    end if;
  end loop;
  if coalesce(v_document_ids,'{}')<>(select coalesce(array_agg(x order by x::text),'{}') from unnest(p_documents) x) then raise exception 'packet attachments do not match authorization' using errcode='42501'; end if;
end $$;

create function parent_private.parent_prepare_operation(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_program_id text,p_action text,p_packet jsonb,p_data_categories text[],p_document_ids uuid[],p_idempotency_key text,p_need text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations; v_hash text; v_permission text; v_need text; v_compatible text[];
begin
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,p_expected_version);
  select array_agg(n) into v_compatible from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n where r.id=v_job.request_id and parent_private.program_supports_need(p_program_id,n);
  v_need:=coalesce(p_need,case when cardinality(v_compatible)=1 then v_compatible[1] else null end);
  if v_need is null or not v_need=any(v_compatible) then raise exception 'one exact requested need must be bound to the operation' using errcode='23514'; end if;
  perform parent_private.validate_packet(p_packet,p_data_categories,p_document_ids,p_action);
  if p_packet ? 'statusReference' and not exists(select 1 from public.parent_operations o where o.request_id=v_job.request_id and o.program_id=p_program_id and o.need=v_need and o.state in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received') and o.evidence->>'reference'=p_packet->>'statusReference' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) then raise exception 'status reference is not a verified receipt for this request and program' using errcode='42501'; end if;
  if jsonb_typeof(p_packet)<>'object' or pg_column_size(p_packet)>100000 or p_data_categories is null or p_document_ids is null or not parent_private.operation_allowed(v_job.request_id,p_expected_version,p_program_id,p_action,p_data_categories,p_document_ids,p_packet,v_need) then raise exception 'operation outside current authority' using errcode='42501'; end if;
  v_hash:=encode(sha256(convert_to(p_packet::text,'UTF8')),'hex');
  select * into v_operation from public.parent_operations where request_id=v_job.request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_operation.packet_hash<>v_hash or v_operation.need<>v_need or v_operation.program_id<>p_program_id or v_operation.action<>p_action or v_operation.request_version<>p_expected_version or v_operation.data_categories<>p_data_categories or v_operation.document_ids<>p_document_ids then raise exception 'idempotency key already binds another operation' using errcode='23514'; end if;
    return v_operation.id;
  end if;
  select permission_version into v_permission from parent_private.provider_capabilities where program_id=p_program_id and action=p_action;
  insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,permission_version)
    values(v_job.request_id,p_expected_version,v_need,p_program_id,p_action,p_packet,v_hash,p_data_categories,p_document_ids,p_idempotency_key,v_permission) returning id into v_operation.id;
  return v_operation.id;
end $$;
create table parent_private.personal_act_evidence (
  operation_id uuid not null references public.parent_operations(id) on delete cascade,
  act text not null,
  packet_hash text not null,
  reference text not null,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  primary key(operation_id,act,packet_hash)
);
alter table parent_private.personal_act_evidence enable row level security;
revoke all on parent_private.personal_act_evidence from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;

create table parent_private.receipt_authority (
  operation_id uuid primary key references public.parent_operations(id) on delete cascade,
  job_id uuid not null references public.parent_jobs(id) on delete cascade,
  lease_token uuid not null,
  packet_hash text not null,
  valid_until timestamptz not null
);
alter table parent_private.receipt_authority enable row level security;
revoke all on parent_private.receipt_authority from public,anon,authenticated,service_role,parent_worker;

create function parent_private.parent_begin_operation(p_operation_id uuid,p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations; v_request public.parent_requests; v_permission text;
begin
  select * into v_operation from public.parent_operations where id=p_operation_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_operation.request_version);
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  select * into v_request from public.parent_requests where id=v_job.request_id for update;
  if v_operation.request_id<>v_job.request_id or v_operation.state<>'prepared' or not parent_private.operation_allowed(v_job.request_id,v_operation.request_version,v_operation.program_id,v_operation.action,v_operation.data_categories,v_operation.document_ids,v_operation.packet,v_operation.need) then raise exception 'operation no longer executable' using errcode='42501'; end if;
  if v_operation.action not in ('research','prepare') then
    select permission_version into v_permission from parent_private.provider_capabilities where program_id=v_operation.program_id and action=v_operation.action;
    if v_permission is distinct from v_operation.permission_version then raise exception 'provider permission changed' using errcode='42501'; end if;
    if exists(select 1 from parent_private.provider_capabilities c cross join lateral unnest(c.required_acts) act where c.program_id=v_operation.program_id and c.action=v_operation.action and not exists(select 1 from parent_private.personal_act_evidence e where e.operation_id=v_operation.id and e.act=act and e.packet_hash=v_operation.packet_hash and e.expires_at>now())) then raise exception 'required personal act has not been verified for this packet' using errcode='42501'; end if;
    if (select count(*) from public.parent_operations where request_id=v_job.request_id and action not in ('research','prepare') and executed_at is not null)>=(v_request.mandate->>'maxAttempts')::integer then raise exception 'service attempt limit reached' using errcode='23514'; end if;
    if exists(select 1 from public.parent_operations where request_id=v_job.request_id and need=v_operation.need and action not in ('research','prepare') and state='delivery_unknown') then raise exception 'unknown delivery requires reconciliation' using errcode='23514'; end if;
  end if;
  update public.parent_operations set state='executing',executed_at=now(),updated_at=now() where id=p_operation_id;
  insert into parent_private.receipt_authority(operation_id,job_id,lease_token,packet_hash,valid_until) values(p_operation_id,p_job_id,p_lease_token,v_operation.packet_hash,now()+interval '10 minutes');
  return jsonb_build_object('operationId',v_operation.id,'packet',v_operation.packet,'packetHash',v_operation.packet_hash,'idempotencyKey',v_operation.idempotency_key,'programId',v_operation.program_id,'need',v_operation.need,'action',v_operation.action,'permissionVersion',v_permission);
end $$;
create function parent_private.parent_finish_operation(p_operation_id uuid,p_job_id uuid,p_lease_token uuid,p_result_state text,p_evidence jsonb,p_next_run_at timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_operation public.parent_operations; v_job public.parent_jobs;
begin
  select * into v_operation from public.parent_operations where id=p_operation_id;
  perform 1 from public.parent_requests where id=v_operation.request_id for update;
  select * into v_job from public.parent_jobs where id=p_job_id for update;
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  -- Receipt authority preserves facts about one in-flight packet; it cannot dispatch new work.
  if v_operation.request_id is distinct from v_job.request_id or not exists(select 1 from parent_private.receipt_authority a
    where a.operation_id=p_operation_id and a.job_id=p_job_id and a.lease_token=p_lease_token and a.packet_hash=v_operation.packet_hash and a.valid_until>now()) then raise exception 'receipt authority unavailable; reconcile through verified channel' using errcode='42501'; end if;
  if v_operation.state not in ('executing','delivery_unknown') then
    if v_operation.state=p_result_state and v_operation.evidence=p_evidence then return; end if;
    raise exception 'a definitive operation result cannot be overwritten' using errcode='23514';
  end if;
  if p_result_state is null or p_evidence is null or p_result_state not in ('prepared','sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved','delivery_unknown','failed') or jsonb_typeof(p_evidence)<>'object' or pg_column_size(p_evidence)>12000
    or (p_result_state not in ('prepared','failed','delivery_unknown') and (length(coalesce(p_evidence->>'source',''))<1 or length(coalesce(p_evidence->>'reference',''))<1)) then raise exception 'attributed operation evidence required' using errcode='23514'; end if;
  if v_operation.action in ('research','prepare') and p_result_state not in ('prepared','failed') then raise exception 'preparation cannot establish delivery or assistance' using errcode='23514'; end if;
  update public.parent_operations set state=p_result_state,evidence=p_evidence,updated_at=now() where id=p_operation_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'operation.'||p_result_state,'caselink',case when p_result_state='delivery_unknown' then 'Delivery is uncertain. CaseLink will reconcile it before trying again.' else 'CaseLink recorded an operation result: '||replace(p_result_state,'_',' ')||'.' end,jsonb_build_object('operationId',p_operation_id,'packetHash',v_operation.packet_hash,'attribution',p_evidence));
  if p_next_run_at is not null and parent_private.current_grant(v_job.request_id,v_job.request_version) then update public.parent_jobs set run_at=greatest(p_next_run_at,now()+interval '30 seconds') where id=p_job_id; end if;
end $$;

create function parent_private.immutable_operation_packet() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.request_id,new.request_version,new.need,new.program_id,new.action,new.packet,new.packet_hash,new.data_categories,new.document_ids,new.idempotency_key,new.permission_version,new.created_at)
    is distinct from (old.request_id,old.request_version,old.need,old.program_id,old.action,old.packet,old.packet_hash,old.data_categories,old.document_ids,old.idempotency_key,old.permission_version,old.created_at) then raise exception 'attempted packet is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger parent_operation_immutable before update on public.parent_operations for each row execute function parent_private.immutable_operation_packet();

-- This lane remains available after service authority is revoked; it can only erase data.
create table parent_private.cleanup_batches (
  id uuid primary key default gen_random_uuid(),
  lease_token uuid not null default gen_random_uuid(),
  document_ids uuid[] not null,
  account_ids uuid[] not null,
  request_ids uuid[] not null,
  expires_at timestamptz not null default now()+interval '10 minutes',
  completed_at timestamptz
);
create table parent_private.retained_evidence (
  id uuid primary key default gen_random_uuid(),
  request_hash text not null,
  kind text not null,
  evidence_hash text not null,
  event_at timestamptz not null,
  expires_at timestamptz not null default now()+interval '365 days',
  unique(request_hash,kind,evidence_hash,event_at)
);
alter table parent_private.cleanup_batches enable row level security;
alter table parent_private.retained_evidence enable row level security;
revoke all on parent_private.cleanup_batches,parent_private.retained_evidence from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
create function parent_private.parent_claim_cleanup(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_docs uuid[]; v_accounts uuid[]; v_requests uuid[]; v_batch parent_private.cleanup_batches; v_request uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid cleanup batch limit' using errcode='23514'; end if;
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
  select coalesce(array_agg(id),'{}') into v_accounts from (
    select a.id from public.parent_accounts a where a.status='deletion_requested'
      and not exists(select 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id join public.parent_documents d on d.request_id=r.id where h.owner_id=a.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and a.id=any(b.account_ids))
    order by a.updated_at limit p_limit
  ) eligible;
  select coalesce(array_agg(id),'{}') into v_requests from (
    select r.id from public.parent_requests r where r.status in ('closed','cancelled') and r.updated_at<now()-interval '90 days'
      and not exists(select 1 from public.parent_documents d where d.request_id=r.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and r.id=any(b.request_ids))
    order by r.updated_at limit p_limit
  ) eligible;
  delete from parent_private.cleanup_batches where expires_at<now()-interval '1 day';
  delete from parent_private.retained_evidence where expires_at<now();
  delete from parent_private.deletion_tombstones where expires_at<now();
  if cardinality(v_docs)+cardinality(v_accounts)+cardinality(v_requests)=0 then return null; end if;
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=any(v_accounts) order by r.id for update of r loop
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'mandate',encode(sha256(convert_to(mandate::text,'UTF8')),'hex'),created_at from public.parent_requests where id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'operation.'||state,packet_hash,coalesce(executed_at,created_at) from public.parent_operations where request_id=v_request on conflict do nothing;
  end loop;
  insert into parent_private.cleanup_batches(document_ids,account_ids,request_ids) values(v_docs,v_accounts,v_requests) returning * into v_batch;
  return jsonb_build_object('batchId',v_batch.id,'leaseToken',v_batch.lease_token,
    'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'objectPath',d.object_path)),'[]') from public.parent_documents d where d.id=any(v_docs)),
    'accountIds',v_accounts,'requestIds',v_requests);
end $$;
create function parent_private.parent_finish_cleanup(p_batch_id uuid,p_lease_token uuid,p_deleted_documents uuid[],p_deleted_accounts uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_batch parent_private.cleanup_batches; v_request uuid;
begin
  select * into v_batch from parent_private.cleanup_batches where id=p_batch_id for update;
  if not found or v_batch.lease_token is distinct from p_lease_token or v_batch.expires_at<=now() or v_batch.completed_at is not null
    or p_deleted_documents is null or p_deleted_accounts is null or not p_deleted_documents<@v_batch.document_ids or not p_deleted_accounts<@v_batch.account_ids then raise exception 'cleanup lease or exact targets unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests r where r.id in(select d.request_id from public.parent_documents d where d.id=any(p_deleted_documents)) order by r.id for update;
  update public.parent_documents d set status=case when d.status='deletion_pending' or exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id where r.id=d.request_id and a.status='deletion_requested') then 'deleted' else 'raw_deleted' end,
    facts=case when d.status='deletion_pending' or exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id where r.id=d.request_id and a.status='deletion_requested') then '[]'::jsonb else d.facts end where d.id=any(p_deleted_documents);
  -- Minimize retained evidence before account cascades remove private request content.
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id
    where r.id=any(v_batch.request_ids) or h.owner_id=any(p_deleted_accounts) order by r.id for update of r loop
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'mandate',encode(sha256(convert_to(mandate::text,'UTF8')),'hex'),created_at from public.parent_requests where id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'operation.'||state,packet_hash,coalesce(executed_at,created_at) from public.parent_operations where request_id=v_request on conflict do nothing;
    delete from public.parent_requests where id=v_request;
  end loop;
  update parent_private.deletion_tombstones set completed_at=now() where subject_hash in(select encode(sha256(convert_to('parent-account:'||id::text,'UTF8')),'hex') from unnest(p_deleted_accounts) id);
  delete from public.parent_accounts where id=any(p_deleted_accounts) and status='deletion_requested';
  update parent_private.cleanup_batches set completed_at=now() where id=p_batch_id;
end $$;

revoke execute on all functions in schema parent_private from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
grant execute on function parent_private.parent_claim_cleanup(integer),parent_private.parent_finish_cleanup(uuid,uuid,uuid[],uuid[]) to parent_retention_worker;
grant execute on function parent_private.owns_request(uuid) to authenticated;
revoke execute on function public.is_parent_session(),public.parent_ensure_account(),public.parent_start_request(jsonb,jsonb,uuid),public.parent_control_request(uuid,text),public.parent_correct_request(uuid,jsonb,integer),public.parent_update_preferences(jsonb),public.parent_request_deletion(),public.parent_register_document(uuid,text,text,integer,integer,text),public.parent_delete_document(uuid,uuid),public.parent_resolve_action(uuid,text,text) from public,anon,service_role;
grant execute on function public.is_parent_session(),public.parent_ensure_account(),public.parent_start_request(jsonb,jsonb,uuid),public.parent_control_request(uuid,text),public.parent_correct_request(uuid,jsonb,integer),public.parent_update_preferences(jsonb),public.parent_request_deletion(),public.parent_register_document(uuid,text,text,integer,integer,text),public.parent_delete_document(uuid,uuid),public.parent_resolve_action(uuid,text,text) to authenticated;
grant execute on function parent_private.parent_reject_document(uuid,uuid,uuid,text),parent_private.parent_save_document_facts(uuid,uuid,uuid,jsonb,text[],integer),parent_private.parent_fail_job(uuid,uuid,text,timestamptz),parent_private.parent_reserve_ai_call(uuid,uuid),parent_private.parent_claim_job(integer),parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamptz),parent_private.parent_prepare_operation(uuid,uuid,integer,text,text,jsonb,text[],uuid[],text,text),parent_private.parent_begin_operation(uuid,uuid,uuid),parent_private.parent_finish_operation(uuid,uuid,uuid,text,jsonb,timestamptz) to parent_worker;

-- Storage is private and upload requires prior purpose-specific metadata and consent.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('parent-documents','parent-documents',false,10485760,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;
create policy parent_document_storage_read on storage.objects for select to authenticated using(bucket_id='parent-documents' and exists(select 1 from public.parent_documents d where d.object_path=name and d.status not in ('deleted','deletion_pending') and d.expires_at>now() and parent_private.owns_request(d.request_id)));
create policy parent_document_storage_insert on storage.objects for insert to authenticated with check(bucket_id='parent-documents' and exists(select 1 from public.parent_documents d join public.parent_requests r on r.id=d.request_id where d.object_path=name and d.status='uploaded' and d.expires_at>now() and r.status in ('active','paused') and coalesce((metadata->>'size')::bigint,-1)=d.size_bytes and parent_private.owns_request(d.request_id)));
-- Raw bytes are removed only by the isolated retention lane after audited invalidation.
