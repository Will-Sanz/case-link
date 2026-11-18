-- PGW requires one selected identifier per non-customer member, not a collection of competing values.
create table parent_private.utility_identifier_capture_intents (
  input_id uuid primary key references parent_private.utility_protected_authorizations(input_id) on delete cascade,
  replaces_input_id uuid references parent_private.utility_protected_authorizations(input_id) on delete cascade,
  origin_authorization_id uuid references parent_private.utility_protected_authorizations(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  check((replaces_input_id is null)=(origin_authorization_id is null)),
  check(input_id is distinct from replaces_input_id)
);
alter table parent_private.utility_identifier_capture_intents enable row level security;
revoke all on parent_private.utility_identifier_capture_intents from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
insert into parent_private.utility_identifier_capture_intents(input_id)
  select input_id from parent_private.utility_protected_authorizations where program_id='pgw-crp' and purpose='required_identifier';

create function parent_private.immutable_utility_identifier_intent() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'identifier capture intent is immutable' using errcode='23514'; end $$;
create trigger utility_identifier_intent_immutable before update on parent_private.utility_identifier_capture_intents for each row execute function parent_private.immutable_utility_identifier_intent();
create function parent_private.same_utility_identifier_target(a parent_private.utility_protected_authorizations,b parent_private.utility_protected_authorizations) returns boolean
language sql immutable set search_path='' as $$
  select a.program_id='pgw-crp' and b.program_id='pgw-crp' and a.purpose='required_identifier' and b.purpose='required_identifier'
    and a.owner_id=b.owner_id and a.request_id=b.request_id and a.request_version=b.request_version and a.snapshot_id=b.snapshot_id
    and a.snapshot_revision=b.snapshot_revision and a.snapshot_hash=b.snapshot_hash and a.targets=b.targets;
$$;

-- Reuse the existing full ownership/purpose/consent checks. The public entries add only identifier intent.
alter function public.parent_authorize_utility_protected_input(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean) set schema parent_private;
alter function parent_private.parent_authorize_utility_protected_input(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean) rename to authorize_utility_protected_input_base;
revoke execute on function parent_private.authorize_utility_protected_input_base(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

create function public.parent_authorize_utility_protected_input(p_request_id uuid,p_expected_version integer,p_program_id text,p_snapshot_id uuid,p_snapshot_revision integer,p_snapshot_hash text,
  p_input_id uuid,p_purpose text,p_targets jsonb,p_media_type text,p_byte_length integer,p_notice_version text,p_consent_accepted boolean,p_subject_authority_declared boolean,p_account_authority_declared boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; a parent_private.utility_protected_authorizations;
begin
  result:=parent_private.authorize_utility_protected_input_base(p_request_id,p_expected_version,p_program_id,p_snapshot_id,p_snapshot_revision,p_snapshot_hash,p_input_id,p_purpose,p_targets,p_media_type,p_byte_length,p_notice_version,p_consent_accepted,p_subject_authority_declared,p_account_authority_declared);
  if p_program_id='pgw-crp' and p_purpose='required_identifier' then
    select * into a from parent_private.utility_protected_authorizations where input_id=p_input_id;
    if exists(select 1 from parent_private.utility_identifier_capture_intents where input_id=p_input_id and replaces_input_id is not null)
      or exists(select 1 from parent_private.utility_protected_authorizations other join parent_private.utility_protected_inputs i on i.input_id=other.input_id and i.state='stored'
        where other.input_id<>p_input_id and parent_private.same_utility_identifier_target(a,other) and other.revoked_at is null and other.expires_at>clock_timestamp() and parent_private.utility_protected_origin_allowed(other)) then
      raise exception 'the saved identifier requires an explicit replacement' using errcode='40001'; end if;
    insert into parent_private.utility_identifier_capture_intents(input_id) values(p_input_id) on conflict(input_id) do nothing;
  end if;
  return result;
end $$;

create function public.parent_authorize_utility_identifier_replacement(p_request_id uuid,p_expected_version integer,p_program_id text,p_snapshot_id uuid,p_snapshot_revision integer,p_snapshot_hash text,
  p_input_id uuid,p_purpose text,p_targets jsonb,p_media_type text,p_byte_length integer,p_notice_version text,p_consent_accepted boolean,p_subject_authority_declared boolean,p_account_authority_declared boolean,p_replaces_input_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; a parent_private.utility_protected_authorizations; previous parent_private.utility_protected_authorizations;
  intent parent_private.utility_identifier_capture_intents; origin uuid;
begin
  if p_program_id is distinct from 'pgw-crp' or p_purpose is distinct from 'required_identifier' or p_replaces_input_id is null or p_replaces_input_id=p_input_id then
    raise exception 'identifier replacement unavailable' using errcode='42501'; end if;
  result:=parent_private.authorize_utility_protected_input_base(p_request_id,p_expected_version,p_program_id,p_snapshot_id,p_snapshot_revision,p_snapshot_hash,p_input_id,p_purpose,p_targets,p_media_type,p_byte_length,p_notice_version,p_consent_accepted,p_subject_authority_declared,p_account_authority_declared);
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input_id;
  select * into intent from parent_private.utility_identifier_capture_intents where input_id=p_input_id;
  if found then
    if intent.replaces_input_id is distinct from p_replaces_input_id then raise exception 'identifier capture intent changed' using errcode='40001'; end if;
    if exists(select 1 from parent_private.utility_protected_inputs where input_id=p_input_id and state='stored') then return result; end if;
  elsif exists(select 1 from parent_private.utility_protected_inputs where input_id=p_input_id) then
    raise exception 'identifier capture intent changed' using errcode='40001';
  end if;
  select * into previous from parent_private.utility_protected_authorizations where input_id=p_replaces_input_id;
  if not found or not parent_private.same_utility_identifier_target(a,previous) or previous.revoked_at is not null or previous.expires_at<=clock_timestamp()
    or not parent_private.utility_protected_origin_allowed(previous) or not exists(select 1 from parent_private.utility_protected_inputs where input_id=previous.input_id and state='stored') then
    raise exception 'the saved identifier changed' using errcode='40001'; end if;
  origin:=coalesce((previous.consent_evidence->>'originAuthorizationId')::uuid,previous.id);
  if exists(select 1 from parent_private.utility_protected_authorizations other join parent_private.utility_protected_inputs i on i.input_id=other.input_id and i.state='stored'
    where other.input_id<>a.input_id and parent_private.same_utility_identifier_target(a,other) and other.revoked_at is null and other.expires_at>clock_timestamp()
      and coalesce((other.consent_evidence->>'originAuthorizationId')::uuid,other.id)<>origin) then
    raise exception 'the saved identifier changed' using errcode='40001'; end if;
  insert into parent_private.utility_identifier_capture_intents(input_id,replaces_input_id,origin_authorization_id) values(p_input_id,p_replaces_input_id,origin) on conflict(input_id) do nothing;
  return result;
end $$;

create function parent_private.seal_utility_identifier_replacement() returns trigger
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_protected_authorizations; previous parent_private.utility_protected_authorizations; origin parent_private.utility_protected_authorizations;
  intent parent_private.utility_identifier_capture_intents;
begin
  if new.state<>'stored' or old.state='stored' then return new; end if;
  select * into a from parent_private.utility_protected_authorizations where input_id=new.input_id;
  if a.program_id<>'pgw-crp' or a.purpose<>'required_identifier' then return new; end if;
  -- The core seal already holds this lock; keeping the request-first order also serializes competing replacements.
  perform 1 from public.parent_requests where id=a.request_id for update;
  select * into intent from parent_private.utility_identifier_capture_intents where input_id=a.input_id;
  if not found then insert into parent_private.utility_identifier_capture_intents(input_id) values(a.input_id) returning * into intent; end if;
  if intent.replaces_input_id is null then
    if exists(select 1 from parent_private.utility_protected_authorizations other join parent_private.utility_protected_inputs i on i.input_id=other.input_id and i.state='stored'
      where other.input_id<>a.input_id and parent_private.same_utility_identifier_target(a,other) and other.revoked_at is null and other.expires_at>clock_timestamp() and parent_private.utility_protected_origin_allowed(other)) then
      raise exception 'the saved identifier requires an explicit replacement' using errcode='40001'; end if;
    return new;
  end if;
  select * into previous from parent_private.utility_protected_authorizations where input_id=intent.replaces_input_id;
  select * into origin from parent_private.utility_protected_authorizations where id=intent.origin_authorization_id;
  if previous.input_id is null or not parent_private.same_utility_identifier_target(a,previous) or previous.revoked_at is not null
    or origin.id is null or origin.revoked_at is not null or origin.owner_id<>a.owner_id or origin.request_id<>a.request_id or origin.program_id<>a.program_id
    or intent.origin_authorization_id is distinct from coalesce((previous.consent_evidence->>'originAuthorizationId')::uuid,previous.id) then
    raise exception 'the saved identifier changed' using errcode='40001'; end if;
  if exists(select 1 from parent_private.utility_protected_authorizations other join parent_private.utility_protected_inputs i on i.input_id=other.input_id and i.state='stored'
    where other.input_id<>a.input_id and parent_private.same_utility_identifier_target(a,other) and other.revoked_at is null and other.expires_at>clock_timestamp()
      and coalesce((other.consent_evidence->>'originAuthorizationId')::uuid,other.id)<>intent.origin_authorization_id) then
    raise exception 'the saved identifier changed' using errcode='40001'; end if;
  update parent_private.utility_protected_authorizations set revoked_at=clock_timestamp()
    where owner_id=a.owner_id and request_id=a.request_id and program_id=a.program_id and revoked_at is null
      and (id=intent.origin_authorization_id or consent_evidence->>'originAuthorizationId'=intent.origin_authorization_id::text);
  return new;
end $$;
create trigger utility_identifier_replacement_sealed after update on parent_private.utility_protected_inputs for each row execute function parent_private.seal_utility_identifier_replacement();

revoke execute on function parent_private.immutable_utility_identifier_intent(),parent_private.same_utility_identifier_target(parent_private.utility_protected_authorizations,parent_private.utility_protected_authorizations),parent_private.seal_utility_identifier_replacement()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
revoke execute on function public.parent_authorize_utility_protected_input(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean),
  public.parent_authorize_utility_identifier_replacement(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean,uuid)
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_authorize_utility_protected_input(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean),
  public.parent_authorize_utility_identifier_replacement(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean,uuid) to authenticated;
