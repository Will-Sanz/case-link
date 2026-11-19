-- Separate protected utility capture. These rows do not enable a provider or an ordinary document channel.
create role parent_utility_protected nologin noinherit;
grant usage on schema parent_private to parent_utility_protected;

create table parent_private.utility_protected_policies (
  program_id text primary key check(program_id in ('peco-cap','pgw-crp','pwd-tap')),
  enabled boolean not null default false,
  approval_reference text,
  approved_until timestamptz,
  policy_version text,
  retention_policy_version text,
  max_retention_seconds integer check(max_retention_seconds between 60 and 86400),
  allowed_purposes text[] not null default '{}',
  validator_versions text[] not null default '{}'
);
insert into parent_private.utility_protected_policies(program_id) values('peco-cap'),('pgw-crp'),('pwd-tap');
alter table parent_private.utility_protected_policies enable row level security;

create table parent_private.utility_protected_authorizations (
  id uuid primary key default gen_random_uuid(),
  input_id uuid not null unique,
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  request_version integer not null check(request_version>0),
  program_id text not null references parent_private.utility_protected_policies(program_id),
  snapshot_id uuid not null,
  snapshot_revision integer not null check(snapshot_revision>0),
  snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
  purpose text not null check(purpose in ('income_proof','residency_proof','required_identifier','account_access','application_recovery')),
  targets jsonb not null check(jsonb_typeof(targets)='array' and jsonb_array_length(targets) between 1 and 120),
  media_type text not null check(media_type in ('application/pdf','image/jpeg','image/png','application/octet-stream')),
  byte_length integer not null check(byte_length between 1 and 10485760),
  notice_version text not null check(notice_version='utility-protected-input-2026-11-13.v1'),
  policy_version text not null,
  retention_policy_version text not null,
  consent_evidence jsonb not null,
  consented_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>consented_at),
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index utility_protected_request on parent_private.utility_protected_authorizations(request_id,created_at);
alter table parent_private.utility_protected_authorizations enable row level security;

create table parent_private.utility_protected_validations (
  id uuid primary key default gen_random_uuid(),
  input_id uuid not null references parent_private.utility_protected_authorizations(input_id) on delete cascade,
  validator_version text not null check(validator_version~'^[a-z0-9][a-z0-9._-]{0,79}$'),
  projection jsonb not null check(jsonb_typeof(projection)='object' and octet_length(projection::text)<=32768),
  validated_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>validated_at),
  unique(input_id,validator_version)
);
alter table parent_private.utility_protected_validations enable row level security;

create function parent_private.guard_utility_protected_authorization() returns trigger
language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at') or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'protected authorization is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger utility_protected_authorization_immutable before update on parent_private.utility_protected_authorizations for each row execute function parent_private.guard_utility_protected_authorization();
create function parent_private.guard_utility_protected_validation() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'protected validation is immutable' using errcode='23514'; end $$;
create trigger utility_protected_validation_immutable before update on parent_private.utility_protected_validations for each row execute function parent_private.guard_utility_protected_validation();

create table parent_private.utility_protected_inputs (
  input_id uuid primary key references parent_private.utility_protected_authorizations(input_id) on delete cascade,
  vault_secret_id uuid not null unique,
  content_digest text check(content_digest~'^[a-f0-9]{64}$'),
  aad bytea,
  iv bytea,
  tag bytea,
  ciphertext bytea,
  state text not null default 'pending' check(state in ('pending','stored')),
  created_xid xid8 not null default pg_current_xact_id(),
  check((state='pending' and content_digest is null and aad is null and iv is null and tag is null and ciphertext is null)
    or (state='stored' and content_digest is not null and aad is not null and octet_length(iv)=12 and octet_length(tag)=16 and ciphertext is not null))
);
alter table parent_private.utility_protected_inputs enable row level security;
create table parent_private.utility_protected_account_keys (
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  program_id text not null check(program_id='pwd-tap'),
  id uuid not null unique default gen_random_uuid(),
  vault_secret_id uuid not null unique,
  expires_at timestamptz not null,
  primary key(owner_id,program_id)
);
create table parent_private.utility_protected_accounts (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  program_id text not null check(program_id='pwd-tap'),key_id uuid not null,fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
  expires_at timestamptz not null, unique(owner_id,program_id,key_id,fingerprint)
);
create table parent_private.utility_protected_account_bindings (
  input_id uuid primary key references parent_private.utility_protected_authorizations(input_id) on delete cascade,
  account_reference uuid not null references parent_private.utility_protected_accounts(id) on delete cascade
);
create index utility_protected_account_key_expiry on parent_private.utility_protected_account_keys(expires_at);
create index utility_protected_account_expiry on parent_private.utility_protected_accounts(expires_at);
alter table parent_private.utility_protected_authorizations add column account_reference uuid;
alter table parent_private.utility_protected_account_keys enable row level security;
alter table parent_private.utility_protected_accounts enable row level security;
alter table parent_private.utility_protected_account_bindings enable row level security;
revoke all on parent_private.utility_protected_policies,parent_private.utility_protected_authorizations,parent_private.utility_protected_inputs,parent_private.utility_protected_validations,
  parent_private.utility_protected_account_keys,parent_private.utility_protected_accounts,parent_private.utility_protected_account_bindings
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

create function parent_private.utility_protected_account_key_for_capture(p_owner uuid,p_expiry timestamptz) returns parent_private.utility_protected_account_keys
language plpgsql security definer set search_path='' as $$
declare k parent_private.utility_protected_account_keys; new_secret uuid;
begin
  new_secret:=vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'));
  insert into parent_private.utility_protected_account_keys(owner_id,program_id,vault_secret_id,expires_at) values(p_owner,'pwd-tap',new_secret,p_expiry)
    on conflict(owner_id,program_id) do nothing returning * into k;
  if not found then
    delete from vault.secrets where id=new_secret;
    select * into k from parent_private.utility_protected_account_keys where owner_id=p_owner and program_id='pwd-tap' for update;
  end if;
  if k.expires_at<=clock_timestamp() then
    delete from vault.secrets where id=k.vault_secret_id;
    update parent_private.utility_protected_account_keys set id=gen_random_uuid(),vault_secret_id=vault.create_secret(encode(extensions.gen_random_bytes(32),'base64')),expires_at=p_expiry
      where owner_id=p_owner and program_id='pwd-tap' returning * into k;
  end if;
  return k;
end $$;

-- Fixed programme cases only; absent programme migrations remain unavailable.
create function parent_private.utility_protected_context(p_request uuid,p_version integer,p_program text,p_snapshot uuid,p_revision integer,p_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.parent_requests; s jsonb; c jsonb; owner_id uuid; table_name text; gate_name text; prefix text; need text; gate boolean;
begin
  if p_program is null or p_program not in ('peco-cap','pgw-crp','pwd-tap') then raise exception 'utility protected scope unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request for update;
  select h.owner_id into owner_id from public.parent_households h where h.id=r.household_id;
  if not found or r.version is distinct from p_version or r.status not in ('active','paused') or r.mandate_revoked_at is not null
    or not parent_private.processing_enabled() or (r.mandate->>'expiresAt')::timestamptz<=clock_timestamp()
    or not parent_private.utility_preparation_scope_allowed(r.mandate,p_program)
    or not coalesce(r.intake->>'accountAuthority' in ('self','authorized_caregiver'),false)
    or not exists(select 1 from public.parent_accounts a join auth.users u on u.id=a.id where a.id=owner_id and a.status='active'
      and (u.banned_until is null or u.banned_until<clock_timestamp()) and parent_private.existing_account_available(a.id)
      and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')))
    then raise exception 'utility protected scope unavailable' using errcode='42501'; end if;
  if p_program='peco-cap' then table_name:='parent_peco_application_details'; gate_name:='peco_details_collection_enabled'; prefix:='peco'; need:='electricity';
  elsif p_program='pgw-crp' then table_name:='parent_pgw_application_details'; gate_name:='pgw_details_collection_enabled'; prefix:='pgw'; need:='gas';
  else table_name:='parent_water_application_details'; gate_name:='water_details_collection_enabled'; prefix:='water'; need:='water'; end if;
  if r.intake->'needs' is distinct from to_jsonb(array[need]) or r.intake->'utilityProviders' is distinct from to_jsonb(array[prefix]) then
    -- Water's established ordinary provider key is pwd.
    if not(p_program='pwd-tap' and r.intake->'needs'='["water"]'::jsonb and r.intake->'utilityProviders'='["pwd"]'::jsonb) then
      raise exception 'utility protected scope unavailable' using errcode='42501';
    end if;
  end if;
  execute format('select parent_private.%I()',gate_name) into gate;
  if gate is distinct from true then raise exception 'utility protected scope unavailable' using errcode='42501'; end if;
  select to_jsonb(x) into c from parent_private.processing_controls x where singleton;
  if (c->>'approved_until')::timestamptz<=clock_timestamp() or (c->>(prefix||'_details_approved_until'))::timestamptz<=clock_timestamp() then
    raise exception 'utility protected scope unavailable' using errcode='42501';
  end if;
  execute format('select to_jsonb(s) from public.%I s where request_id=$1 order by revision desc limit 1',table_name) into s using p_request;
  if s is null or (s->>'id')::uuid is distinct from p_snapshot or (s->>'revision')::integer is distinct from p_revision
    or (s->>'request_version')::integer>p_version or encode(sha256(convert_to((s->'details')::text,'UTF8')),'hex') is distinct from p_hash
    or s#>>'{consent_evidence,detailsSha256}' is distinct from p_hash
    or s#>'{consent_evidence,subjectAuthorityDeclared}' is distinct from 'true'::jsonb or s#>'{consent_evidence,accountAuthorityDeclared}' is distinct from 'true'::jsonb
    or s#>>'{consent_evidence,actorId}' is distinct from owner_id::text or s#>>'{consent_evidence,noticeVersion}' is distinct from s->>'notice_version'
    or coalesce(case when p_program='pwd-tap' then s#>>'{source,sampleSha256}' else s#>>'{source,sourceSha256}' end,'')!~'^[a-f0-9]{64}$'
    or coalesce((s#>>'{source,verifiedUntil}')::timestamptz<=clock_timestamp(),true) then
    raise exception 'utility protected source unavailable' using errcode='42501';
  end if;
  if (p_program='peco-cap' and coalesce(s#>>'{details,accountNumber}','')!~'^[0-9]{10}$')
    or (p_program='pgw-crp' and length(btrim(coalesce(s#>>'{details,accountNumber}','')))=0) then
    raise exception 'utility protected account context unavailable' using errcode='42501'; end if;
  return jsonb_build_object('ownerId',owner_id,'householdId',r.household_id,'accountAuthority',r.intake->'accountAuthority','grantExpiresAt',r.mandate->'expiresAt',
    'requestId',r.id,'requestVersion',r.version,'programId',p_program,'need',need,
    'mandate',r.mandate,'snapshot',s,'sourceExpiresAt',s#>'{source,verifiedUntil}',
    'approvalExpiresAt',least((c->>'approved_until')::timestamptz,(c->>(prefix||'_details_approved_until'))::timestamptz));
exception when undefined_table or undefined_function then raise exception 'utility protected programme unavailable' using errcode='42501';
end $$;

create function parent_private.utility_protected_targets(p_context jsonb,p_purpose text,p_targets jsonb,p_media text,p_size integer) returns void
language plpgsql set search_path='' as $$
declare t jsonb; person jsonb; details jsonb:=p_context#>'{snapshot,details}'; program text:=p_context->>'programId'; field text; scalar boolean;
begin
  if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) not between 1 and 120
    or (select count(*) from jsonb_array_elements(p_targets))<>(select count(distinct x) from jsonb_array_elements(p_targets) x) then
    raise exception 'invalid protected targets' using errcode='23514'; end if;
  field:=case p_purpose when 'income_proof' then 'income' when 'residency_proof' then 'residency' when 'required_identifier' then 'pgw_household_identifier'
    when 'account_access' then 'water_access_code' when 'application_recovery' then 'water_application_recovery' end;
  scalar:=p_purpose in ('required_identifier','account_access','application_recovery');
  if field is null or (program='peco-cap' and p_purpose<>'income_proof') or (program='pgw-crp' and p_purpose not in ('income_proof','required_identifier'))
    or (p_purpose='required_identifier' and program<>'pgw-crp') or (p_purpose in ('account_access','application_recovery','residency_proof') and program<>'pwd-tap')
    or (not scalar and not(p_context#>'{mandate,allowedData}' ? 'documents'))
    or p_media is null or p_size is null or p_size not between 1 and 10485760
    or (scalar and (p_media<>'application/octet-stream' or p_size>1024 or jsonb_array_length(p_targets)<>1))
    or (not scalar and (p_media not in ('application/pdf','image/jpeg','image/png') or p_size<12)) then
    raise exception 'utility protected purpose unavailable' using errcode='42501'; end if;
  for t in select x from jsonb_array_elements(p_targets) x loop
    if jsonb_typeof(t) is distinct from 'object' or (select count(*) from jsonb_object_keys(t))<>3
      or not(t ?& array['subjectId','sourceId','field']) or t->>'field' is distinct from field
      or coalesce(t->>'subjectId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      or (t->'sourceId'<>'null'::jsonb and coalesce(t->>'sourceId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') then
      raise exception 'invalid protected targets' using errcode='23514'; end if;
    person:=null;
    if program='pgw-crp' and p_purpose='required_identifier' then
      select x into person from jsonb_array_elements(coalesce(details->'householdMembers','[]')) x where x->>'id'=t->>'subjectId';
    elsif p_purpose in ('account_access','application_recovery','residency_proof') then
      if details#>>'{applicant,id}'=t->>'subjectId' then person:=details->'applicant'; end if;
    else
      if details#>>'{applicant,id}'=t->>'subjectId' then person:=details->'applicant'; end if;
      if program='pgw-crp' and details#>>'{customer,id}'=t->>'subjectId' then person:=details->'customer'; end if;
      if person is null then select x into person from jsonb_array_elements(coalesce(details->'householdMembers','[]')) x where x->>'id'=t->>'subjectId'; end if;
    end if;
    if person is null or (field<>'income' and t->'sourceId'<>'null'::jsonb) then raise exception 'protected subject unavailable' using errcode='42501'; end if;
    if p_purpose='application_recovery' and not coalesce(details->>'existingApplication' in ('saved','submitted') or details->>'journey'='pending',false) then
      raise exception 'protected existing application unavailable' using errcode='42501'; end if;
    if field in ('income','pgw_household_identifier') and ((program='pwd-tap' and length(btrim(coalesce(person->>'name','')))=0)
      or (program<>'pwd-tap' and (length(btrim(coalesce(person->>'firstName','')))=0 or length(btrim(coalesce(person->>'lastName','')))=0))) then
      raise exception 'protected named subject unavailable' using errcode='42501'; end if;
    if field='income' and (t->'sourceId'='null'::jsonb or not exists(select 1 from jsonb_array_elements(coalesce(person#>'{income,sources}','[]')) x where x->>'id'=t->>'sourceId')) then
      raise exception 'protected income source unavailable' using errcode='42501'; end if;
  end loop;
end $$;

create function parent_private.utility_protected_workspace_target(p_context jsonb,p_purpose text,p_target jsonb,p_name text,p_source text) returns jsonb
language plpgsql set search_path='' as $$
declare available boolean:=true; reason text; scalar boolean:=p_purpose in ('required_identifier','account_access','application_recovery');
begin
  begin perform parent_private.utility_protected_targets(p_context,p_purpose,jsonb_build_array(p_target),case when scalar then 'application/octet-stream' else 'application/pdf' end,case when scalar then 100 else 1024 end);
  exception when insufficient_privilege or check_violation then available:=false; reason:='Complete the exact required request details before this protected field.'; end;
  if p_context->>'programId'='pwd-tap' and p_purpose in ('income_proof','residency_proof') and not exists(
    select 1 from parent_private.utility_protected_authorizations a join parent_private.utility_protected_account_bindings b on b.input_id=a.input_id
    join parent_private.utility_protected_accounts c on c.id=b.account_reference where a.request_id=(p_context->>'requestId')::uuid and a.request_version=(p_context->>'requestVersion')::integer
      and a.snapshot_id=(p_context#>>'{snapshot,id}')::uuid and a.purpose='account_access' and a.revoked_at is null and a.expires_at>clock_timestamp() and c.expires_at>clock_timestamp()) then
    available:=false; reason:='Provide the water access code and ZIP for this exact request before attaching its proofs.'; end if;
  return jsonb_build_object('purpose',p_purpose,'target',p_target,'displayName',p_name,'sourceLabel',p_source,'available',available,'reason',reason,
    'mediaTypes',case when scalar then array['application/octet-stream'] else array['application/pdf','image/jpeg','image/png'] end,'maxBytes',case when scalar then 1024 else 10485760 end);
end $$;

create function public.parent_get_utility_protected_workspace(p_request_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.parent_requests; s jsonb; context jsonb; policy parent_private.utility_protected_policies; program text; label text; table_name text; result jsonb; refs jsonb; targets jsonb:='[]';
  person jsonb; source jsonb; display text; purpose text; target jsonb; people jsonb; index integer:=0;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected workspace unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request_id for update;
  select coalesce(jsonb_agg(parent_private.utility_protected_reference(a) order by a.created_at,a.input_id),'[]') into refs from parent_private.utility_protected_authorizations a where a.request_id=p_request_id and a.owner_id=auth.uid();
  program:=case when r.mandate->'recipientIds'='["peco-cap"]'::jsonb then 'peco-cap' when r.mandate->'recipientIds'='["pgw-crp"]'::jsonb then 'pgw-crp' when r.mandate->'recipientIds'='["pwd-tap"]'::jsonb then 'pwd-tap' end;
  label:=case program when 'peco-cap' then 'PECO CAP' when 'pgw-crp' then 'PGW CRP' when 'pwd-tap' then 'Philadelphia water assistance' end;
  result:=jsonb_build_object('requestVersion',r.version,'collectionEnabled',false,'scope',null,'programId',program,'programLabel',label,'noticeVersion',null,'expiresAt',null,'retentionSeconds',null,'targets','[]'::jsonb,'references',refs);
  select * into policy from parent_private.utility_protected_policies where program_id=program;
  if r.version is distinct from p_expected_version or not found or not policy.enabled or coalesce(policy.approved_until<=clock_timestamp(),true) or length(btrim(coalesce(policy.approval_reference,'')))=0
    or policy.policy_version is null or policy.retention_policy_version is null or policy.max_retention_seconds is null then return result; end if;
  table_name:=case program when 'peco-cap' then 'parent_peco_application_details' when 'pgw-crp' then 'parent_pgw_application_details' when 'pwd-tap' then 'parent_water_application_details' end;
  begin
    execute format('select to_jsonb(s) from public.%I s where request_id=$1 order by revision desc limit 1',table_name) into s using p_request_id;
    if s is null then return result; end if;
    context:=parent_private.utility_protected_context(p_request_id,p_expected_version,program,(s->>'id')::uuid,(s->>'revision')::integer,s#>>'{consent_evidence,detailsSha256}');
  exception when insufficient_privilege or undefined_table or undefined_function then return result; end;
  people:=coalesce(case when program='pgw-crp' then jsonb_build_array(s#>'{details,customer}') else jsonb_build_array(s#>'{details,applicant}') end,'[]')||coalesce(s#>'{details,householdMembers}','[]');
  for person in select x from jsonb_array_elements(people) x where jsonb_typeof(x)='object' loop
    index:=index+1; display:=coalesce(nullif(btrim(person->>'name'),''),nullif(btrim(concat_ws(' ',person->>'firstName',person->>'lastName')),''),'Household member '||index);
    if 'income_proof'=any(policy.allowed_purposes) then
      for source in select x from jsonb_array_elements(coalesce(person#>'{income,sources}','[]')) x loop
        target:=jsonb_build_object('subjectId',person->>'id','sourceId',source->>'id','field','income');
        targets:=targets||jsonb_build_array(parent_private.utility_protected_workspace_target(context,'income_proof',target,display,replace(source->>'kind','_',' ')));
      end loop;
    end if;
    if program='pgw-crp' and 'required_identifier'=any(policy.allowed_purposes) and person->>'id' is distinct from s#>>'{details,customer,id}' then
      target:=jsonb_build_object('subjectId',person->>'id','sourceId',null,'field','pgw_household_identifier');
      targets:=targets||jsonb_build_array(parent_private.utility_protected_workspace_target(context,'required_identifier',target,display,null));
    end if;
    if program='pwd-tap' and person->>'id'=s#>>'{details,applicant,id}' then
      foreach purpose in array array['account_access','application_recovery','residency_proof'] loop
        if purpose=any(policy.allowed_purposes) then
          target:=jsonb_build_object('subjectId',person->>'id','sourceId',null,'field',case purpose when 'account_access' then 'water_access_code' when 'application_recovery' then 'water_application_recovery' else 'residency' end);
          targets:=targets||jsonb_build_array(parent_private.utility_protected_workspace_target(context,purpose,target,display,null));
        end if;
      end loop;
    end if;
  end loop;
  return result||jsonb_build_object('collectionEnabled',true,'scope',jsonb_build_object('requestId',p_request_id,'expectedVersion',p_expected_version,'programId',program,'snapshotId',s->'id','snapshotRevision',s->'revision','snapshotHash',s#>'{consent_evidence,detailsSha256}'),
    'noticeVersion','utility-protected-input-2026-11-13.v1','expiresAt',least(policy.approved_until,(context->>'sourceExpiresAt')::timestamptz,(context->>'approvalExpiresAt')::timestamptz,(r.mandate->>'expiresAt')::timestamptz),'retentionSeconds',policy.max_retention_seconds,'targets',targets);
end $$;

create function parent_private.utility_protected_snapshot_current(a parent_private.utility_protected_authorizations) returns boolean
language plpgsql stable set search_path='' as $$
declare table_name text; latest uuid;
begin
  table_name:=case a.program_id when 'peco-cap' then 'parent_peco_application_details' when 'pgw-crp' then 'parent_pgw_application_details' else 'parent_water_application_details' end;
  execute format('select id from public.%I where request_id=$1 order by revision desc limit 1',table_name) into latest using a.request_id;
  return latest is not distinct from a.snapshot_id;
exception when undefined_table then return false;
end $$;
create function parent_private.utility_protected_reference(a parent_private.utility_protected_authorizations) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('inputId',a.input_id,'authorizationId',a.id,'ownerId',a.owner_id,'requestId',a.request_id,'requestVersion',a.request_version,
    'programId',a.program_id,'snapshotId',a.snapshot_id,'snapshotRevision',a.snapshot_revision,'snapshotHash',a.snapshot_hash,'purpose',a.purpose,'targets',a.targets,
    'state',case when a.revoked_at is not null then 'revoked' when a.expires_at<=clock_timestamp() then 'expired'
      when not exists(select 1 from public.parent_requests r where r.id=a.request_id and r.version=a.request_version) or not parent_private.utility_protected_snapshot_current(a) then 'superseded'
      when exists(select 1 from parent_private.utility_protected_inputs i where i.input_id=a.input_id and i.state='stored') then 'stored' else 'authorized' end,
    'consentedAt',to_char(a.consented_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(a.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'accountReference',coalesce(a.account_reference,(select b.account_reference from parent_private.utility_protected_account_bindings b join parent_private.utility_protected_accounts c on c.id=b.account_reference where b.input_id=a.input_id and c.expires_at>clock_timestamp())),'validation',
    (select jsonb_build_object('id',v.id,'validatorVersion',v.validator_version,
      'validatedAt',to_char(v.validated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt',to_char(v.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      from parent_private.utility_protected_validations v where v.input_id=a.input_id and v.expires_at>clock_timestamp() order by v.validated_at desc limit 1));
$$;

create function public.parent_authorize_utility_protected_input(p_request_id uuid,p_expected_version integer,p_program_id text,p_snapshot_id uuid,p_snapshot_revision integer,p_snapshot_hash text,
  p_input_id uuid,p_purpose text,p_targets jsonb,p_media_type text,p_byte_length integer,p_notice_version text,p_consent_accepted boolean,p_subject_authority_declared boolean,p_account_authority_declared boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; policy parent_private.utility_protected_policies; existing parent_private.utility_protected_authorizations; consent_time timestamptz; capture_expiry timestamptz; account_ref uuid; account_expiry timestamptz; account_key parent_private.utility_protected_account_keys;
begin
  if not parent_private.owns_request(p_request_id) or p_consent_accepted is distinct from true or p_subject_authority_declared is distinct from true
    or p_account_authority_declared is distinct from true or p_notice_version is distinct from 'utility-protected-input-2026-11-13.v1' or p_input_id is null then
    raise exception 'utility protected consent unavailable' using errcode='42501'; end if;
  context:=parent_private.utility_protected_context(p_request_id,p_expected_version,p_program_id,p_snapshot_id,p_snapshot_revision,p_snapshot_hash);
  select * into policy from parent_private.utility_protected_policies where program_id=p_program_id;
  if not found or not policy.enabled or length(btrim(coalesce(policy.approval_reference,'')))=0 or coalesce(policy.approved_until<=clock_timestamp(),true)
    or policy.policy_version is null or policy.retention_policy_version is null or policy.max_retention_seconds is null
    or not(p_purpose=any(policy.allowed_purposes)) then raise exception 'utility protected collection unavailable' using errcode='42501'; end if;
  perform parent_private.utility_protected_targets(context,p_purpose,p_targets,p_media_type,p_byte_length);
  if p_program_id='pwd-tap' and p_purpose in ('income_proof','residency_proof') then
    select min(b.account_reference::text)::uuid,min(c.expires_at) into account_ref,account_expiry
      from parent_private.utility_protected_account_bindings b join parent_private.utility_protected_accounts c on c.id=b.account_reference
      join parent_private.utility_protected_authorizations a on a.input_id=b.input_id
      where a.request_id=p_request_id and a.request_version=p_expected_version and a.snapshot_id=p_snapshot_id and a.snapshot_hash=p_snapshot_hash
        and a.purpose='account_access' and a.revoked_at is null and a.expires_at>clock_timestamp() and c.expires_at>clock_timestamp()
      having count(distinct b.account_reference)=1;
    if account_ref is null then raise exception 'protected account context required before proof capture' using errcode='42501'; end if;
  end if;
  select * into existing from parent_private.utility_protected_authorizations where input_id=p_input_id;
  if found then
    if (existing.owner_id,existing.request_id,existing.request_version,existing.program_id,existing.snapshot_id,existing.snapshot_revision,existing.snapshot_hash,
      existing.purpose,existing.targets,existing.media_type,existing.byte_length,existing.notice_version)
      is distinct from (auth.uid(),p_request_id,p_expected_version,p_program_id,p_snapshot_id,p_snapshot_revision,p_snapshot_hash,p_purpose,p_targets,p_media_type,p_byte_length,p_notice_version)
      or existing.revoked_at is not null or existing.expires_at<=clock_timestamp() then raise exception 'protected input changed' using errcode='40001'; end if;
    return parent_private.utility_protected_reference(existing);
  end if;
  if (select count(*) from parent_private.utility_protected_authorizations where request_id=p_request_id and revoked_at is null and expires_at>clock_timestamp())>=256 then
    raise exception 'protected input resource limit' using errcode='23514'; end if;
  consent_time:=date_trunc('milliseconds',clock_timestamp());
  capture_expiry:=date_trunc('milliseconds',least(policy.approved_until,consent_time+make_interval(secs=>policy.max_retention_seconds),(context#>>'{mandate,expiresAt}')::timestamptz,
    (context->>'sourceExpiresAt')::timestamptz,(context->>'approvalExpiresAt')::timestamptz,account_expiry));
  if p_program_id='pwd-tap' and p_purpose='account_access' then
    account_key:=parent_private.utility_protected_account_key_for_capture(auth.uid(),capture_expiry);
    capture_expiry:=least(capture_expiry,account_key.expires_at);
  end if;
  insert into parent_private.utility_protected_authorizations(input_id,owner_id,request_id,request_version,program_id,snapshot_id,snapshot_revision,snapshot_hash,purpose,targets,
    media_type,byte_length,notice_version,policy_version,retention_policy_version,consent_evidence,consented_at,expires_at,account_reference)
  values(p_input_id,auth.uid(),p_request_id,p_expected_version,p_program_id,p_snapshot_id,p_snapshot_revision,p_snapshot_hash,p_purpose,p_targets,p_media_type,p_byte_length,p_notice_version,
    policy.policy_version,policy.retention_policy_version,jsonb_build_object('actorId',auth.uid(),'noticeVersion',p_notice_version,'consentAccepted',true,
      'subjectAuthorityDeclared',true,'accountAuthorityDeclared',true,'targets',p_targets,'authorizationSessionId',auth.jwt()->>'session_id'),consent_time,
    capture_expiry,account_ref) returning * into existing;
  return parent_private.utility_protected_reference(existing);
end $$;

create function public.parent_get_utility_protected_inputs(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'utility protected history unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(parent_private.utility_protected_reference(a) order by a.created_at,a.input_id),'[]')
    from parent_private.utility_protected_authorizations a where a.request_id=p_request_id and a.owner_id=auth.uid());
end $$;
-- Owner export contains consent/lifecycle references, never raw values, keys or private projections.
create function public.parent_export_utility_protected_inputs() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_parent_session() then raise exception 'protected export unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(parent_private.utility_protected_reference(a) order by a.created_at,a.input_id),'[]')
    from parent_private.utility_protected_authorizations a join public.parent_requests r on r.id=a.request_id
    join public.parent_households h on h.id=r.household_id where a.owner_id=auth.uid() and h.owner_id=auth.uid());
end $$;
create function public.parent_revoke_utility_protected_input(p_request_id uuid,p_input_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare origin uuid; version integer;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'utility protected history unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  select coalesce((consent_evidence->>'originAuthorizationId')::uuid,id) into origin from parent_private.utility_protected_authorizations where request_id=p_request_id and input_id=p_input_id and owner_id=auth.uid();
  if not found then
    raise exception 'utility protected history unavailable' using errcode='42501'; end if;
  update parent_private.utility_protected_authorizations set revoked_at=clock_timestamp() where request_id=p_request_id and owner_id=auth.uid()
    and (id=origin or consent_evidence->>'originAuthorizationId'=origin::text) and revoked_at is null;
  if found then perform parent_private.requeue_parent_change(p_request_id,'You removed protected utility information. Queued uses have stopped.'); end if;
  select r.version into version from public.parent_requests r where r.id=p_request_id;
  return version;
end $$;

create function parent_private.utility_protected_origin_allowed(a parent_private.utility_protected_authorizations) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from parent_private.utility_protected_authorizations origin where origin.id=coalesce((a.consent_evidence->>'originAuthorizationId')::uuid,a.id)
    and origin.request_id=a.request_id and origin.owner_id=a.owner_id and origin.program_id=a.program_id and origin.revoked_at is null
    and origin.expires_at>=a.expires_at and origin.consented_at=a.consented_at and origin.expires_at>clock_timestamp());
$$;
create function parent_private.utility_protected_capture_session(a parent_private.utility_protected_authorizations) returns boolean
language sql stable set search_path='' as $$
  -- A server-validated rebind continues already captured information under the durable mandate, without retaining a browser credential.
  select a.consent_evidence ? 'reboundFrom' or exists(select 1 from auth.sessions s where s.id=(a.consent_evidence->>'authorizationSessionId')::uuid
    and s.user_id=a.owner_id and (s.not_after is null or s.not_after>clock_timestamp()));
$$;

create function parent_private.utility_protected_authority(p_input uuid,p_processing boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a parent_private.utility_protected_authorizations; p parent_private.utility_protected_policies; context jsonb;
begin
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  if not found then raise exception 'protected input unavailable' using errcode='42501'; end if;
  context:=parent_private.utility_protected_context(a.request_id,a.request_version,a.program_id,a.snapshot_id,a.snapshot_revision,a.snapshot_hash);
  select * into p from parent_private.utility_protected_policies where program_id=a.program_id;
  if a.revoked_at is not null or a.consented_at>clock_timestamp() or a.expires_at<=clock_timestamp() or not parent_private.utility_protected_origin_allowed(a) or not p.enabled or coalesce(p.approved_until<=clock_timestamp(),true)
    or length(btrim(coalesce(p.approval_reference,'')))=0 or p.policy_version is distinct from a.policy_version
    or p.retention_policy_version is distinct from a.retention_policy_version or not(a.purpose=any(p.allowed_purposes))
    or context->>'ownerId' is distinct from a.owner_id::text or (p_processing and not parent_private.current_grant(a.request_id,a.request_version)) then
    raise exception 'protected input authority changed' using errcode='42501'; end if;
  perform parent_private.utility_protected_targets(context,a.purpose,a.targets,a.media_type,a.byte_length);
  return context||jsonb_build_object('reference',parent_private.utility_protected_reference(a),'policyVersion',a.policy_version,'retentionPolicyVersion',a.retention_policy_version,
    'mediaType',a.media_type,'byteLength',a.byte_length);
end $$;

create function parent_private.utility_protected_binding(a parent_private.utility_protected_authorizations,p_digest text) returns jsonb
language sql stable set search_path='' as $$
  select parent_private.utility_protected_reference(a)-'state'-'validation'-'accountReference'||jsonb_build_object('format','caselink-utility-protected-input-v1',
    'need',case a.program_id when 'peco-cap' then 'electricity' when 'pgw-crp' then 'gas' else 'water' end,
    'policyVersion',a.policy_version,'retentionPolicyVersion',a.retention_policy_version,'mediaType',a.media_type,'byteLength',a.byte_length,'contentDigest',p_digest,'accountReference',a.account_reference);
$$;
create function parent_private.utility_protected_aad(b jsonb) returns bytea
language sql immutable set search_path='' as $$
  select convert_to(array_to_json(array[b->>'format',b->>'inputId',b->>'authorizationId',b->>'ownerId',b->>'requestId',b->>'requestVersion',b->>'programId',b->>'need',
    b->>'snapshotId',b->>'snapshotRevision',b->>'snapshotHash',b->>'purpose',
    (select string_agg((x->>'subjectId')||':'||coalesce(x->>'sourceId','-')||':'||(x->>'field'),',' order by (x->>'subjectId')||':'||coalesce(x->>'sourceId','-')||':'||(x->>'field')) from jsonb_array_elements(b->'targets') x),
    b->>'policyVersion',b->>'retentionPolicyVersion',b->>'mediaType',b->>'byteLength',b->>'contentDigest',b->>'consentedAt',b->>'expiresAt',coalesce(b->>'accountReference','-')])::text,'UTF8');
$$;

create function parent_private.parent_get_utility_protected_context(p_request uuid,p_version integer,p_program text,p_snapshot uuid,p_revision integer,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; policy parent_private.utility_protected_policies;
begin
  select * into policy from parent_private.utility_protected_policies where program_id=p_program;
  if not found or not policy.enabled or coalesce(policy.approved_until<=clock_timestamp(),true) or length(btrim(coalesce(policy.approval_reference,'')))=0
    or policy.policy_version is null or policy.retention_policy_version is null or policy.max_retention_seconds is null then
    raise exception 'utility protected preparation unavailable' using errcode='42501'; end if;
  result:=parent_private.utility_protected_context(p_request,p_version,p_program,p_snapshot,p_revision,p_hash);
  if not parent_private.current_grant(p_request,p_version) then raise exception 'utility work paused' using errcode='42501'; end if;
  return result;
end $$;

create function parent_private.parent_check_utility_protected_input(p_input uuid,p_processing boolean default true) returns jsonb
language sql volatile security definer set search_path='' as $$ select parent_private.utility_protected_authority(p_input,p_processing); $$;

create function parent_private.parent_list_utility_protected_inputs(p_request uuid,p_version integer,p_program text,p_snapshot uuid,p_revision integer,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; checked jsonb; a parent_private.utility_protected_authorizations; result jsonb:='[]'; policy parent_private.utility_protected_policies;
begin
  context:=parent_private.parent_get_utility_protected_context(p_request,p_version,p_program,p_snapshot,p_revision,p_hash);
  select * into policy from parent_private.utility_protected_policies where program_id=p_program;
  for a in select auth.* from parent_private.utility_protected_authorizations auth join parent_private.utility_protected_inputs i on i.input_id=auth.input_id
    where auth.request_id=p_request and auth.request_version=p_version and auth.program_id=p_program and auth.snapshot_id=p_snapshot and auth.snapshot_revision=p_revision and auth.snapshot_hash=p_hash and i.state='stored'
    order by auth.created_at,auth.input_id loop
    begin checked:=parent_private.utility_protected_authority(a.input_id,true)->'reference';
    exception when insufficient_privilege then continue; end;
    if not coalesce(checked#>>'{validation,validatorVersion}'=any(policy.validator_versions),false) then checked:=checked||jsonb_build_object('validation',null); end if;
    result:=result||jsonb_build_array(checked);
  end loop;
  return result;
end $$;

create function public.parent_check_utility_protected_input(p_request_id uuid,p_input_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from parent_private.utility_protected_authorizations where input_id=p_input_id and request_id=p_request_id and owner_id=auth.uid()) then
    raise exception 'protected input unavailable' using errcode='42501'; end if;
  context:=parent_private.utility_protected_authority(p_input_id,false);
  return (context->'reference')||jsonb_build_object('mediaType',context->'mediaType','byteLength',context->'byteLength');
end $$;

-- A trusted isolated validator supplies a narrow source-field projection. This never accepts a public validated flag.
create function parent_private.parent_record_utility_protected_validation(p_input uuid,p_validator text,p_projection jsonb,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; a parent_private.utility_protected_authorizations; policy parent_private.utility_protected_policies; existing parent_private.utility_protected_validations; expires timestamptz;
begin
  context:=parent_private.utility_protected_authority(p_input,true);
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  select * into policy from parent_private.utility_protected_policies where program_id=a.program_id;
  if a.purpose<>'income_proof' or p_validator is null or not(p_validator=any(policy.validator_versions)) or p_expires is null or p_expires<=clock_timestamp()
    or not exists(select 1 from parent_private.utility_protected_inputs where input_id=p_input and state='stored')
    or jsonb_typeof(p_projection) is distinct from 'object' or octet_length(p_projection::text)>32768
    or (select count(*) from jsonb_object_keys(p_projection))<>14
    or not(p_projection ?& array['version','programId','subjectId','sourceId','proofKind','originalSha256','currency','grossCents','periodStart','periodEnd','issuedOn','payFrequency','subjectMatch','sourceEvidence'])
    or exists(select 1 from jsonb_each(p_projection) v where v.key=any(array['version','programId','subjectId','sourceId','proofKind','originalSha256','currency','periodStart','periodEnd','issuedOn','subjectMatch']) and jsonb_typeof(v.value) is distinct from 'string')
    or p_projection->>'version' is distinct from p_validator or p_projection->>'programId' is distinct from a.program_id
    or p_projection->>'proofKind' not in ('pay_stub','employer_letter') or p_projection->>'currency' is distinct from 'USD'
    or p_projection->>'subjectMatch' is distinct from 'printed_name_matches_authorized_target'
    or coalesce(p_projection->>'originalSha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_projection->'grossCents') is distinct from 'number'
    or coalesce(p_projection->>'grossCents','')!~'^(0|[1-9][0-9]{0,12})$' or (p_projection->>'grossCents')::numeric>1000000000000
    or (p_projection->'payFrequency'<>'null'::jsonb and p_projection->>'payFrequency' not in ('weekly','biweekly','twice_monthly','monthly','yearly'))
    or coalesce(p_projection->>'periodStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(p_projection->>'periodEnd','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(p_projection->>'issuedOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_projection->>'periodStart'>p_projection->>'periodEnd' or p_projection->>'periodEnd'>p_projection->>'issuedOn'
    or jsonb_typeof(p_projection->'sourceEvidence') is distinct from 'array' or jsonb_array_length(p_projection->'sourceEvidence') not between 4 and 25
    or exists(select 1 from jsonb_array_elements(p_projection->'sourceEvidence') e where jsonb_typeof(e) is distinct from 'object' or (select count(*) from jsonb_object_keys(e))<>4
      or not(e ?& array['field','page','line','sourceText']) or jsonb_typeof(e->'field') is distinct from 'string' or e->>'field' not in ('grossCents','periodStart','periodEnd','issuedOn','payFrequency')
      or jsonb_typeof(e->'page') is distinct from 'number' or coalesce(e->>'page','')!~'^[1-5]$'
      or jsonb_typeof(e->'line') is distinct from 'number' or coalesce(e->>'line','')!~'^[1-9][0-9]{0,6}$'
      or jsonb_typeof(e->'sourceText') is distinct from 'string' or length(e->>'sourceText') not between 1 and 180)
    or not exists(select 1 from jsonb_array_elements(a.targets) t where t->>'subjectId'=p_projection->>'subjectId' and t->>'sourceId'=p_projection->>'sourceId' and t->>'field'='income')
    then raise exception 'protected validation unavailable' using errcode='42501'; end if;
  expires:=date_trunc('milliseconds',least(p_expires,a.expires_at));
  select * into existing from parent_private.utility_protected_validations where input_id=p_input and validator_version=p_validator;
  if found then
    if existing.projection is distinct from p_projection or existing.expires_at is distinct from expires then raise exception 'protected validation changed' using errcode='40001'; end if;
  else
    insert into parent_private.utility_protected_validations(input_id,validator_version,projection,validated_at,expires_at)
      values(p_input,p_validator,p_projection,date_trunc('milliseconds',clock_timestamp()),expires) returning * into existing;
  end if;
  return parent_private.utility_protected_reference(a);
end $$;

create function parent_private.parent_read_utility_protected_validation(p_input uuid,p_validator text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; v parent_private.utility_protected_validations; policy parent_private.utility_protected_policies;
begin
  context:=parent_private.utility_protected_authority(p_input,true);
  select * into policy from parent_private.utility_protected_policies where program_id=context->>'programId';
  if not(p_validator=any(policy.validator_versions)) then raise exception 'protected validation unavailable' using errcode='42501'; end if;
  select * into v from parent_private.utility_protected_validations where input_id=p_input and validator_version=p_validator and expires_at>clock_timestamp();
  if not found then raise exception 'protected validation unavailable' using errcode='42501'; end if;
  return jsonb_build_object('projection',v.projection,'expiresAt',v.expires_at,'validationId',v.id);
end $$;

create function parent_private.parent_begin_utility_protected_input(p_input uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; a parent_private.utility_protected_authorizations; i parent_private.utility_protected_inputs; key_text text; key_id uuid;
begin
  context:=parent_private.utility_protected_authority(p_input,false);
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  if not parent_private.utility_protected_capture_session(a) then raise exception 'protected capture session unavailable' using errcode='42501'; end if;
  select * into i from parent_private.utility_protected_inputs where input_id=p_input for update;
  if not found then
    key_id:=vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'));
    insert into parent_private.utility_protected_inputs(input_id,vault_secret_id) values(p_input,key_id) returning * into i;
  elsif i.state<>'stored' and i.created_xid<>pg_current_xact_id() then raise exception 'protected input pending' using errcode='42501'; end if;
  select decrypted_secret into key_text from vault.decrypted_secrets where id=i.vault_secret_id;
  if key_text is null or octet_length(decode(key_text,'base64'))<>32 then raise exception 'protected input key unavailable' using errcode='42501'; end if;
  return jsonb_build_object('binding',parent_private.utility_protected_binding(a,i.content_digest),'keyBase64',key_text,'state',i.state,
    'iv',encode(i.iv,'base64'),'tag',encode(i.tag,'base64'),'ciphertext',encode(i.ciphertext,'base64'));
end $$;
create function parent_private.parent_seal_utility_protected_input(p_input uuid,p_digest text,p_iv bytea,p_tag bytea,p_ciphertext bytea) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; a parent_private.utility_protected_authorizations; i parent_private.utility_protected_inputs; binding jsonb;
begin
  context:=parent_private.utility_protected_authority(p_input,false);
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  if not parent_private.utility_protected_capture_session(a) then raise exception 'protected capture session unavailable' using errcode='42501'; end if;
  select * into i from parent_private.utility_protected_inputs where input_id=p_input for update;
  if not found or i.state<>'pending' or i.created_xid<>pg_current_xact_id() or coalesce(p_digest!~'^[a-f0-9]{64}$',true)
    or coalesce(octet_length(p_iv)<>12,true) or coalesce(octet_length(p_tag)<>16,true) or coalesce(octet_length(p_ciphertext)<>a.byte_length,true) then
    raise exception 'invalid protected input seal' using errcode='23514'; end if;
  binding:=parent_private.utility_protected_binding(a,p_digest);
  update parent_private.utility_protected_inputs set content_digest=p_digest,aad=parent_private.utility_protected_aad(binding),iv=p_iv,tag=p_tag,ciphertext=p_ciphertext,state='stored' where input_id=p_input;
  return binding;
end $$;
create function parent_private.parent_read_utility_protected_input(p_input uuid,p_processing boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; a parent_private.utility_protected_authorizations; i parent_private.utility_protected_inputs; key_text text;
begin
  context:=parent_private.utility_protected_authority(p_input,p_processing);
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  select * into i from parent_private.utility_protected_inputs where input_id=p_input for update;
  if not found or i.state<>'stored' then raise exception 'protected input unavailable' using errcode='42501'; end if;
  select decrypted_secret into key_text from vault.decrypted_secrets where id=i.vault_secret_id;
  if key_text is null or octet_length(decode(key_text,'base64'))<>32 then raise exception 'protected input key unavailable' using errcode='42501'; end if;
  return jsonb_build_object('binding',parent_private.utility_protected_binding(a,i.content_digest),'keyBase64',key_text,'aad',encode(i.aad,'base64'),
    'iv',encode(i.iv,'base64'),'tag',encode(i.tag,'base64'),'ciphertext',encode(i.ciphertext,'base64'));
end $$;

-- Rebinding retains the original consent deadline and never carries validation to corrected facts.
create function parent_private.parent_begin_utility_protected_rebind(p_input uuid,p_target uuid,p_version integer,p_snapshot uuid,p_revision integer,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_protected_authorizations; target parent_private.utility_protected_authorizations; policy parent_private.utility_protected_policies;
  context jsonb; old_snapshot jsonb; table_name text; i parent_private.utility_protected_inputs; secret text; account_ref uuid; account_expiry timestamptz;
begin
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  if not found or p_target is null or p_target=p_input or a.revoked_at is not null or a.expires_at<=clock_timestamp() or not parent_private.utility_protected_origin_allowed(a) then raise exception 'protected rebind unavailable' using errcode='42501'; end if;
  context:=parent_private.utility_protected_context(a.request_id,p_version,a.program_id,p_snapshot,p_revision,p_hash);
  select * into policy from parent_private.utility_protected_policies where program_id=a.program_id;
  if not policy.enabled or coalesce(policy.approved_until<=clock_timestamp(),true) or policy.policy_version is distinct from a.policy_version or policy.retention_policy_version is distinct from a.retention_policy_version
    or length(btrim(coalesce(policy.approval_reference,'')))=0 or not(a.purpose=any(policy.allowed_purposes)) or context->>'ownerId' is distinct from a.owner_id::text then raise exception 'protected rebind unavailable' using errcode='42501'; end if;
  perform parent_private.utility_protected_targets(context,a.purpose,a.targets,a.media_type,a.byte_length);
  table_name:=case a.program_id when 'peco-cap' then 'parent_peco_application_details' when 'pgw-crp' then 'parent_pgw_application_details' else 'parent_water_application_details' end;
  execute format('select to_jsonb(s) from public.%I s where id=$1 and request_id=$2',table_name) into old_snapshot using a.snapshot_id,a.request_id;
  if old_snapshot is null or old_snapshot#>>'{consent_evidence,detailsSha256}' is distinct from a.snapshot_hash then raise exception 'protected original source unavailable' using errcode='42501'; end if;
  if (a.program_id in ('peco-cap','pgw-crp') and old_snapshot#>'{details,accountNumber}' is distinct from context#>'{snapshot,details,accountNumber}')
    or (a.program_id='pwd-tap' and old_snapshot#>'{details,propertyAddress}' is distinct from context#>'{snapshot,details,propertyAddress}') then
    raise exception 'protected account correction requires current information' using errcode='42501'; end if;
  if a.program_id='pwd-tap' and a.purpose in ('income_proof','residency_proof') then
    select min(b.account_reference::text)::uuid,min(c.expires_at) into account_ref,account_expiry from parent_private.utility_protected_account_bindings b
      join parent_private.utility_protected_accounts c on c.id=b.account_reference join parent_private.utility_protected_authorizations candidate on candidate.input_id=b.input_id
      where candidate.request_id=a.request_id and candidate.request_version=p_version and candidate.snapshot_id=p_snapshot and candidate.purpose='account_access'
        and candidate.revoked_at is null and candidate.expires_at>clock_timestamp() and c.expires_at>clock_timestamp() having count(distinct b.account_reference)=1;
    if account_ref is distinct from a.account_reference or account_ref is null then raise exception 'protected account rebind required' using errcode='42501'; end if;
  end if;
  select * into i from parent_private.utility_protected_inputs where input_id=p_input for update;
  if not found or i.state<>'stored' then raise exception 'protected original unavailable' using errcode='42501'; end if;
  select * into target from parent_private.utility_protected_authorizations where input_id=p_target;
  if found then
    if target.request_id is distinct from a.request_id or target.request_version is distinct from p_version or target.snapshot_id is distinct from p_snapshot or target.snapshot_hash is distinct from p_hash
      or target.consent_evidence->>'reboundFrom' is distinct from p_input::text or target.revoked_at is not null or target.expires_at<=clock_timestamp() then raise exception 'protected rebind changed' using errcode='40001'; end if;
  else
    if (select count(*) from parent_private.utility_protected_authorizations where request_id=a.request_id and revoked_at is null and expires_at>clock_timestamp())>=256 then
      raise exception 'protected input resource limit' using errcode='23514'; end if;
    insert into parent_private.utility_protected_authorizations(input_id,owner_id,request_id,request_version,program_id,snapshot_id,snapshot_revision,snapshot_hash,purpose,targets,media_type,byte_length,notice_version,
      policy_version,retention_policy_version,consent_evidence,consented_at,expires_at,account_reference)
    values(p_target,a.owner_id,a.request_id,p_version,a.program_id,p_snapshot,p_revision,p_hash,a.purpose,a.targets,a.media_type,a.byte_length,a.notice_version,a.policy_version,a.retention_policy_version,
      a.consent_evidence||jsonb_build_object('reboundFrom',p_input,'originAuthorizationId',coalesce(a.consent_evidence->>'originAuthorizationId',a.id::text)),a.consented_at,
      date_trunc('milliseconds',least(a.expires_at,policy.approved_until,(context->>'sourceExpiresAt')::timestamptz,(context->>'approvalExpiresAt')::timestamptz,(context#>>'{mandate,expiresAt}')::timestamptz,account_expiry)),account_ref) returning * into target;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id=i.vault_secret_id;
  if secret is null or octet_length(decode(secret,'base64'))<>32 then raise exception 'protected original key unavailable' using errcode='42501'; end if;
  return jsonb_build_object('targetInputId',target.input_id,'source',jsonb_build_object('binding',parent_private.utility_protected_binding(a,i.content_digest),'keyBase64',secret,
    'aad',encode(i.aad,'base64'),'iv',encode(i.iv,'base64'),'tag',encode(i.tag,'base64'),'ciphertext',encode(i.ciphertext,'base64')));
end $$;

-- Matching is owner/program scoped and short lived. Neither the code nor a bare hash enters metadata.
create function parent_private.parent_begin_utility_account_match(p_input uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; a parent_private.utility_protected_authorizations; k parent_private.utility_protected_account_keys; secret text;
begin
  context:=parent_private.utility_protected_authority(p_input,false);
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  if a.program_id<>'pwd-tap' or a.purpose<>'account_access' then raise exception 'protected account matching unavailable' using errcode='42501'; end if;
  select * into k from parent_private.utility_protected_account_keys where owner_id=a.owner_id and program_id=a.program_id for update;
  if not found or k.expires_at<=clock_timestamp() or k.expires_at<a.expires_at then raise exception 'protected account key unavailable' using errcode='42501'; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id=k.vault_secret_id;
  if secret is null or octet_length(decode(secret,'base64'))<>32 then raise exception 'protected account key unavailable' using errcode='42501'; end if;
  return jsonb_build_object('keyId',k.id,'keyBase64',secret,'expiresAt',k.expires_at,'ownerId',a.owner_id,'programId',a.program_id);
end $$;
create function parent_private.parent_bind_utility_account(p_input uuid,p_key uuid,p_fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare context jsonb; a parent_private.utility_protected_authorizations; k parent_private.utility_protected_account_keys; account_id uuid; existing uuid;
begin
  context:=parent_private.utility_protected_authority(p_input,false);
  select * into a from parent_private.utility_protected_authorizations where input_id=p_input;
  select * into k from parent_private.utility_protected_account_keys where owner_id=a.owner_id and program_id=a.program_id for update;
  if a.program_id<>'pwd-tap' or a.purpose<>'account_access' or k.id is distinct from p_key or k.expires_at<=clock_timestamp()
    or coalesce(p_fingerprint!~'^[a-f0-9]{64}$',true) or not exists(select 1 from parent_private.utility_protected_inputs where input_id=p_input and state='stored') then
    raise exception 'protected account matching unavailable' using errcode='42501'; end if;
  insert into parent_private.utility_protected_accounts(owner_id,program_id,key_id,fingerprint,expires_at) values(a.owner_id,a.program_id,k.id,p_fingerprint,least(a.expires_at,k.expires_at))
    on conflict(owner_id,program_id,key_id,fingerprint) do update set fingerprint=excluded.fingerprint returning id into account_id;
  if exists(select 1 from parent_private.utility_protected_account_bindings b join parent_private.utility_protected_authorizations old on old.input_id=b.input_id
    where old.request_id=a.request_id and old.request_version=a.request_version and old.revoked_at is null and old.expires_at>clock_timestamp() and b.account_reference<>account_id) then
    raise exception 'protected account correction required' using errcode='40001'; end if;
  select account_reference into existing from parent_private.utility_protected_account_bindings where input_id=p_input;
  if found and existing<>account_id then raise exception 'protected account binding changed' using errcode='40001'; end if;
  insert into parent_private.utility_protected_account_bindings(input_id,account_reference) values(p_input,account_id) on conflict(input_id) do nothing;
  return account_id;
end $$;

create function parent_private.guard_utility_protected_input() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.input_id is distinct from old.input_id or new.vault_secret_id is distinct from old.vault_secret_id or new.created_xid is distinct from old.created_xid
    or old.state='stored' then raise exception 'protected input is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger utility_protected_input_immutable before update on parent_private.utility_protected_inputs for each row execute function parent_private.guard_utility_protected_input();
create function parent_private.require_sealed_utility_protected_input() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from parent_private.utility_protected_inputs where input_id=new.input_id and state<>'stored') then
    raise exception 'protected input must seal in its creation transaction' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger utility_protected_input_sealed after insert or update on parent_private.utility_protected_inputs deferrable initially deferred
  for each row execute function parent_private.require_sealed_utility_protected_input();
create function parent_private.delete_utility_protected_key() returns trigger
language plpgsql security definer set search_path='' as $$
begin delete from vault.secrets where id=old.vault_secret_id; return old; end $$;
create trigger utility_protected_input_key_cleanup before delete on parent_private.utility_protected_inputs for each row execute function parent_private.delete_utility_protected_key();
create trigger utility_protected_account_key_cleanup before delete on parent_private.utility_protected_account_keys for each row execute function parent_private.delete_utility_protected_key();

create function parent_private.parent_purge_utility_protected_inputs(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare v_request uuid; v_input uuid; removed integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid protected cleanup limit' using errcode='23514'; end if;
  for v_request in select distinct r.id from public.parent_requests r join parent_private.utility_protected_authorizations a on a.request_id=r.id
    join public.parent_accounts u on u.id=a.owner_id join parent_private.utility_protected_inputs i on i.input_id=a.input_id
    where a.expires_at<=clock_timestamp() or a.revoked_at is not null
      or r.status='cancelled' or r.mandate_revoked_at is not null or u.status='deletion_requested'
    order by r.id limit p_limit loop
    perform 1 from public.parent_requests r where r.id=v_request for update skip locked;
    if not found then continue; end if;
    for v_input in select a.input_id from parent_private.utility_protected_authorizations a join public.parent_requests r on r.id=a.request_id
      join public.parent_accounts u on u.id=a.owner_id join parent_private.utility_protected_inputs i on i.input_id=a.input_id
      where a.request_id=v_request and (a.expires_at<=clock_timestamp() or a.revoked_at is not null
        or r.status='cancelled' or r.mandate_revoked_at is not null or u.status='deletion_requested')
      order by a.expires_at,a.input_id limit p_limit-removed loop
      delete from parent_private.utility_protected_inputs i where i.input_id=v_input;
      if found then
        delete from parent_private.utility_protected_validations v where v.input_id=v_input;
        removed:=removed+1;
      end if;
    end loop;
    exit when removed>=p_limit;
  end loop;
  -- Key matching expires independently of current programme/global collection gates.
  delete from parent_private.utility_protected_accounts a where a.id in (select x.id from parent_private.utility_protected_accounts x where x.expires_at<=clock_timestamp()
    or not exists(select 1 from parent_private.utility_protected_account_bindings b join parent_private.utility_protected_authorizations auth on auth.input_id=b.input_id
      join parent_private.utility_protected_inputs i on i.input_id=auth.input_id join public.parent_requests r on r.id=auth.request_id
      join public.parent_accounts owner on owner.id=auth.owner_id where b.account_reference=x.id and auth.revoked_at is null and auth.expires_at>clock_timestamp()
        and r.status in ('active','paused') and r.mandate_revoked_at is null and owner.status='active') order by x.expires_at limit p_limit for update skip locked);
  delete from parent_private.utility_protected_account_keys k where k.id in (select x.id from parent_private.utility_protected_account_keys x where x.expires_at<=clock_timestamp()
    or exists(select 1 from public.parent_accounts owner where owner.id=x.owner_id and owner.status='deletion_requested')
    order by x.expires_at limit p_limit for update skip locked);
  return removed;
end $$;

revoke execute on function parent_private.utility_protected_context(uuid,integer,text,uuid,integer,text),parent_private.utility_protected_targets(jsonb,text,jsonb,text,integer),
  parent_private.utility_protected_reference(parent_private.utility_protected_authorizations),parent_private.utility_protected_authority(uuid,boolean),
  parent_private.utility_protected_snapshot_current(parent_private.utility_protected_authorizations),parent_private.utility_protected_account_key_for_capture(uuid,timestamptz),
  parent_private.utility_protected_origin_allowed(parent_private.utility_protected_authorizations),
  parent_private.utility_protected_capture_session(parent_private.utility_protected_authorizations),
  parent_private.utility_protected_binding(parent_private.utility_protected_authorizations,text),parent_private.utility_protected_aad(jsonb),
  parent_private.guard_utility_protected_input(),parent_private.require_sealed_utility_protected_input(),parent_private.delete_utility_protected_key(),
  parent_private.guard_utility_protected_authorization(),parent_private.guard_utility_protected_validation(),
  parent_private.utility_protected_workspace_target(jsonb,text,jsonb,text,text),
  parent_private.parent_check_utility_protected_input(uuid,boolean),parent_private.parent_record_utility_protected_validation(uuid,text,jsonb,timestamptz),parent_private.parent_read_utility_protected_validation(uuid,text),
  parent_private.parent_list_utility_protected_inputs(uuid,integer,text,uuid,integer,text),
  parent_private.parent_begin_utility_account_match(uuid),parent_private.parent_bind_utility_account(uuid,uuid,text),
  parent_private.parent_begin_utility_protected_rebind(uuid,uuid,integer,uuid,integer,text),
  parent_private.parent_get_utility_protected_context(uuid,integer,text,uuid,integer,text),parent_private.parent_begin_utility_protected_input(uuid),
  parent_private.parent_seal_utility_protected_input(uuid,text,bytea,bytea,bytea),parent_private.parent_read_utility_protected_input(uuid,boolean),parent_private.parent_purge_utility_protected_inputs(integer)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_get_utility_protected_context(uuid,integer,text,uuid,integer,text),parent_private.parent_begin_utility_protected_input(uuid),parent_private.parent_check_utility_protected_input(uuid,boolean),
  parent_private.parent_list_utility_protected_inputs(uuid,integer,text,uuid,integer,text),
  parent_private.parent_record_utility_protected_validation(uuid,text,jsonb,timestamptz),parent_private.parent_read_utility_protected_validation(uuid,text),
  parent_private.parent_begin_utility_account_match(uuid),parent_private.parent_bind_utility_account(uuid,uuid,text),
  parent_private.parent_begin_utility_protected_rebind(uuid,uuid,integer,uuid,integer,text),
  parent_private.parent_seal_utility_protected_input(uuid,text,bytea,bytea,bytea),parent_private.parent_read_utility_protected_input(uuid,boolean) to parent_utility_protected;
grant execute on function parent_private.parent_purge_utility_protected_inputs(integer) to parent_retention_worker;
revoke execute on function public.parent_authorize_utility_protected_input(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean),
  public.parent_get_utility_protected_inputs(uuid),public.parent_revoke_utility_protected_input(uuid,uuid),public.parent_check_utility_protected_input(uuid,uuid),public.parent_get_utility_protected_workspace(uuid,integer)
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_authorize_utility_protected_input(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean),
  public.parent_get_utility_protected_inputs(uuid),public.parent_revoke_utility_protected_input(uuid,uuid),public.parent_check_utility_protected_input(uuid,uuid),public.parent_get_utility_protected_workspace(uuid,integer) to authenticated;

revoke execute on function public.parent_export_utility_protected_inputs() from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_export_utility_protected_inputs() to authenticated;
