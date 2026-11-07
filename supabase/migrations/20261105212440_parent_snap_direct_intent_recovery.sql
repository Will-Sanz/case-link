-- Fail on ambiguous history; never choose or delete a competing immutable direct intent.
create unique index parent_snap_one_direct_intent_per_version
  on parent_private.snap_final_packet_authorizations(request_id,request_version)
  where authorization_kind='packet' and acquisition_authorization_id is not null;

-- NULL means no registered linked intent, not proof of missing storage or non-delivery.
create function public.parent_get_snap_current_direct_packet(p_request_id uuid,p_expected_version integer,p_snapshot_id uuid,p_snapshot_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; packets uuid[];
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected SNAP recovery unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid()
    and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP recovery unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_direct_acquisition_authority(null,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash);
  if b->'acquisition'='null'::jsonb then raise exception 'protected SNAP recovery unavailable' using errcode='42501'; end if;
  select array_agg(a.packet_id) into packets from parent_private.snap_final_packet_authorizations a
    where a.request_id=p_request_id and a.request_version=p_expected_version
      and a.authorization_kind='packet' and a.acquisition_authorization_id is not null;
  if coalesce(cardinality(packets),0)>1 then raise exception 'ambiguous protected SNAP intent' using errcode='23514'; end if;
  if packets is null then return null; end if;
  return public.parent_get_snap_direct_packet_authorization(p_request_id,packets[1],p_expected_version);
end $$;

create or replace function public.parent_authorize_snap_direct_packet(p_request_id uuid,p_expected_version integer,p_snapshot_id uuid,p_snapshot_hash text,
  p_packet_id uuid,p_content_sha256 text,p_byte_length integer,p_acquisition_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; a parent_private.snap_final_packet_authorizations; existing parent_private.snap_final_packet_authorizations;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp()))
    or p_acquisition_id is null then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_direct_acquisition_authority(p_acquisition_id,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash);
  a:=jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,b->'acquisition');
  if p_packet_id is null or p_content_sha256 is null or p_content_sha256!~'^[a-f0-9]{64}$' or p_byte_length is null or p_byte_length not between 1 and 10485760
    then raise exception 'invalid protected SNAP packet' using errcode='23514'; end if;
  select * into existing from parent_private.snap_final_packet_authorizations where request_id=p_request_id and owner_id=auth.uid() and packet_id=p_packet_id for update;
  if found then
    if existing.acquisition_authorization_id is distinct from a.id or existing.request_version is distinct from p_expected_version or existing.snapshot_id is distinct from p_snapshot_id
      or existing.snapshot_hash is distinct from p_snapshot_hash or existing.content_sha256 is distinct from p_content_sha256 or existing.byte_length is distinct from p_byte_length
      then raise exception 'invalid protected SNAP packet' using errcode='23514'; end if;
    return public.parent_get_snap_direct_packet_authorization(p_request_id,p_packet_id,p_expected_version);
  end if;
  if exists(select 1 from parent_private.snap_final_packet_authorizations x where x.request_id=p_request_id and x.request_version=p_expected_version
      and x.authorization_kind='packet' and x.acquisition_authorization_id is not null)
    or exists(select 1 from public.parent_jobs j where j.request_id=p_request_id and j.request_version=p_expected_version
      and j.snap_packet_id is not null and j.snap_packet_id is distinct from p_packet_id)
    then raise exception 'request changed; reload before registering another SNAP intent' using errcode='40001'; end if;
  if exists(select 1 from parent_private.snap_final_packets where id=p_packet_id)
    or (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id)>=500
    or (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id and created_at>clock_timestamp()-interval '1 minute')>=20
    then raise exception 'invalid protected SNAP packet' using errcode='23514'; end if;
  insert into parent_private.snap_final_packet_authorizations(request_id,owner_id,request_version,snapshot_id,snapshot_hash,subject_ids,recipient,need,purpose,
    policy_version,retention_policy_version,consent_reference,consented_at,expires_at,created_at,packet_id,content_sha256,byte_length,authorization_session_id,authority_declaration,acquisition_authorization_id)
  values(p_request_id,auth.uid(),p_expected_version,p_snapshot_id,p_snapshot_hash,a.subject_ids,a.recipient,a.need,a.purpose,a.policy_version,a.retention_policy_version,
    a.consent_reference,a.consented_at,(b->>'expiresAt')::timestamptz,clock_timestamp(),p_packet_id,p_content_sha256,p_byte_length,
    nullif(auth.jwt()->>'session_id','')::uuid,a.authority_declaration,a.id);
  return public.parent_get_snap_direct_packet_authorization(p_request_id,p_packet_id,p_expected_version);
exception when unique_violation then raise exception 'invalid protected SNAP packet' using errcode='23514';
end $$;

-- A blocked unsealed intent still needs an owned metadata locator for correction; this never claims a file exists.
create or replace function public.parent_get_snap_current_capture(p_request uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.parent_jobs; available boolean; packets uuid[];
begin
  if not parent_private.owns_request(p_request) then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request for update;
  if not parent_private.owns_request(p_request) or not parent_private.current_grant(p_request,p_version)
    or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid
      and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  select * into j from public.parent_jobs where request_id=p_request and request_version=p_version;
  if j.snap_packet_id is null then
    select array_agg(a.packet_id),bool_and(a.owner_id=auth.uid()) into packets,available from parent_private.snap_final_packet_authorizations a
      where a.request_id=p_request and a.request_version=p_version
        and a.authorization_kind='packet' and a.acquisition_authorization_id is not null;
    if coalesce(cardinality(packets),0)>1 then raise exception 'ambiguous protected SNAP intent' using errcode='23514'; end if;
    if packets is null then return null; end if;
    if available is distinct from true then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
    return jsonb_build_object('packetId',packets[1],'requestVersion',p_version,'state','unavailable','reason','permission_or_file_unavailable');
  end if;
  available:=parent_private.snap_capture_current(p_request,p_version,j.snap_packet_id);
  return jsonb_build_object('packetId',j.snap_packet_id,'requestVersion',j.request_version,
    'state',case when available then j.snap_capture_state else 'unavailable' end,
    'reason',case when available then j.snap_capture_reason else 'permission_or_file_unavailable' end);
end $$;

-- The same correction CAS also handles an exact registered intent whose private construction is still unconfirmed.
create or replace function public.parent_replace_snap_personal_pages(p_request uuid,p_version integer,p_previous_packet uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.parent_requests; j public.parent_jobs;
begin
  if not parent_private.owns_request(p_request) then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request for update;
  select * into j from public.parent_jobs where request_id=p_request for update;
  if not parent_private.owns_request(p_request) or not parent_private.current_grant(p_request,r.version)
    or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid
      and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  if p_previous_packet is null or p_version is null or p_version not between 1 and 2147483646 then raise exception 'invalid private SNAP correction' using errcode='23514'; end if;
  if r.version=p_version+1 and exists(select 1 from public.parent_events e where e.request_id=p_request and e.kind='snap_application.personal_pages_replaced'
    and e.evidence=jsonb_build_object('previousPacketId',p_previous_packet,'fromVersion',p_version,'requestVersion',r.version)) then return r.version; end if;
  if r.version is distinct from p_version or j.request_version is distinct from p_version
    or (j.snap_packet_id is distinct from p_previous_packet and not(j.snap_packet_id is null and exists(
      select 1 from parent_private.snap_final_packet_authorizations a where a.request_id=p_request and a.owner_id=auth.uid()
        and a.request_version=p_version and a.packet_id=p_previous_packet and a.authorization_kind='packet' and a.acquisition_authorization_id is not null)))
    then raise exception 'request changed; reload before replacing pages' using errcode='40001'; end if;
  if exists(select 1 from public.parent_operations o where o.request_id=p_request and o.need='snap_new' and o.action='submit'
      and (o.executed_at is not null or o.state in ('executing','delivery_unknown','sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved')))
    then raise exception 'the previous SNAP attempt must be reconciled before replacing its application' using errcode='23514'; end if;
  perform parent_private.snap_application_binding(p_request,p_version);
  perform parent_private.invalidate_work(p_request,'You replaced the private SNAP pages. Earlier file references remain in history; queued work must use the corrected version.');
  update public.parent_requests set version=version+1,plan=null,required_actions='[]',updated_at=clock_timestamp() where id=p_request;
  update public.parent_jobs set state='queued',request_version=p_version+1,run_at=clock_timestamp(),lease_token=null,lease_until=null,last_error=null,updated_at=clock_timestamp() where request_id=p_request;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request,'snap_application.personal_pages_replaced','parent',
    'You chose to replace the private application pages. Your saved answers were reused without renewing their dates.',
    jsonb_build_object('previousPacketId',p_previous_packet,'fromVersion',p_version,'requestVersion',p_version+1));
  return p_version+1;
end $$;

revoke execute on function public.parent_get_snap_current_direct_packet(uuid,integer,uuid,text)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_get_snap_current_direct_packet(uuid,integer,uuid,text) to authenticated;
