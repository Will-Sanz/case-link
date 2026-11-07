-- Private staging only. No public consent writer, form-artifact registration or submission activation.
create role parent_snap_finalizer nologin noinherit;
grant usage on schema parent_private to parent_snap_finalizer;

alter table parent_private.processing_controls
  add column snap_protected_enabled boolean not null default false,
  add column snap_protected_approval_reference text,
  add column snap_protected_approved_until timestamptz,
  add column snap_protected_policy_version text,
  add column snap_protected_retention_policy_version text,
  add column snap_protected_max_retention_seconds integer check(snap_protected_max_retention_seconds>0);

-- A future reviewed protected channel must record this exact authority; no runtime writer is granted here.
create table parent_private.snap_final_packet_authorizations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  request_version integer not null check(request_version>0),
  snapshot_id uuid not null references public.parent_snap_application_details(id) on delete cascade,
  snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
  subject_ids uuid[] not null check(cardinality(subject_ids)>0 and array_position(subject_ids,null) is null),
  recipient text not null check(recipient='snap-pa'),
  need text not null check(need='snap_new'),
  purpose text not null check(purpose='snap_final_application_packet'),
  policy_version text not null check(policy_version~'^[a-z0-9][a-z0-9._-]{0,79}$'),
  retention_policy_version text not null check(retention_policy_version~'^[a-z0-9][a-z0-9._-]{0,79}$'),
  consent_reference text not null check(consent_reference~'^[a-zA-Z0-9._:-]{1,160}$'),
  consented_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>consented_at),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table parent_private.snap_final_packets (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references parent_private.snap_final_packet_authorizations(id) on delete cascade,
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  request_version integer not null check(request_version>0),
  snapshot_id uuid not null references public.parent_snap_application_details(id) on delete cascade,
  snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
  content_sha256 text not null check(content_sha256~'^[a-f0-9]{64}$'),
  byte_length integer not null check(byte_length between 1 and 10485760),
  expires_at timestamptz not null,
  idempotency_key uuid not null,
  vault_secret_id uuid not null unique,
  aad bytea not null,
  ciphertext bytea,
  iv bytea,
  tag bytea,
  state text not null default 'pending' check(state in ('pending','stored')),
  operation_id uuid unique references public.parent_operations(id) on delete cascade,
  created_xid xid8 not null default pg_current_xact_id(),
  created_at timestamptz not null default now(),
  unique(request_id,idempotency_key),
  check(id=idempotency_key),
  check((state='pending' and ciphertext is null and iv is null and tag is null) or
    (state='stored' and octet_length(ciphertext)=byte_length and octet_length(iv)=12 and octet_length(tag)=16))
);
alter table parent_private.snap_final_packet_authorizations enable row level security;
alter table parent_private.snap_final_packets enable row level security;
revoke all on parent_private.snap_final_packet_authorizations,parent_private.snap_final_packets
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;

create function parent_private.snap_final_packet_authority(p_authorization uuid,p_request uuid,p_version integer,p_snapshot uuid,p_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a parent_private.snap_final_packet_authorizations; r public.parent_requests; c parent_private.processing_controls; b jsonb; owner_id uuid; subjects uuid[];
begin
  select * into c from parent_private.processing_controls where singleton;
  if not coalesce(c.snap_protected_enabled,false) or not parent_private.processing_enabled()
    or c.approved_until<=clock_timestamp() or not parent_private.snap_details_collection_enabled()
    or c.snap_details_approved_until<=clock_timestamp()
    or length(btrim(coalesce(c.snap_protected_approval_reference,'')))=0 or c.snap_protected_approved_until is null or c.snap_protected_approved_until<=clock_timestamp()
    or c.snap_protected_policy_version is null or c.snap_protected_retention_policy_version is null or c.snap_protected_max_retention_seconds is null
    or clock_timestamp()<'2026-11-03T00:00:00Z'::timestamptz or clock_timestamp()>='2026-12-03T05:00:00Z'::timestamptz
    then raise exception 'protected SNAP staging unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request;
  select h.owner_id into owner_id from public.parent_households h where h.id=r.household_id;
  select * into a from parent_private.snap_final_packet_authorizations where id=p_authorization;
  if not found or not parent_private.current_grant(p_request,p_version) or (r.mandate->>'expiresAt')::timestamptz<=clock_timestamp()
    or a.request_id is distinct from p_request or a.owner_id is distinct from owner_id or a.request_version is distinct from p_version
    or a.snapshot_id is distinct from p_snapshot or a.snapshot_hash is distinct from p_hash
    or a.recipient<>'snap-pa' or a.need<>'snap_new' or a.purpose<>'snap_final_application_packet'
    or a.policy_version is distinct from c.snap_protected_policy_version or a.retention_policy_version is distinct from c.snap_protected_retention_policy_version
    or a.consented_at>clock_timestamp() or a.consented_at>a.created_at or a.expires_at<=clock_timestamp() or a.revoked_at is not null
    then raise exception 'protected SNAP authority changed' using errcode='42501'; end if;
  b:=parent_private.snap_application_binding(p_request,p_version,p_snapshot,p_hash);
  if b is null or not parent_private.snap_snapshot_provenance_current(b->'snapshot') then raise exception 'protected SNAP source changed' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects
    from jsonb_array_elements(b#>'{snapshot,details,household}') person where person->>'requestingSnap'='true';
  if subjects is null or (select array_agg(x order by x) from unnest(a.subject_ids) x) is distinct from subjects
    then raise exception 'protected SNAP subject authority changed' using errcode='42501'; end if;
  return b||jsonb_build_object('authorization',to_jsonb(a),'ownerId',owner_id,'maxRetentionSeconds',c.snap_protected_max_retention_seconds);
end $$;

create function parent_private.snap_final_packet_binding(p parent_private.snap_final_packets) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('format','caselink-snap-final-packet-v1','packetId',p.id,'ownerId',p.owner_id,'requestId',p.request_id,'requestVersion',p.request_version,
    'recipient','snap-pa','need','snap_new','purpose','snap_final_application_packet','authorizationId',p.authorization_id,
    'policyVersion',a.policy_version,'retentionPolicyVersion',a.retention_policy_version,
    'templateId',s.source->>'templateId','templateVersion',s.source->>'templateVersion','templateSha256',s.source->>'templateSha256',
    'snapshotId',p.snapshot_id,'snapshotHash',p.snapshot_hash,'contentSha256',p.content_sha256,'byteLength',p.byte_length,
    'expiresAt',to_char(p.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from parent_private.snap_final_packet_authorizations a join public.parent_snap_application_details s on s.id=p.snapshot_id where a.id=p.authorization_id;
$$;
create function parent_private.snap_final_packet_aad(b jsonb) returns bytea
language sql immutable set search_path='' as $$
  select convert_to(array_to_json(array[b->>'format',b->>'packetId',b->>'ownerId',b->>'requestId',b->>'requestVersion',b->>'recipient',b->>'need',b->>'purpose',
    b->>'authorizationId',b->>'policyVersion',b->>'retentionPolicyVersion',b->>'templateId',b->>'templateVersion',b->>'templateSha256',b->>'snapshotId',b->>'snapshotHash',
    b->>'contentSha256',b->>'byteLength',b->>'expiresAt'])::text,'UTF8');
$$;

create function parent_private.parent_begin_snap_final_packet(p_authorization uuid,p_request uuid,p_version integer,p_snapshot uuid,p_snapshot_hash text,p_content_hash text,p_size integer,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b jsonb; p parent_private.snap_final_packets; key_id uuid; key_text text;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  b:=parent_private.snap_final_packet_authority(p_authorization,p_request,p_version,p_snapshot,p_snapshot_hash);
  if p_key is null or p_content_hash is null or p_content_hash!~'^[a-f0-9]{64}$' or p_size is null or p_size not between 1 and 10485760
    then raise exception 'invalid protected SNAP packet' using errcode='23514'; end if;
  select * into p from parent_private.snap_final_packets where request_id=p_request and idempotency_key=p_key for update;
  if found then
    if p.authorization_id<>p_authorization or p.request_version<>p_version or p.snapshot_id<>p_snapshot or p.snapshot_hash<>p_snapshot_hash
      or p.content_sha256<>p_content_hash or p.byte_length<>p_size or p.state<>'pending' or p.created_xid<>pg_current_xact_id()
      then raise exception 'protected SNAP staging key already used' using errcode='23514'; end if;
  else
    key_id:=vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'));
    insert into parent_private.snap_final_packets(id,authorization_id,request_id,owner_id,request_version,snapshot_id,snapshot_hash,content_sha256,byte_length,expires_at,idempotency_key,vault_secret_id,aad)
      values(p_key,p_authorization,p_request,(b->>'ownerId')::uuid,p_version,p_snapshot,p_snapshot_hash,p_content_hash,p_size,
        date_trunc('milliseconds',least((b#>>'{authorization,expires_at}')::timestamptz,clock_timestamp()+make_interval(secs=>(b->>'maxRetentionSeconds')::integer))),p_key,key_id,''::bytea) returning * into p;
    update parent_private.snap_final_packets set aad=parent_private.snap_final_packet_aad(parent_private.snap_final_packet_binding(p)) where id=p.id returning * into p;
  end if;
  select decrypted_secret into key_text from vault.decrypted_secrets where id=p.vault_secret_id;
  if key_text is null or octet_length(decode(key_text,'base64'))<>32 then raise exception 'protected SNAP key unavailable' using errcode='42501'; end if;
  return jsonb_build_object('binding',parent_private.snap_final_packet_binding(p),'aad',encode(p.aad,'base64'),'keyBase64',key_text);
exception when others then raise exception 'protected SNAP staging failed' using errcode=sqlstate;
end $$;

create function parent_private.parent_seal_snap_final_packet(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid,p_iv bytea,p_tag bytea,p_ciphertext bytea) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request for update;
  if not found or p.request_version is distinct from p_version or p.authorization_id is distinct from p_authorization or p.created_xid<>pg_current_xact_id()
    or p.expires_at<=clock_timestamp() then raise exception 'protected SNAP staging unavailable' using errcode='42501'; end if;
  perform parent_private.snap_final_packet_authority(p.authorization_id,p.request_id,p.request_version,p.snapshot_id,p.snapshot_hash);
  if p_iv is null or p_tag is null or p_ciphertext is null or octet_length(p_iv)<>12 or octet_length(p_tag)<>16 or octet_length(p_ciphertext)<>p.byte_length
    then raise exception 'invalid protected SNAP encryption' using errcode='23514'; end if;
  if p.state='stored' then
    if (p.iv,p.tag,p.ciphertext) is distinct from (p_iv,p_tag,p_ciphertext) then raise exception 'protected SNAP packet is immutable' using errcode='23514'; end if;
  else
    update parent_private.snap_final_packets set iv=p_iv,tag=p_tag,ciphertext=p_ciphertext,state='stored' where id=p.id returning * into p;
  end if;
  return parent_private.snap_final_packet_binding(p);
end $$;

create function parent_private.parent_read_snap_final_packet(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid,p_snapshot uuid,p_snapshot_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets; key_text text;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request for update;
  if not found or p.request_version is distinct from p_version or p.authorization_id is distinct from p_authorization or p.snapshot_id is distinct from p_snapshot
    or p.snapshot_hash is distinct from p_snapshot_hash or p.state<>'stored' or p.expires_at<=clock_timestamp()
    then raise exception 'protected SNAP packet unavailable' using errcode='42501'; end if;
  perform parent_private.snap_final_packet_authority(p.authorization_id,p.request_id,p.request_version,p.snapshot_id,p.snapshot_hash);
  select decrypted_secret into key_text from vault.decrypted_secrets where id=p.vault_secret_id;
  if key_text is null or octet_length(decode(key_text,'base64'))<>32 then raise exception 'protected SNAP key unavailable' using errcode='42501'; end if;
  return jsonb_build_object('binding',parent_private.snap_final_packet_binding(p),'aad',encode(p.aad,'base64'),'keyBase64',key_text,
    'iv',encode(p.iv,'base64'),'tag',encode(p.tag,'base64'),'ciphertext',encode(p.ciphertext,'base64'));
exception when others then raise exception 'protected SNAP retrieval failed' using errcode=sqlstate;
end $$;

-- Association only: no public artifact, execution permission, personal act or parent Submit is created.
create function parent_private.parent_bind_snap_final_packet(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid,p_operation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets; o public.parent_operations;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request for update;
  if not found or p.request_version is distinct from p_version or p.authorization_id is distinct from p_authorization or p.state<>'stored' or p.expires_at<=clock_timestamp()
    then raise exception 'protected SNAP packet unavailable' using errcode='42501'; end if;
  perform parent_private.snap_final_packet_authority(p.authorization_id,p.request_id,p.request_version,p.snapshot_id,p.snapshot_hash);
  select * into o from public.parent_operations where id=p_operation for update;
  if not found or o.request_id<>p_request or o.request_version<>p_version or o.need<>'snap_new' or o.program_id<>'snap-pa' or o.action<>'submit' or o.state<>'prepared'
    or o.executed_at is not null or (p.operation_id is not null and p.operation_id<>p_operation)
    or not parent_private.operation_allowed(o.request_id,o.request_version,o.program_id,o.action,o.data_categories,o.document_ids,o.packet,o.need)
    or o.permission_version is distinct from (select permission_version from parent_private.provider_capabilities where program_id='snap-pa' and action='submit')
    or exists(select 1 from public.parent_form_artifacts f where f.id=o.artifact_id and
      (f.preparation_only or f.snap_snapshot_id is not null or f.content_sha256<>p.content_sha256 or f.request_id<>p.request_id or f.request_version<>p.request_version))
    then raise exception 'protected SNAP operation changed' using errcode='42501'; end if;
  update parent_private.snap_final_packets set operation_id=p_operation where id=p.id;
  return p_operation;
end $$;

create function parent_private.guard_snap_final_packet() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.authorization_id,new.request_id,new.owner_id,new.request_version,new.snapshot_id,new.snapshot_hash,new.content_sha256,new.byte_length,new.expires_at,new.idempotency_key,new.vault_secret_id,new.created_xid,new.created_at)
    is distinct from (old.id,old.authorization_id,old.request_id,old.owner_id,old.request_version,old.snapshot_id,old.snapshot_hash,old.content_sha256,old.byte_length,old.expires_at,old.idempotency_key,old.vault_secret_id,old.created_xid,old.created_at)
    or (old.aad<>''::bytea and new.aad<>old.aad)
    or (old.state='stored' and (new.state,new.iv,new.tag,new.ciphertext) is distinct from (old.state,old.iv,old.tag,old.ciphertext))
    or (old.operation_id is not null and new.operation_id is distinct from old.operation_id)
    then raise exception 'protected SNAP packet is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger parent_snap_final_packet_immutable before update on parent_private.snap_final_packets for each row execute function parent_private.guard_snap_final_packet();
create function parent_private.require_sealed_snap_final_packet() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from parent_private.snap_final_packets where id=new.id and state<>'stored') then raise exception 'protected SNAP packet must seal in its creation transaction' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger parent_snap_final_packet_sealed after insert or update on parent_private.snap_final_packets deferrable initially deferred
  for each row execute function parent_private.require_sealed_snap_final_packet();
create function parent_private.delete_snap_final_packet_key() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from vault.secrets where id=old.vault_secret_id;
  return old;
end $$;
create trigger parent_snap_final_packet_key_cleanup before delete on parent_private.snap_final_packets for each row execute function parent_private.delete_snap_final_packet_key();

create function parent_private.parent_purge_snap_final_packets(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare p record; request_row record; removed integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid protected cleanup limit' using errcode='23514'; end if;
  for request_row in select r.id from public.parent_requests r where exists(
    select 1 from parent_private.snap_final_packets f join public.parent_accounts a on a.id=f.owner_id join parent_private.snap_final_packet_authorizations c on c.id=f.authorization_id
    where f.request_id=r.id and (f.expires_at<=clock_timestamp() or a.status='deletion_requested'
      or exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||f.owner_id::text,'UTF8')),'hex'))
      or (not exists(select 1 from public.parent_operations o where o.id=f.operation_id and o.executed_at is not null) and
        (r.version<>f.request_version or r.status in ('cancelled','paused') or r.mandate_revoked_at is not null or c.revoked_at is not null or c.expires_at<=clock_timestamp()))))
    order by r.id for update of r skip locked limit p_limit
  loop
    for p in select f.id from parent_private.snap_final_packets f join public.parent_requests r on r.id=f.request_id
      join public.parent_accounts a on a.id=f.owner_id join parent_private.snap_final_packet_authorizations c on c.id=f.authorization_id
      where f.request_id=request_row.id and (f.expires_at<=clock_timestamp() or a.status='deletion_requested'
        or exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||f.owner_id::text,'UTF8')),'hex'))
        or (not exists(select 1 from public.parent_operations o where o.id=f.operation_id and o.executed_at is not null) and
          (r.version<>f.request_version or r.status in ('cancelled','paused') or r.mandate_revoked_at is not null or c.revoked_at is not null or c.expires_at<=clock_timestamp())))
      order by f.expires_at,f.id for update of f skip locked limit p_limit-removed
    loop
      delete from parent_private.snap_final_packets where id=p.id;
      removed:=removed+1;
    end loop;
    exit when removed>=p_limit;
  end loop;
  return removed;
end $$;

create function parent_private.immutable_snap_packet_authorization() returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at') or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
    then raise exception 'protected SNAP authority is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger parent_snap_packet_authorization_immutable before update on parent_private.snap_final_packet_authorizations for each row execute function parent_private.immutable_snap_packet_authorization();

revoke execute on function parent_private.snap_final_packet_authority(uuid,uuid,integer,uuid,text),parent_private.snap_final_packet_binding(parent_private.snap_final_packets),parent_private.snap_final_packet_aad(jsonb),
  parent_private.parent_begin_snap_final_packet(uuid,uuid,integer,uuid,text,text,integer,uuid),parent_private.parent_seal_snap_final_packet(uuid,uuid,integer,uuid,bytea,bytea,bytea),
  parent_private.parent_read_snap_final_packet(uuid,uuid,integer,uuid,uuid,text),parent_private.parent_bind_snap_final_packet(uuid,uuid,integer,uuid,uuid),
  parent_private.guard_snap_final_packet(),parent_private.require_sealed_snap_final_packet(),parent_private.delete_snap_final_packet_key(),parent_private.parent_purge_snap_final_packets(integer),parent_private.immutable_snap_packet_authorization()
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function parent_private.parent_begin_snap_final_packet(uuid,uuid,integer,uuid,text,text,integer,uuid),parent_private.parent_seal_snap_final_packet(uuid,uuid,integer,uuid,bytea,bytea,bytea),
  parent_private.parent_read_snap_final_packet(uuid,uuid,integer,uuid,uuid,text),parent_private.parent_bind_snap_final_packet(uuid,uuid,integer,uuid,uuid)
  to parent_snap_finalizer;
grant execute on function parent_private.parent_purge_snap_final_packets(integer) to parent_retention_worker;
