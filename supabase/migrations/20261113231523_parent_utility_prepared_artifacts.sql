-- Only trusted isolated renderers may prepare an encrypted utility draft. This grants no transport.
alter table parent_private.utility_protected_policies add column preparation_versions text[] not null default '{}';
alter table public.parent_jobs add column utility_preparation_wake_lease_token uuid;
create table parent_private.utility_prepared_artifacts (
  id uuid primary key,
  generation bigint generated always as identity unique,
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  operation_id uuid not null unique references public.parent_operations(id) on delete cascade deferrable initially deferred,
  preparation_key text not null check(preparation_key~'^[a-f0-9]{64}$'),
  spec jsonb not null check(jsonb_typeof(spec)='object'),
  operation jsonb not null check(operation->>'action'='prepare' and operation->>'state'='prepared'),
  mandate_hash text not null check(mandate_hash~'^[a-f0-9]{64}$'),
  prepared_at timestamptz not null, expires_at timestamptz not null check(expires_at>prepared_at),
  vault_secret_id uuid unique, aad bytea, iv bytea, tag bytea, ciphertext bytea,
  state text not null default 'pending' check(state in ('pending','stored','purged')),
  created_xid xid8 not null default pg_current_xact_id(),
  unique(request_id,preparation_key),
  check((state='pending' and vault_secret_id is not null and aad is null and iv is null and tag is null and ciphertext is null)
    or (state='stored' and vault_secret_id is not null and aad is not null and iv is not null and tag is not null and octet_length(iv)=12 and octet_length(tag)=16 and ciphertext is not null)
    or (state='purged' and vault_secret_id is null and aad is null and iv is null and tag is null and ciphertext is null))
);
alter table parent_private.utility_prepared_artifacts enable row level security;
revoke all on parent_private.utility_prepared_artifacts from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

-- A new capture or validation changes this observation even when immutable family answers are unchanged.
create function parent_private.utility_preparation_input_set(p_scope jsonb) returns text
language sql volatile security definer set search_path='' as $$
  select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('inputId',a.input_id,'authorizationId',a.id,
    'accountReference',parent_private.utility_protected_reference(a)->'accountReference',
    'validations',(select coalesce(jsonb_agg(v.id order by v.id),'[]') from parent_private.utility_protected_validations v where v.input_id=a.input_id and v.expires_at>clock_timestamp())) order by a.input_id),'[]')::text,'UTF8')),'hex')
  from parent_private.utility_protected_authorizations a join parent_private.utility_protected_inputs i on i.input_id=a.input_id and i.state='stored'
  where a.request_id=(p_scope->>'requestId')::uuid and a.request_version=(p_scope->>'expectedVersion')::numeric::integer and a.program_id=p_scope->>'programId'
    and a.snapshot_id=(p_scope->>'snapshotId')::uuid and a.snapshot_revision=(p_scope->>'snapshotRevision')::numeric::integer and a.snapshot_hash=p_scope->>'snapshotHash'
    and a.revoked_at is null and a.expires_at>clock_timestamp();
$$;

create function parent_private.require_utility_preparation_lease(p_job uuid,p_lease uuid,p_version integer) returns public.parent_jobs
language plpgsql security definer set search_path='' as $$
declare job public.parent_jobs;
begin
  job:=parent_private.require_lease(p_job,p_lease,p_version);
  if job.lease_until<=clock_timestamp() or job.lease_started_at<clock_timestamp()-interval '15 minutes' then raise exception 'utility preparation lease expired' using errcode='42501'; end if;
  return job;
end $$;

-- Exact fixed preparation specification, resolved privately; no names, identifiers or PDF values enter it.
create function parent_private.utility_preparation_context(p_spec jsonb,p_processing boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; policy parent_private.utility_protected_policies; a parent_private.utility_protected_authorizations; v parent_private.utility_protected_validations;
  input jsonb; scope jsonb:=p_spec->'scope'; source jsonb:=p_spec->'source'; effective_version integer;
  expiry timestamptz; docs boolean:=false; canonical_inputs jsonb; original_version integer;
begin
  if jsonb_typeof(p_spec) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_spec))<>7
    or not(p_spec ?& array['scope','inputSetHash','inputs','source','expiresAt','contentSha256','byteLength'])
    or jsonb_typeof(scope) is distinct from 'object' or (select count(*) from jsonb_object_keys(scope))<>6
    or not(scope ?& array['requestId','expectedVersion','programId','snapshotId','snapshotRevision','snapshotHash'])
    or jsonb_typeof(source) is distinct from 'object' or (select count(*) from jsonb_object_keys(source))<>5
    or not(source ?& array['kind','id','version','sha256','rendererVersion'])
    or jsonb_typeof(p_spec->'inputs') is distinct from 'array' or jsonb_array_length(p_spec->'inputs')>256
    or exists(select 1 from jsonb_each(p_spec) x where x.key in ('contentSha256','inputSetHash','expiresAt') and jsonb_typeof(x.value)<>'string')
    or coalesce(p_spec->>'contentSha256','') !~ '^[a-f0-9]{64}$' or (p_spec->>'byteLength')::numeric not between 64 and 10485760
    or jsonb_typeof(p_spec->'byteLength') is distinct from 'number' or (p_spec->>'byteLength')::numeric<>trunc((p_spec->>'byteLength')::numeric)
    or exists(select 1 from jsonb_each(source) x where jsonb_typeof(x.value)<>'string')
    or exists(select 1 from jsonb_each(scope) x where x.key not in ('expectedVersion','snapshotRevision') and jsonb_typeof(x.value)<>'string')
    or coalesce(scope->>'snapshotHash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_spec->>'inputSetHash','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(scope->'expectedVersion') is distinct from 'number' or jsonb_typeof(scope->'snapshotRevision') is distinct from 'number'
    or (scope->>'expectedVersion')::numeric not between 1 and 2147483647 or trunc((scope->>'expectedVersion')::numeric)<>(scope->>'expectedVersion')::numeric
    or (scope->>'snapshotRevision')::numeric not between 1 and 2147483647 or trunc((scope->>'snapshotRevision')::numeric)<>(scope->>'snapshotRevision')::numeric
    or coalesce(source->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_spec->>'expiresAt','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    or coalesce(source->>'id','') !~ '^[a-z0-9][a-z0-9._-]{0,79}$' or coalesce(source->>'version','') !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
    or exists(select 1 from jsonb_each_text(source) x where length(x.value)>80 and x.key<>'sha256')
    or coalesce(source->>'rendererVersion','') !~ '^[a-z0-9][a-z0-9._-]{0,79}$' then raise exception 'invalid private preparation' using errcode='23514'; end if;
  original_version:=(scope->>'expectedVersion')::numeric::integer;
  effective_version:=original_version;
  if not p_processing then select version into effective_version from public.parent_requests where id=(scope->>'requestId')::uuid; end if;
  c:=parent_private.utility_protected_context((scope->>'requestId')::uuid,effective_version,scope->>'programId',(scope->>'snapshotId')::uuid,(scope->>'snapshotRevision')::numeric::integer,scope->>'snapshotHash');
  if p_processing and not parent_private.current_grant((scope->>'requestId')::uuid,original_version) then raise exception 'utility preparation paused' using errcode='42501'; end if;
  if p_spec->>'inputSetHash' is distinct from parent_private.utility_preparation_input_set(scope) then raise exception 'protected input set changed' using errcode='42501'; end if;
  select * into policy from parent_private.utility_protected_policies where program_id=scope->>'programId';
  if not found or not policy.enabled or length(btrim(coalesce(policy.approval_reference,'')))=0 or coalesce(policy.approved_until<=clock_timestamp(),true)
    or policy.policy_version is null or policy.retention_policy_version is null or policy.max_retention_seconds is null
    or not(source->>'rendererVersion'=any(policy.preparation_versions)) then raise exception 'utility preparation unavailable' using errcode='42501'; end if;
  if scope->>'programId'='pwd-tap' then
    if source->>'kind' is distinct from 'local_test_issued_form' or source->>'id' is distinct from 'caselink-local-water-issued-form'
      or source->>'sha256' is not distinct from c#>>'{snapshot,source,sampleSha256}' then raise exception 'no actual issued water form verified' using errcode='42501'; end if;
  else
    if source->>'kind' is distinct from 'official_public_form' or source->>'sha256' is distinct from c#>>'{snapshot,source,sourceSha256}'
      or source->>'id' is distinct from coalesce(c#>>'{snapshot,source,contractId}',c#>>'{snapshot,source,id}')
      or source->>'version' is distinct from coalesce(c#>>'{snapshot,source,contractVersion}',c#>>'{snapshot,source,version}') then raise exception 'preparation form changed' using errcode='42501'; end if;
  end if;
  expiry:=least((p_spec->>'expiresAt')::timestamptz,policy.approved_until,(c#>>'{mandate,expiresAt}')::timestamptz,
    (c->>'sourceExpiresAt')::timestamptz,(c->>'approvalExpiresAt')::timestamptz,clock_timestamp()+make_interval(secs=>policy.max_retention_seconds));
  for input in select x from jsonb_array_elements(p_spec->'inputs') x loop
    if jsonb_typeof(input) is distinct from 'object' or (select count(*) from jsonb_object_keys(input))<>3
      or not(input ?& array['inputId','authorizationId','validationId']) or jsonb_typeof(input->'inputId') is distinct from 'string'
      or jsonb_typeof(input->'authorizationId') is distinct from 'string' or jsonb_typeof(input->'validationId') not in ('string','null') then raise exception 'invalid protected preparation input' using errcode='23514'; end if;
    select * into a from parent_private.utility_protected_authorizations where input_id=(input->>'inputId')::uuid;
    if not found or a.id is distinct from (input->>'authorizationId')::uuid or a.owner_id::text is distinct from c->>'ownerId'
      or a.request_id::text is distinct from scope->>'requestId' or a.request_version<>original_version or a.program_id is distinct from scope->>'programId'
      or a.snapshot_id::text is distinct from scope->>'snapshotId' or a.snapshot_revision<>(scope->>'snapshotRevision')::numeric::integer or a.snapshot_hash is distinct from scope->>'snapshotHash'
      or a.revoked_at is not null or a.expires_at<=clock_timestamp() or a.policy_version is distinct from policy.policy_version or a.retention_policy_version is distinct from policy.retention_policy_version
      or not(a.purpose=any(policy.allowed_purposes)) or not exists(select 1 from parent_private.utility_protected_inputs i where i.input_id=a.input_id and i.state='stored') then
      raise exception 'protected preparation input changed' using errcode='42501'; end if;
    perform parent_private.utility_protected_targets(c,a.purpose,a.targets,a.media_type,a.byte_length);
    if p_processing then perform parent_private.utility_protected_authority(a.input_id,true); end if;
    expiry:=least(expiry,a.expires_at);
    if a.purpose in ('income_proof','residency_proof') then docs:=true; end if;
    if input->'validationId'<>'null'::jsonb then
      select * into v from parent_private.utility_protected_validations where id=(input->>'validationId')::uuid and input_id=a.input_id;
      if not found or v.expires_at<=clock_timestamp() or not(v.validator_version=any(policy.validator_versions)) then raise exception 'protected source validation changed' using errcode='42501'; end if;
      expiry:=least(expiry,v.expires_at);
    end if;
  end loop;
  if (select count(*)<>count(distinct x->>'inputId') from jsonb_array_elements(p_spec->'inputs') x) then raise exception 'duplicate protected preparation input' using errcode='23514'; end if;
  select coalesce(jsonb_agg(x order by x->>'inputId'),'[]') into canonical_inputs from jsonb_array_elements(p_spec->'inputs') x;
  if canonical_inputs is distinct from p_spec->'inputs' or expiry<=clock_timestamp() then raise exception 'private preparation deadline or order changed' using errcode='42501'; end if;
  return c||jsonb_build_object('policyVersion',policy.policy_version,'retentionPolicyVersion',policy.retention_policy_version,'maxExpiresAt',date_trunc('milliseconds',expiry),
    'maxRetentionSeconds',policy.max_retention_seconds,
    'dataCategories',to_jsonb(array['household','income','utility']||case when docs then array['documents'] else array[]::text[] end),
    'mandateHash',encode(sha256(convert_to((c->'mandate')::text,'UTF8')),'hex'));
end $$;

create function parent_private.utility_prepared_binding(p_artifact parent_private.utility_prepared_artifacts) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('format','caselink-utility-preparation-v1','ownerId',p_artifact.owner_id,'mandateHash',p_artifact.mandate_hash,'inputSetHash',p_artifact.spec->'inputSetHash','operation',p_artifact.operation);
$$;
create function parent_private.utility_prepared_aad(b jsonb) returns bytea
language sql immutable set search_path='' as $$
  select convert_to(array_to_json(array[b->>'format',b->>'ownerId',b->>'mandateHash',b->>'inputSetHash',b#>>'{operation,operationId}',b#>>'{operation,packetHash}',b#>>'{operation,idempotencyKey}',
    b#>>'{operation,packet,protectedUtilityPacket,packetId}',b#>>'{operation,packet,protectedUtilityPacket,requestId}',b#>>'{operation,packet,protectedUtilityPacket,requestVersion}',b#>>'{operation,packet,protectedUtilityPacket,programId}',
    b#>>'{operation,packet,protectedUtilityPacket,snapshotId}',b#>>'{operation,packet,protectedUtilityPacket,snapshotRevision}',b#>>'{operation,packet,protectedUtilityPacket,snapshotHash}',
    (select coalesce(string_agg((x->>'inputId')||':'||(x->>'authorizationId')||':'||coalesce(x->>'validationId','-'),',' order by x->>'inputId'),'') from jsonb_array_elements(b#>'{operation,packet,protectedUtilityPacket,inputs}') x),
    b#>>'{operation,packet,protectedUtilityPacket,sourceKind}',b#>>'{operation,packet,protectedUtilityPacket,templateId}',b#>>'{operation,packet,protectedUtilityPacket,templateVersion}',b#>>'{operation,packet,protectedUtilityPacket,templateSha256}',
    b#>>'{operation,packet,protectedUtilityPacket,rendererVersion}',b#>>'{operation,packet,protectedUtilityPacket,policyVersion}',b#>>'{operation,packet,protectedUtilityPacket,retentionPolicyVersion}',
    b#>>'{operation,packet,protectedUtilityPacket,preparedAt}',b#>>'{operation,packet,protectedUtilityPacket,expiresAt}',b#>>'{operation,packet,protectedUtilityPacket,contentSha256}',b#>>'{operation,packet,protectedUtilityPacket,byteLength}',
    (select string_agg(x,',' order by ord) from jsonb_array_elements_text(b#>'{operation,dataCategories}') with ordinality a(x,ord))])::text,'UTF8');
$$;

create function parent_private.utility_prepared_authority(p_packet uuid,p_processing boolean) returns parent_private.utility_prepared_artifacts
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_prepared_artifacts; c jsonb; o public.parent_operations;
begin
  select * into a from parent_private.utility_prepared_artifacts where id=p_packet;
  if not found or a.state<>'stored' or a.expires_at<=clock_timestamp() then raise exception 'private draft unavailable' using errcode='42501'; end if;
  c:=parent_private.utility_preparation_context(a.spec,p_processing);
  if a.prepared_at+make_interval(secs=>(c->>'maxRetentionSeconds')::integer)<=clock_timestamp() then raise exception 'private draft retention ended' using errcode='42501'; end if;
  select * into o from public.parent_operations where id=a.operation_id;
  if not found or o.request_id<>a.request_id or o.packet is distinct from a.operation->'packet'
    or o.packet_hash is distinct from a.operation->>'packetHash' or o.packet_hash<>encode(sha256(convert_to(o.packet::text,'UTF8')),'hex')
    or o.action<>'prepare' or o.artifact_id is not null or cardinality(o.document_ids)<>0
    or o.idempotency_key is distinct from a.operation->>'idempotencyKey' or o.request_version<>(a.operation->>'requestVersion')::integer
    or o.program_id is distinct from a.operation->>'programId' or o.need is distinct from a.operation->>'need'
    or to_jsonb(o.data_categories) is distinct from a.operation->'dataCategories'
    or c->>'mandateHash' is distinct from a.mandate_hash or c->>'policyVersion' is distinct from a.operation#>>'{packet,protectedUtilityPacket,policyVersion}'
    or c->>'retentionPolicyVersion' is distinct from a.operation#>>'{packet,protectedUtilityPacket,retentionPolicyVersion}'
    or (p_processing and o.state<>'prepared') or exists(select 1 from parent_private.utility_prepared_artifacts newer where newer.request_id=a.request_id and newer.generation>a.generation) then
    raise exception 'private draft scope changed' using errcode='42501'; end if;
  return a;
end $$;

create function parent_private.utility_prepared_current(p_packet uuid,p_processing boolean default true) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin perform parent_private.utility_prepared_authority(p_packet,p_processing); return true;
exception when others then return false; end $$;

create function parent_private.parent_get_utility_prepared_operation(p_job uuid,p_lease uuid,p_packet uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_prepared_artifacts; job public.parent_jobs;
begin
  select * into a from parent_private.utility_prepared_artifacts where id=p_packet;
  if not found then return null; end if;
  job:=parent_private.require_utility_preparation_lease(p_job,p_lease,(a.operation->>'requestVersion')::integer);
  if job.request_id<>a.request_id then raise exception 'preparation job changed' using errcode='42501'; end if;
  a:=parent_private.utility_prepared_authority(a.id,true);
  perform parent_private.require_utility_preparation_lease(p_job,p_lease,(a.operation->>'requestVersion')::integer);
  return a.operation;
end $$;

create function parent_private.parent_begin_utility_prepared_artifact(p_job uuid,p_lease uuid,p_spec jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; job public.parent_jobs; a parent_private.utility_prepared_artifacts; prep_key text; packet uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
  prepared timestamptz; expiry timestamptz; reference jsonb; operation jsonb; frozen jsonb; secret uuid; secret_text text;
begin
  job:=parent_private.require_utility_preparation_lease(p_job,p_lease,(p_spec#>>'{scope,expectedVersion}')::numeric::integer);
  if job.request_id::text is distinct from p_spec#>>'{scope,requestId}' then raise exception 'preparation job changed' using errcode='42501'; end if;
  c:=parent_private.utility_preparation_context(p_spec,true);
  prep_key:=encode(sha256(convert_to((p_spec-'contentSha256'-'byteLength'-'expiresAt')::text,'UTF8')),'hex');
  select * into a from parent_private.utility_prepared_artifacts where request_id=job.request_id and preparation_key=prep_key for update;
  if found then
    a:=parent_private.utility_prepared_authority(a.id,true);
    if a.spec-'expiresAt' is distinct from p_spec-'expiresAt' or a.expires_at>(p_spec->>'expiresAt')::timestamptz then raise exception 'prepared file retry changed' using errcode='40001'; end if;
  else
    prepared:=date_trunc('milliseconds',clock_timestamp()); expiry:=(c->>'maxExpiresAt')::timestamptz;
    reference:=jsonb_build_object('packetId',packet,'requestId',job.request_id,'requestVersion',job.request_version,'programId',c->>'programId',
      'snapshotId',p_spec#>'{scope,snapshotId}','snapshotRevision',p_spec#>'{scope,snapshotRevision}','snapshotHash',p_spec#>'{scope,snapshotHash}','inputs',p_spec->'inputs',
      'sourceKind',p_spec#>'{source,kind}','templateId',p_spec#>'{source,id}','templateVersion',p_spec#>'{source,version}','templateSha256',p_spec#>'{source,sha256}','rendererVersion',p_spec#>'{source,rendererVersion}',
      'policyVersion',c->>'policyVersion','retentionPolicyVersion',c->>'retentionPolicyVersion',
      'preparedAt',to_char(prepared at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(expiry at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'contentSha256',p_spec->'contentSha256','byteLength',p_spec->'byteLength','preparationOnly',true);
    frozen:=jsonb_build_object('protectedUtilityPacket',reference);
    operation:=jsonb_build_object('operationId',op,'requestId',job.request_id,'requestVersion',job.request_version,'need',c->>'need','programId',c->>'programId','action','prepare','state','prepared',
      'packet',frozen,'packetHash',encode(sha256(convert_to(frozen::text,'UTF8')),'hex'),'dataCategories',c->'dataCategories','documentIds','[]'::jsonb,'artifactId',null,
      'idempotencyKey','utility-prepare:'||packet::text,'protectedPacketCurrent',true);
    secret:=vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'));
    insert into parent_private.utility_prepared_artifacts(id,owner_id,request_id,operation_id,preparation_key,spec,operation,mandate_hash,prepared_at,expires_at,vault_secret_id)
      values(packet,(c->>'ownerId')::uuid,job.request_id,op,prep_key,p_spec,operation,c->>'mandateHash',prepared,expiry,secret) returning * into a;
  end if;
  select decrypted_secret into secret_text from vault.decrypted_secrets where id=a.vault_secret_id;
  if secret_text is null or octet_length(decode(secret_text,'base64'))<>32 then raise exception 'private draft key unavailable' using errcode='42501'; end if;
  perform parent_private.require_utility_preparation_lease(p_job,p_lease,(a.operation->>'requestVersion')::integer);
  return jsonb_build_object('binding',parent_private.utility_prepared_binding(a),'keyBase64',secret_text,'state',a.state,
    'aad',case when a.aad is null then null else encode(a.aad,'base64') end,'iv',case when a.iv is null then null else encode(a.iv,'base64') end,
    'tag',case when a.tag is null then null else encode(a.tag,'base64') end,'ciphertext',case when a.ciphertext is null then null else encode(a.ciphertext,'base64') end);
end $$;

create function parent_private.parent_seal_utility_prepared_artifact(p_job uuid,p_lease uuid,p_packet uuid,p_iv bytea,p_tag bytea,p_ciphertext bytea) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_prepared_artifacts; c jsonb; job public.parent_jobs; op jsonb;
begin
  select * into a from parent_private.utility_prepared_artifacts where id=p_packet for update;
  if not found or a.state<>'pending' or a.created_xid<>pg_current_xact_id() then raise exception 'private draft seal unavailable' using errcode='42501'; end if;
  job:=parent_private.require_utility_preparation_lease(p_job,p_lease,(a.operation->>'requestVersion')::integer);
  c:=parent_private.utility_preparation_context(a.spec,true); op:=a.operation;
  if job.request_id<>a.request_id or c->>'mandateHash' is distinct from a.mandate_hash or p_iv is null or p_tag is null or p_ciphertext is null or octet_length(p_iv)<>12 or octet_length(p_tag)<>16
    or octet_length(p_ciphertext)<>(a.spec->>'byteLength')::integer or a.expires_at<=clock_timestamp() then raise exception 'private draft seal changed' using errcode='42501'; end if;
  update public.parent_operations set state='invalidated',updated_at=now() where request_id=a.request_id and action='prepare' and packet ? 'protectedUtilityPacket' and state='prepared';
  insert into public.parent_operations(id,request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,artifact_id)
    values(a.operation_id,a.request_id,(op->>'requestVersion')::integer,op->>'need',op->>'programId','prepare',op->'packet',op->>'packetHash',array(select jsonb_array_elements_text(op->'dataCategories')),array[]::uuid[],op->>'idempotencyKey',null);
  update parent_private.utility_prepared_artifacts set state='stored',aad=parent_private.utility_prepared_aad(parent_private.utility_prepared_binding(a)),iv=p_iv,tag=p_tag,ciphertext=p_ciphertext where id=a.id;
  perform parent_private.require_utility_preparation_lease(p_job,p_lease,(a.operation->>'requestVersion')::integer);
  update public.parent_jobs set utility_preparation_wake_lease_token=null where id=p_job and utility_preparation_wake_lease_token=p_lease;
  return a.operation||jsonb_build_object('protectedPacketCurrent',parent_private.utility_prepared_current(a.id,true));
end $$;

create function parent_private.parent_read_utility_prepared_artifact(p_packet uuid,p_owner uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_prepared_artifacts; key_text text;
begin
  a:=parent_private.utility_prepared_authority(p_packet,false);
  if a.owner_id is distinct from p_owner or a.request_id is distinct from p_request then raise exception 'private draft unavailable' using errcode='42501'; end if;
  select decrypted_secret into key_text from vault.decrypted_secrets where id=a.vault_secret_id;
  if key_text is null or octet_length(decode(key_text,'base64'))<>32 then raise exception 'private draft key unavailable' using errcode='42501'; end if;
  return jsonb_build_object('binding',parent_private.utility_prepared_binding(a),'keyBase64',key_text,'aad',encode(a.aad,'base64'),'iv',encode(a.iv,'base64'),'tag',encode(a.tag,'base64'),'ciphertext',encode(a.ciphertext,'base64'));
end $$;
create function parent_private.parent_check_utility_prepared_artifact(p_packet uuid,p_owner uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_prepared_artifacts;
begin
  a:=parent_private.utility_prepared_authority(p_packet,false);
  if a.owner_id is distinct from p_owner or a.request_id is distinct from p_request then raise exception 'private draft unavailable' using errcode='42501'; end if;
  return a.operation||jsonb_build_object('protectedPacketCurrent',parent_private.utility_prepared_current(a.id,true));
end $$;

create function parent_private.guard_utility_prepared_artifact() returns trigger
language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-array['state','vault_secret_id','aad','iv','tag','ciphertext']) is distinct from (to_jsonb(old)-array['state','vault_secret_id','aad','iv','tag','ciphertext'])
    or not((old.state='pending' and new.state='stored' and old.created_xid=pg_current_xact_id() and new.vault_secret_id=old.vault_secret_id)
      or (old.state='stored' and new.state='purged' and new.vault_secret_id is null and new.aad is null and new.iv is null and new.tag is null and new.ciphertext is null)) then
    raise exception 'private draft is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger utility_prepared_artifact_immutable before update on parent_private.utility_prepared_artifacts for each row execute function parent_private.guard_utility_prepared_artifact();
create function parent_private.require_sealed_utility_prepared_artifact() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from parent_private.utility_prepared_artifacts where id=new.id and state='pending') then raise exception 'an unsealed private draft cannot commit' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger utility_prepared_artifact_requires_seal after insert on parent_private.utility_prepared_artifacts deferrable initially deferred for each row execute function parent_private.require_sealed_utility_prepared_artifact();
create function parent_private.delete_utility_prepared_key() returns trigger
language plpgsql security definer set search_path='' as $$
begin delete from vault.secrets where id=old.vault_secret_id; return old; end $$;
create trigger utility_prepared_artifact_key_cleanup before delete on parent_private.utility_prepared_artifacts for each row execute function parent_private.delete_utility_prepared_key();

create function parent_private.parent_purge_utility_prepared_artifacts(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_prepared_artifacts; n integer:=0; invalid boolean;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid cleanup batch' using errcode='23514'; end if;
  for a in select * from parent_private.utility_prepared_artifacts where state='stored' and not parent_private.utility_prepared_current(id,false) order by expires_at limit p_limit for update skip locked loop
    invalid:=a.expires_at<=clock_timestamp();
    if not invalid then begin perform parent_private.utility_prepared_authority(a.id,false); exception when sqlstate '42501' then invalid:=true; end; end if;
    if invalid then
      delete from vault.secrets where id=a.vault_secret_id;
      update parent_private.utility_prepared_artifacts set state='purged',vault_secret_id=null,aad=null,iv=null,tag=null,ciphertext=null where id=a.id;
      n:=n+1;
    end if;
  end loop;
  return n;
end $$;

-- The ordinary worker may inspect a prepared reference, but can never begin delivery or promote its outcome.
create function parent_private.guard_utility_prepared_operation() returns trigger
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_prepared_artifacts;
begin
  if not(new.packet ? 'protectedUtilityPacket') and (tg_op='INSERT' or not(old.packet ? 'protectedUtilityPacket')) then return new; end if;
  select * into a from parent_private.utility_prepared_artifacts where operation_id=new.id;
  if not found or new.action<>'prepare' or new.state not in ('prepared','invalidated') or new.packet is distinct from a.operation->'packet'
    or new.packet_hash is distinct from a.operation->>'packetHash' or new.request_id<>a.request_id or new.request_version<>(a.operation->>'requestVersion')::integer
    or new.program_id is distinct from a.operation->>'programId' or new.need is distinct from a.operation->>'need' or new.artifact_id is not null
    or cardinality(new.document_ids)<>0 or to_jsonb(new.data_categories) is distinct from a.operation->'dataCategories'
    or new.idempotency_key is distinct from a.operation->>'idempotencyKey'
    or (tg_op='INSERT' and (a.state<>'pending' or a.created_xid<>pg_current_xact_id()))
    or (tg_op='UPDATE' and old.state='invalidated' and new.state<>'invalidated') then raise exception 'utility draft is preparation only' using errcode='42501'; end if;
  return new;
end $$;
create trigger parent_utility_prepared_operation before insert or update on public.parent_operations for each row execute function parent_private.guard_utility_prepared_operation();

create function parent_private.wake_utility_preparation(p_request uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.parent_requests where id=p_request for update;
  if not parent_private.current_grant(p_request,p_version) then return; end if;
  update public.parent_operations set state='invalidated',updated_at=now() where request_id=p_request and action='prepare' and packet ? 'protectedUtilityPacket' and state='prepared';
  update public.parent_jobs set state=case when state='leased' then state else 'queued' end,
    run_at=case when state='leased' then run_at else clock_timestamp() end,
    utility_preparation_wake_lease_token=case when state='leased' then lease_token else null end,updated_at=now()
    where request_id=p_request and request_version=p_version and attempts<48 and last_error is distinct from 'delivery_unknown'
      and not exists(select 1 from public.parent_operations o where o.request_id=p_request and o.state='delivery_unknown');
  if found then update public.parent_requests set next_actor='caselink',next_trigger='route_review_required',next_run_at=clock_timestamp(),updated_at=now() where id=p_request; end if;
end $$;
create function parent_private.utility_preparation_input_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare a parent_private.utility_protected_authorizations;
begin
  if tg_table_name='utility_protected_inputs' then
    if new.state<>'stored' or old.state='stored' then return new; end if;
  end if;
  if tg_table_name='utility_protected_authorizations' then
    if new.revoked_at is not distinct from old.revoked_at then return new; end if;
    a:=new;
  else select * into a from parent_private.utility_protected_authorizations where input_id=new.input_id; end if;
  perform parent_private.wake_utility_preparation(a.request_id,a.request_version);
  return new;
end $$;
create trigger utility_preparation_capture_wake after update on parent_private.utility_protected_inputs for each row execute function parent_private.utility_preparation_input_changed();
create trigger utility_preparation_validation_wake after insert on parent_private.utility_protected_validations for each row execute function parent_private.utility_preparation_input_changed();
create trigger utility_preparation_revocation_wake after update on parent_private.utility_protected_authorizations for each row execute function parent_private.utility_preparation_input_changed();

create function parent_private.wake_after_utility_preparation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.state='leased' and new.state in ('waiting','failed','done') and new.attempts<48 and new.request_version=old.request_version
    and old.lease_token is not null and new.utility_preparation_wake_lease_token=old.lease_token and new.last_error is distinct from 'delivery_unknown'
    and parent_private.current_grant(new.request_id,new.request_version)
    and not exists(select 1 from public.parent_operations o where o.request_id=new.request_id and o.state='delivery_unknown') then
    new.state:='queued'; new.run_at:=clock_timestamp(); new.lease_token:=null; new.lease_until:=null; new.utility_preparation_wake_lease_token:=null;
    update public.parent_requests set next_actor='caselink',next_trigger='route_review_required',next_run_at=clock_timestamp(),updated_at=now() where id=new.request_id;
  end if;
  return new;
end $$;
create trigger parent_wake_after_utility_preparation before update on public.parent_jobs for each row execute function parent_private.wake_after_utility_preparation();

create function parent_private.parent_get_utility_preparation_target(p_job uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.parent_jobs; r public.parent_requests; program text; table_name text; snapshot jsonb; scope jsonb; c jsonb;
begin
  select * into job from public.parent_jobs where id=p_job;
  job:=parent_private.require_utility_preparation_lease(p_job,p_lease,job.request_version);
  select * into r from public.parent_requests where id=job.request_id;
  if jsonb_array_length(r.intake->'needs')<>1 or jsonb_array_length(r.mandate->'recipientIds')<>1 then return null; end if;
  program:=r.mandate#>>'{recipientIds,0}';
  table_name:=case program when 'peco-cap' then 'parent_peco_application_details' when 'pgw-crp' then 'parent_pgw_application_details' when 'pwd-tap' then 'parent_water_application_details' end;
  if table_name is null or not exists(select 1 from parent_private.utility_protected_policies p where p.program_id=program and p.enabled and cardinality(p.preparation_versions)>0) then return null; end if;
  execute format('select to_jsonb(s) from public.%I s where request_id=$1 order by revision desc limit 1',table_name) into snapshot using r.id;
  if snapshot is null then return null; end if;
  scope:=jsonb_build_object('requestId',r.id,'expectedVersion',r.version,'programId',program,'snapshotId',snapshot->'id','snapshotRevision',snapshot->'revision','snapshotHash',snapshot#>'{consent_evidence,detailsSha256}');
  c:=parent_private.parent_get_utility_protected_context(r.id,r.version,program,(snapshot->>'id')::uuid,(snapshot->>'revision')::integer,snapshot#>>'{consent_evidence,detailsSha256}');
  perform parent_private.require_utility_preparation_lease(p_job,p_lease,job.request_version);
  return jsonb_build_object('jobId',p_job,'leaseToken',p_lease,'scope',scope,'inputSetHash',parent_private.utility_preparation_input_set(scope));
exception when undefined_table or undefined_function then return null;
end $$;

-- Unknown private HTTP/COMMIT responses reconcile this actual immutable operation before rendering again.
create function parent_private.parent_find_utility_prepared_operation(p_job uuid,p_lease uuid,p_input_set text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target jsonb; a parent_private.utility_prepared_artifacts;
begin
  target:=parent_private.parent_get_utility_preparation_target(p_job,p_lease);
  if target is null or target->>'inputSetHash' is distinct from p_input_set then raise exception 'preparation observation changed' using errcode='42501'; end if;
  select * into a from parent_private.utility_prepared_artifacts where request_id=(target#>>'{scope,requestId}')::uuid
    and (operation->>'requestVersion')::integer=(target#>>'{scope,expectedVersion}')::integer and spec->>'inputSetHash'=p_input_set order by generation desc limit 1;
  if found and parent_private.utility_prepared_current(a.id,true) then
    perform parent_private.require_utility_preparation_lease(p_job,p_lease,(target#>>'{scope,expectedVersion}')::integer); return a.operation;
  end if;
  return null;
end $$;

create or replace function parent_private.parent_get_operations(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if exists(select 1 from public.parent_operations o where o.request_id=v_job.request_id and o.packet ? 'protectedUtilityPacket') then
    v_job:=parent_private.require_utility_preparation_lease(p_job_id,p_lease_token,v_job.request_version);
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('personalActsComplete',parent_private.personal_acts_complete(o),
    'snapSubmissionAuthorized',parent_private.snap_submission_authorized(o.id),
    'protectedParentSubmitReady',case when o.packet ? 'protectedSnapPacket' then parent_private.snap_protected_parent_submit_ready(o) else false end,
    'protectedPacketCurrent',case when o.packet ? 'protectedSnapPacket' then parent_private.snap_protected_packet_current(o)
      when o.packet ? 'protectedUtilityPacket' then parent_private.utility_prepared_current((o.packet#>>'{protectedUtilityPacket,packetId}')::uuid,true) else false end)
    order by o.created_at),'[]') from public.parent_operations o where o.request_id=v_job.request_id);
end $$;

revoke execute on function parent_private.utility_preparation_context(jsonb,boolean),parent_private.utility_prepared_binding(parent_private.utility_prepared_artifacts),parent_private.utility_prepared_aad(jsonb),
  parent_private.utility_prepared_authority(uuid,boolean),parent_private.guard_utility_prepared_artifact(),parent_private.require_sealed_utility_prepared_artifact(),parent_private.delete_utility_prepared_key(),
  parent_private.parent_begin_utility_prepared_artifact(uuid,uuid,jsonb),parent_private.parent_seal_utility_prepared_artifact(uuid,uuid,uuid,bytea,bytea,bytea),
  parent_private.parent_read_utility_prepared_artifact(uuid,uuid,uuid),parent_private.parent_check_utility_prepared_artifact(uuid,uuid,uuid),parent_private.parent_purge_utility_prepared_artifacts(integer),
  parent_private.utility_prepared_current(uuid,boolean),parent_private.parent_get_utility_prepared_operation(uuid,uuid,uuid),parent_private.guard_utility_prepared_operation()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_begin_utility_prepared_artifact(uuid,uuid,jsonb),parent_private.parent_seal_utility_prepared_artifact(uuid,uuid,uuid,bytea,bytea,bytea),
  parent_private.parent_read_utility_prepared_artifact(uuid,uuid,uuid),parent_private.parent_check_utility_prepared_artifact(uuid,uuid,uuid) to parent_utility_protected;
grant execute on function parent_private.parent_purge_utility_prepared_artifacts(integer) to parent_retention_worker;
grant execute on function parent_private.parent_get_utility_prepared_operation(uuid,uuid,uuid) to parent_worker,parent_utility_protected;
revoke execute on function parent_private.utility_preparation_input_set(jsonb),parent_private.wake_utility_preparation(uuid,integer),parent_private.utility_preparation_input_changed(),parent_private.wake_after_utility_preparation(),parent_private.parent_get_utility_preparation_target(uuid,uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_get_utility_preparation_target(uuid,uuid) to parent_worker,parent_utility_protected;
revoke execute on function parent_private.parent_find_utility_prepared_operation(uuid,uuid,text) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_find_utility_prepared_operation(uuid,uuid,text) to parent_utility_protected;
revoke execute on function parent_private.require_utility_preparation_lease(uuid,uuid,integer) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
