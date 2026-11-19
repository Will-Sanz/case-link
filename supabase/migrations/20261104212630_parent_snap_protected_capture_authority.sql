-- Metadata authority only. False/NULL policy gates remain unchanged; no collector or submitter is enabled.
alter table parent_private.snap_final_packet_authorizations
  add column packet_id uuid unique,
  add column content_sha256 text,
  add column byte_length integer,
  -- Historical attribution must not prevent Auth session deletion or normal sign-out.
  add column authorization_session_id uuid,
  add column authority_declaration text,
  add constraint parent_snap_capture_intent_complete check(
    (packet_id is null and content_sha256 is null and byte_length is null and authorization_session_id is null and authority_declaration is null)
    or (packet_id is not null and content_sha256 is not null and content_sha256~'^[a-f0-9]{64}$'
      and byte_length is not null and byte_length between 1 and 10485760 and authorization_session_id is not null
      and authority_declaration is not null and authority_declaration='parent_declared_household_data_authority'));

-- Owned current-purpose recovery returns only metadata. It is neither decryption nor historical rights access.
create function public.parent_get_snap_final_packet_authorization(p_request_id uuid,p_packet_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a parent_private.snap_final_packet_authorizations; r public.parent_requests; p parent_private.snap_final_packets; intent jsonb;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected SNAP authorization unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request_id for update;
  select * into a from parent_private.snap_final_packet_authorizations where request_id=p_request_id and packet_id=p_packet_id;
  if not found or not parent_private.owns_request(p_request_id) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid()
      and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp()))
    or a.owner_id is distinct from auth.uid() or p_expected_version is distinct from r.version
    or a.request_version is distinct from p_expected_version or a.packet_id is null
    or a.authority_declaration is distinct from 'parent_declared_household_data_authority'
    then raise exception 'protected SNAP authorization unavailable' using errcode='42501'; end if;
  perform parent_private.snap_final_packet_authority(a.id,a.request_id,a.request_version,a.snapshot_id,a.snapshot_hash);
  p:=jsonb_populate_record(null::parent_private.snap_final_packets,jsonb_build_object(
    'id',a.packet_id,'authorization_id',a.id,'request_id',a.request_id,'owner_id',a.owner_id,'request_version',a.request_version,
    'snapshot_id',a.snapshot_id,'snapshot_hash',a.snapshot_hash,'content_sha256',a.content_sha256,'byte_length',a.byte_length,'expires_at',a.expires_at));
  intent:=parent_private.snap_final_packet_binding(p)-'expiresAt';
  if intent is null then raise exception 'protected SNAP authorization unavailable' using errcode='42501'; end if;
  return jsonb_build_object('intent',intent,'authorizationExpiresAt',to_char(a.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'subjectIds',to_jsonb(a.subject_ids),'authorityDeclaration',a.authority_declaration,
    'consentedAt',to_char(a.consented_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'state',case when exists(select 1 from parent_private.snap_final_packets f where f.id=a.packet_id and f.authorization_id=a.id and f.state='stored') then 'stored' else 'authorized' end);
end $$;

create function public.parent_authorize_snap_final_packet(
  p_request_id uuid,p_expected_version integer,p_snapshot_id uuid,p_snapshot_hash text,p_packet_id uuid,p_content_sha256 text,p_byte_length integer,
  p_policy_version text,p_retention_policy_version text,p_subject_ids uuid[],p_authority_declared boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.parent_requests; c parent_private.processing_controls; a parent_private.snap_final_packet_authorizations;
  b jsonb; subjects uuid[]; declared_subjects uuid[]; recorded_at timestamptz; expires timestamptz;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected SNAP authorization unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request_id for update;
  select * into c from parent_private.processing_controls where singleton;
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid()
      and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp()))
    or p_expected_version is distinct from r.version or not parent_private.current_grant(p_request_id,p_expected_version)
    or c.snap_protected_enabled is distinct from true or c.snap_protected_policy_version is null or c.snap_protected_retention_policy_version is null
    or p_policy_version is distinct from c.snap_protected_policy_version or p_retention_policy_version is distinct from c.snap_protected_retention_policy_version
    then raise exception 'protected SNAP authorization unavailable' using errcode='42501'; end if;
  if p_packet_id is null or p_snapshot_id is null or p_snapshot_hash is null or p_snapshot_hash!~'^[a-f0-9]{64}$'
    or p_content_sha256 is null or p_content_sha256!~'^[a-f0-9]{64}$' or p_byte_length is null or p_byte_length not between 1 and 10485760
    or p_authority_declared is distinct from true or p_subject_ids is null or cardinality(p_subject_ids) not between 1 and 30
    or array_position(p_subject_ids,null) is not null or (select count(*)<>count(distinct s) from unnest(p_subject_ids) s)
    then raise exception 'invalid protected SNAP authorization' using errcode='23514'; end if;
  b:=parent_private.snap_application_binding(p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash);
  if b is null or not parent_private.snap_snapshot_provenance_current(b->'snapshot')
    then raise exception 'protected SNAP authorization unavailable' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects
    from jsonb_array_elements(b#>'{snapshot,details,household}') person where person->>'requestingSnap'='true';
  select array_agg(s order by s) into declared_subjects from unnest(p_subject_ids) s;
  if subjects is null or subjects is distinct from declared_subjects
    then raise exception 'invalid protected SNAP authorization' using errcode='23514'; end if;
  select * into a from parent_private.snap_final_packet_authorizations where packet_id=p_packet_id and request_id=p_request_id and owner_id=auth.uid() for update;
  if found then
    if a.request_id is distinct from p_request_id or a.owner_id is distinct from auth.uid() or a.request_version is distinct from p_expected_version
      or a.snapshot_id is distinct from p_snapshot_id or a.snapshot_hash is distinct from p_snapshot_hash
      or a.content_sha256 is distinct from p_content_sha256 or a.byte_length is distinct from p_byte_length
      or a.subject_ids is distinct from subjects or a.policy_version is distinct from p_policy_version or a.retention_policy_version is distinct from p_retention_policy_version
      or a.authorization_session_id is null or a.authority_declaration is distinct from 'parent_declared_household_data_authority'
      then raise exception 'invalid protected SNAP authorization' using errcode='23514'; end if;
    return public.parent_get_snap_final_packet_authorization(p_request_id,p_packet_id,p_expected_version);
  end if;
  if exists(select 1 from parent_private.snap_final_packets where id=p_packet_id)
    or (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id)>=500
    or (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id and created_at>clock_timestamp()-interval '1 minute')>=20
    then raise exception 'invalid protected SNAP authorization' using errcode='23514'; end if;
  recorded_at:=clock_timestamp();
  expires:=date_trunc('milliseconds',least(c.approved_until,c.snap_details_approved_until,c.snap_protected_approved_until,
    (r.mandate->>'expiresAt')::timestamptz,'2026-12-03T05:00:00Z'::timestamptz,
    recorded_at+make_interval(secs=>c.snap_protected_max_retention_seconds)));
  if c.snap_protected_max_retention_seconds is null or expires is null or expires<=recorded_at
    then raise exception 'protected SNAP authorization unavailable' using errcode='42501'; end if;
  insert into parent_private.snap_final_packet_authorizations(request_id,owner_id,request_version,snapshot_id,snapshot_hash,subject_ids,
    recipient,need,purpose,policy_version,retention_policy_version,consent_reference,consented_at,expires_at,created_at,
    packet_id,content_sha256,byte_length,authorization_session_id,authority_declaration)
  values(p_request_id,auth.uid(),p_expected_version,p_snapshot_id,p_snapshot_hash,subjects,'snap-pa','snap_new','snap_final_application_packet',
    p_policy_version,p_retention_policy_version,'snap-capture:'||p_packet_id::text,recorded_at,expires,recorded_at,
    p_packet_id,p_content_sha256,p_byte_length,nullif(auth.jwt()->>'session_id','')::uuid,'parent_declared_household_data_authority');
  return public.parent_get_snap_final_packet_authorization(p_request_id,p_packet_id,p_expected_version);
exception when unique_violation then raise exception 'invalid protected SNAP authorization' using errcode='23514';
end $$;

-- Unstaged legacy NULL-intent receipts are deliberately denied, never guessed or backfilled.
-- Existing stored evidence keeps the previous restricted read/purge behavior.
create or replace function parent_private.parent_begin_snap_final_packet(p_authorization uuid,p_request uuid,p_version integer,p_snapshot uuid,p_snapshot_hash text,p_content_hash text,p_size integer,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b jsonb; p parent_private.snap_final_packets; key_id uuid; key_text text;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  b:=parent_private.snap_final_packet_authority(p_authorization,p_request,p_version,p_snapshot,p_snapshot_hash);
  if b#>>'{authorization,packet_id}' is null then raise exception 'protected SNAP authority changed' using errcode='42501'; end if;
  if p_key is null or p_content_hash is null or p_content_hash!~'^[a-f0-9]{64}$' or p_size is null or p_size not between 1 and 10485760
    or b#>>'{authorization,packet_id}' is distinct from p_key::text
    or b#>>'{authorization,content_sha256}' is distinct from p_content_hash
    or (b#>>'{authorization,byte_length}')::integer is distinct from p_size
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

revoke execute on function public.parent_get_snap_final_packet_authorization(uuid,uuid,integer),
  public.parent_authorize_snap_final_packet(uuid,integer,uuid,text,uuid,text,integer,text,text,uuid[],boolean)
  from public,anon,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_get_snap_final_packet_authorization(uuid,uuid,integer),
  public.parent_authorize_snap_final_packet(uuid,integer,uuid,text,uuid,text,integer,text,text,uuid[],boolean) to authenticated;
