-- Closed authority metadata only. No collector, handler switch, policy publication or processing activation.
alter table parent_private.snap_final_packet_authorizations
  add column authorization_kind text not null default 'packet' check(authorization_kind in ('packet','direct_entry')),
  add column acquisition_authorization_id uuid references parent_private.snap_final_packet_authorizations(id) on delete cascade,
  drop constraint parent_snap_capture_intent_complete,
  add constraint parent_snap_capture_intent_complete check(
    (authorization_kind='packet' and
      ((packet_id is null and content_sha256 is null and byte_length is null and authorization_session_id is null and authority_declaration is null)
       or (packet_id is not null and content_sha256 is not null and content_sha256~'^[a-f0-9]{64}$'
         and byte_length is not null and byte_length between 1 and 10485760 and authorization_session_id is not null
         and authority_declaration is not null and authority_declaration='parent_declared_household_data_authority'))
      and (acquisition_authorization_id is null or (packet_id is not null and acquisition_authorization_id<>id)))
    or (authorization_kind='direct_entry' and acquisition_authorization_id is null and packet_id is null and content_sha256 is null and byte_length is null
      and authorization_session_id is not null and authority_declaration is not null and authority_declaration='parent_declared_household_data_authority'));
create index parent_snap_direct_entry_lookup on parent_private.snap_final_packet_authorizations(request_id,consented_at,id) where authorization_kind='direct_entry';
create index parent_snap_acquisition_children on parent_private.snap_final_packet_authorizations(acquisition_authorization_id) where acquisition_authorization_id is not null;

-- A NULL grant asks for current scope/permission metadata only; it never authorizes acquisition.
create function parent_private.snap_direct_acquisition_authority(p_acquisition uuid,p_request uuid,p_version integer,p_snapshot uuid,p_hash text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a parent_private.snap_final_packet_authorizations; r public.parent_requests; c parent_private.processing_controls;
  b jsonb; v_owner uuid; subjects uuid[]; expires timestamptz;
begin
  select * into c from parent_private.processing_controls where singleton;
  if not coalesce(c.snap_protected_enabled,false) or not parent_private.processing_enabled()
    or c.approved_until<=clock_timestamp() or not parent_private.snap_details_collection_enabled() or c.snap_details_approved_until<=clock_timestamp()
    or length(btrim(coalesce(c.snap_protected_approval_reference,'')))=0 or c.snap_protected_approved_until is null or c.snap_protected_approved_until<=clock_timestamp()
    or c.snap_protected_policy_version is null or c.snap_protected_retention_policy_version is null or c.snap_protected_max_retention_seconds is null
    or clock_timestamp()<'2026-11-03T00:00:00Z'::timestamptz or clock_timestamp()>='2026-12-03T05:00:00Z'::timestamptz
    then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request;
  select h.owner_id into v_owner from public.parent_households h where h.id=r.household_id;
  if p_version is null or p_snapshot is null or p_hash is null or not parent_private.current_grant(p_request,p_version)
    or (r.mandate->>'expiresAt')::timestamptz<=clock_timestamp()
    then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_application_binding(p_request,p_version,p_snapshot,p_hash);
  if b is null or not parent_private.snap_snapshot_provenance_current(b->'snapshot')
    or jsonb_array_length(b#>'{snapshot,details,household}')>8
    or jsonb_array_length(coalesce(b#>'{snapshot,details,income,entries}','[]'::jsonb))>5
    or b#>'{snapshot,details,authorizedRepresentative}' is not null
    or exists(select 1 from jsonb_array_elements(b#>'{snapshot,details,household}') person where person->>'requestingSnap'='true' and person->>'citizen' is distinct from 'true')
    then raise exception 'protected SNAP acquisition route unavailable' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects
    from jsonb_array_elements(b#>'{snapshot,details,household}') person where person->>'requestingSnap'='true';
  if subjects is null then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  if p_acquisition is null then
    select x.* into a from parent_private.snap_final_packet_authorizations x join public.parent_snap_application_details original on original.id=x.snapshot_id
      where x.request_id=p_request and x.owner_id=v_owner and x.authorization_kind='direct_entry'
        and x.subject_ids=subjects and x.recipient='snap-pa' and x.need='snap_new' and x.purpose='snap_final_application_packet'
        and x.policy_version=c.snap_protected_policy_version and x.retention_policy_version=c.snap_protected_retention_policy_version
        and x.revoked_at is null and x.expires_at>clock_timestamp() and x.consented_at<=clock_timestamp()
        and original.source=b#>'{snapshot,source}' order by x.consented_at,x.id limit 1;
  else
    select x.* into a from parent_private.snap_final_packet_authorizations x where x.id=p_acquisition and x.request_id=p_request and x.owner_id=v_owner and x.authorization_kind='direct_entry';
    if not found then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  end if;
  if a.id is not null and (a.owner_id is distinct from v_owner or a.request_id is distinct from p_request
    or a.authorization_kind<>'direct_entry' or a.acquisition_authorization_id is not null or a.packet_id is not null
    or a.subject_ids is distinct from subjects or a.recipient<>'snap-pa' or a.need<>'snap_new' or a.purpose<>'snap_final_application_packet'
    or a.policy_version is distinct from c.snap_protected_policy_version or a.retention_policy_version is distinct from c.snap_protected_retention_policy_version
    or a.authorization_session_id is null or a.authority_declaration is distinct from 'parent_declared_household_data_authority'
    or a.revoked_at is not null or a.expires_at<=clock_timestamp() or a.consented_at>clock_timestamp() or a.consented_at>a.created_at
    or not exists(select 1 from public.parent_snap_application_details original where original.id=a.snapshot_id and original.request_id=p_request and original.source=b#>'{snapshot,source}'))
    then raise exception 'protected SNAP acquisition changed' using errcode='42501'; end if;
  expires:=date_trunc('milliseconds',least(c.approved_until,c.snap_details_approved_until,c.snap_protected_approved_until,
    (r.mandate->>'expiresAt')::timestamptz,'2026-12-03T05:00:00Z'::timestamptz,
    a.expires_at,coalesce(a.consented_at,clock_timestamp())+make_interval(secs=>c.snap_protected_max_retention_seconds)));
  if expires is null or expires<=clock_timestamp() then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  return b||jsonb_build_object('acquisition',case when a.id is null then null else to_jsonb(a) end,'ownerId',v_owner,'expiresAt',expires,
    'metadata',jsonb_build_object('state',case when a.id is null then 'permission_needed' else 'authorized' end,
      'acquisitionId',a.id,'ownerId',v_owner,'requestId',p_request,'requestVersion',p_version,'snapshotId',p_snapshot,'snapshotHash',p_hash,
      'recipient','snap-pa','need','snap_new','purpose','snap_final_application_packet','method','pa600fs-direct-completion-2026-11-05.v1',
      'fieldScope',jsonb_build_array('applicant_ssn','applicant_signature_printed_page_1','applicant_signature_date_printed_page_1','rights_certification_printed_page_5','rights_certification_date_printed_page_5'),
      'source',b#>'{snapshot,source}','subjectIds',to_jsonb(subjects),'policyVersion',c.snap_protected_policy_version,'retentionPolicyVersion',c.snap_protected_retention_policy_version,
      'authorityDeclaration',a.authority_declaration,'consentedAt',case when a.id is null then null else to_char(a.consented_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'expiresAt',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end $$;

create function public.parent_get_snap_direct_acquisition(p_request_id uuid,p_expected_version integer,p_snapshot_id uuid,p_snapshot_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  return parent_private.snap_direct_acquisition_authority(null,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash)->'metadata';
end $$;

create function public.parent_authorize_snap_direct_acquisition(p_request_id uuid,p_expected_version integer,p_snapshot_id uuid,p_snapshot_hash text,
  p_acquisition_id uuid,p_policy_version text,p_retention_policy_version text,p_subject_ids uuid[],p_authority_declared boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; a parent_private.snap_final_packet_authorizations; subjects uuid[]; recorded_at timestamptz;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_direct_acquisition_authority(null,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash);
  select array_agg(x order by x) into subjects from unnest(p_subject_ids) x;
  if p_acquisition_id is null or p_policy_version is distinct from b#>>'{metadata,policyVersion}' or p_retention_policy_version is distinct from b#>>'{metadata,retentionPolicyVersion}'
    or p_authority_declared is distinct from true or p_subject_ids is null or cardinality(p_subject_ids) not between 1 and 30 or array_position(p_subject_ids,null) is not null
    or cardinality(p_subject_ids)<>(select count(distinct x) from unnest(p_subject_ids) x)
    or to_jsonb(subjects) is distinct from b#>'{metadata,subjectIds}'
    then raise exception 'invalid protected SNAP acquisition' using errcode='23514'; end if;
  if exists(select 1 from parent_private.snap_final_packet_authorizations x where x.id=p_acquisition_id and (x.request_id<>p_request_id or x.owner_id<>auth.uid() or x.authorization_kind<>'direct_entry'))
    then raise exception 'invalid protected SNAP acquisition' using errcode='23514'; end if;
  select * into a from parent_private.snap_final_packet_authorizations where id=p_acquisition_id and request_id=p_request_id and owner_id=auth.uid() and authorization_kind='direct_entry' for update;
  if found then return parent_private.snap_direct_acquisition_authority(a.id,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash)->'metadata'; end if;
  if b->'acquisition'<>'null'::jsonb then return b->'metadata'; end if;
  if (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id)>=500
    or (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id and created_at>clock_timestamp()-interval '1 minute')>=20
    then raise exception 'invalid protected SNAP acquisition' using errcode='23514'; end if;
  recorded_at:=clock_timestamp();
  insert into parent_private.snap_final_packet_authorizations(id,request_id,owner_id,request_version,snapshot_id,snapshot_hash,subject_ids,
    recipient,need,purpose,policy_version,retention_policy_version,consent_reference,consented_at,expires_at,created_at,authorization_session_id,authority_declaration,authorization_kind)
  values(p_acquisition_id,p_request_id,auth.uid(),p_expected_version,p_snapshot_id,p_snapshot_hash,subjects,'snap-pa','snap_new','snap_final_application_packet',
    p_policy_version,p_retention_policy_version,'snap-direct-entry:'||p_acquisition_id::text,recorded_at,(b->>'expiresAt')::timestamptz,recorded_at,
    nullif(auth.jwt()->>'session_id','')::uuid,'parent_declared_household_data_authority','direct_entry');
  return parent_private.snap_direct_acquisition_authority(p_acquisition_id,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash)->'metadata';
exception when unique_violation then raise exception 'invalid protected SNAP acquisition' using errcode='23514';
end $$;

-- Withdrawal reduces authority only; it must not depend on processing approval, mandate or new-enrollment gates.
create function public.parent_revoke_snap_direct_acquisition(p_request_id uuid,p_acquisition_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a parent_private.snap_final_packet_authorizations;
begin
  perform 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id
    where r.id=p_request_id and h.owner_id=auth.uid() for update of r;
  if not found then raise exception 'protected SNAP withdrawal unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id
    join public.parent_accounts p on p.id=h.owner_id join auth.users u on u.id=p.id join auth.sessions s on s.user_id=u.id
    where r.id=p_request_id and h.owner_id=auth.uid() and p.status='active'
      and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||p.id::text,'UTF8')),'hex'))
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<clock_timestamp())
      and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp())
      and (not exists(select 1 from public.app_users x where x.id=u.id) or public.has_password_session()))
    then raise exception 'protected SNAP withdrawal unavailable' using errcode='42501'; end if;
  select * into a from parent_private.snap_final_packet_authorizations where id=p_acquisition_id and request_id=p_request_id and owner_id=auth.uid() and authorization_kind='direct_entry' for update;
  if not found then return; end if;
  update parent_private.snap_final_packet_authorizations set revoked_at=coalesce(revoked_at,clock_timestamp())
    where id=a.id or (acquisition_authorization_id=a.id and request_id=p_request_id and owner_id=auth.uid());
end $$;

create function public.parent_get_snap_direct_packet_authorization(p_request_id uuid,p_packet_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; a parent_private.snap_final_packet_authorizations; b jsonb;
begin
  result:=public.parent_get_snap_final_packet_authorization(p_request_id,p_packet_id,p_expected_version);
  select * into a from parent_private.snap_final_packet_authorizations where request_id=p_request_id and packet_id=p_packet_id and owner_id=auth.uid();
  if not found or a.authorization_kind<>'packet' or a.acquisition_authorization_id is null then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_direct_acquisition_authority(a.acquisition_authorization_id,p_request_id,p_expected_version,a.snapshot_id,a.snapshot_hash);
  if a.consented_at is distinct from (b#>>'{acquisition,consented_at}')::timestamptz or a.expires_at>(b#>>'{acquisition,expires_at}')::timestamptz
    or a.policy_version is distinct from b#>>'{acquisition,policy_version}' or a.retention_policy_version is distinct from b#>>'{acquisition,retention_policy_version}'
    or to_jsonb(a.subject_ids) is distinct from b#>'{acquisition,subject_ids}'
    then raise exception 'protected SNAP acquisition changed' using errcode='42501'; end if;
  return result;
end $$;

create function public.parent_authorize_snap_direct_packet(p_request_id uuid,p_expected_version integer,p_snapshot_id uuid,p_snapshot_hash text,
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

revoke execute on function parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text),
  public.parent_get_snap_direct_acquisition(uuid,integer,uuid,text),
  public.parent_authorize_snap_direct_acquisition(uuid,integer,uuid,text,uuid,text,text,uuid[],boolean),
  public.parent_revoke_snap_direct_acquisition(uuid,uuid),public.parent_get_snap_direct_packet_authorization(uuid,uuid,integer),
  public.parent_authorize_snap_direct_packet(uuid,integer,uuid,text,uuid,text,integer,uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_get_snap_direct_acquisition(uuid,integer,uuid,text),
  public.parent_authorize_snap_direct_acquisition(uuid,integer,uuid,text,uuid,text,text,uuid[],boolean),
  public.parent_revoke_snap_direct_acquisition(uuid,uuid),public.parent_get_snap_direct_packet_authorization(uuid,uuid,integer),
  public.parent_authorize_snap_direct_packet(uuid,integer,uuid,text,uuid,text,integer,uuid) to authenticated;
