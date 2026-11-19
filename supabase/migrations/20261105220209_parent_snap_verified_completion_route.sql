-- Default-closed source authority only. No provider evidence, policy, transport or collection is enabled here.
alter table parent_private.provider_capabilities
  add column snap_direct_completion_version text,
  add column snap_direct_completion_evidence_reference text,
  add constraint parent_snap_direct_completion_method check(
    (snap_direct_completion_version is null and snap_direct_completion_evidence_reference is null)
    or (program_id='snap-pa' and action='submit' and snap_direct_completion_version is not null
      and snap_direct_completion_version='pa600fs-direct-completion-2026-11-05.v1'
      and snap_direct_completion_evidence_reference is not null
      and length(btrim(snap_direct_completion_evidence_reference)) between 1 and 2000));

-- A capability records separately reviewed provider evidence, never evidence inferred from rendered strokes.
create function parent_private.snap_protected_route_verified(p_validator_version text) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from parent_private.provider_capabilities c
    where c.program_id='snap-pa' and c.action='submit' and c.enabled and c.transport_verified and c.requires_form
      and c.verified_until>clock_timestamp() and length(btrim(c.permission_version)) between 1 and 160
      and length(btrim(c.permission_reference)) between 1 and 2000
      and 'protectedSnapPacket'=any(c.allowed_fields) and c.field_categories->>'protectedSnapPacket'='household'
      and c.required_acts is not null and cardinality(c.required_acts)<=20 and array_position(c.required_acts,null) is null
      and (select count(*)=count(distinct act) and coalesce(bool_and(act~'^[a-z][a-z0-9_]{0,99}$'),true) from unnest(c.required_acts) act)
      and (p_validator_version='pa600fs-final-content-2026-11-04.v1'
        or (p_validator_version='pa600fs-direct-completion-2026-11-05.v1'
          and c.snap_direct_completion_version=p_validator_version and c.snap_direct_completion_evidence_reference is not null
          and length(btrim(c.snap_direct_completion_evidence_reference)) between 1 and 2000
          and c.required_acts@>array['applicant_signature_printed_page_1','rights_certification_printed_page_5']::text[])));
$$;
revoke execute on function parent_private.snap_protected_route_verified(text)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;

create or replace function parent_private.snap_direct_acquisition_authority(p_acquisition uuid,p_request uuid,p_version integer,p_snapshot uuid,p_hash text)
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
  if not parent_private.snap_protected_route_verified('pa600fs-direct-completion-2026-11-05.v1')
    then raise exception 'protected SNAP route unavailable' using errcode='42501'; end if;
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

create or replace function parent_private.snap_final_packet_authority(p_authorization uuid,p_request uuid,p_version integer,p_snapshot uuid,p_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a parent_private.snap_final_packet_authorizations; r public.parent_requests; c parent_private.processing_controls; b jsonb; acquisition jsonb; owner_id uuid; subjects uuid[];
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
  if not parent_private.snap_protected_route_verified(case when a.acquisition_authorization_id is null
      then 'pa600fs-final-content-2026-11-04.v1' else 'pa600fs-direct-completion-2026-11-05.v1' end)
    then raise exception 'protected SNAP route unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_application_binding(p_request,p_version,p_snapshot,p_hash);
  if b is null or not parent_private.snap_snapshot_provenance_current(b->'snapshot') then raise exception 'protected SNAP source changed' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects
    from jsonb_array_elements(b#>'{snapshot,details,household}') person where person->>'requestingSnap'='true';
  if subjects is null or (select array_agg(x order by x) from unnest(a.subject_ids) x) is distinct from subjects
    then raise exception 'protected SNAP subject authority changed' using errcode='42501'; end if;
  if a.acquisition_authorization_id is not null then
    acquisition:=parent_private.snap_direct_acquisition_authority(a.acquisition_authorization_id,p_request,p_version,p_snapshot,p_hash);
    if a.authorization_kind is distinct from 'packet'
      or a.consented_at is distinct from (acquisition#>>'{acquisition,consented_at}')::timestamptz
      or a.expires_at>(acquisition->>'expiresAt')::timestamptz
      or a.policy_version is distinct from acquisition#>>'{acquisition,policy_version}'
      or a.retention_policy_version is distinct from acquisition#>>'{acquisition,retention_policy_version}'
      or to_jsonb(a.subject_ids) is distinct from acquisition#>'{acquisition,subject_ids}'
      or a.consent_reference is distinct from acquisition#>>'{acquisition,consent_reference}'
      or a.authority_declaration is distinct from acquisition#>>'{acquisition,authority_declaration}'
      then raise exception 'protected SNAP acquisition changed' using errcode='42501'; end if;
  end if;
  return b||jsonb_build_object('authorization',to_jsonb(a),'ownerId',owner_id,'maxRetentionSeconds',c.snap_protected_max_retention_seconds);
end $$;

create or replace function parent_private.snap_protected_operation_context(p_request uuid,p_version integer,p_packet jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p parent_private.snap_final_packets; v parent_private.snap_final_packet_verifications; b jsonb; r public.parent_requests; c parent_private.provider_capabilities;
begin
  if jsonb_typeof(p_packet) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_packet))<>1
    or jsonb_typeof(p_packet->'protectedSnapPacket') is distinct from 'object'
    then raise exception 'protected SNAP operation unavailable' using errcode='42501'; end if;
  select * into p from parent_private.snap_final_packets where id=(p_packet#>>'{protectedSnapPacket,packetId}')::uuid and request_id=p_request;
  if not found or p.request_version is distinct from p_version or p.state<>'stored' or p.expires_at<=clock_timestamp()
    then raise exception 'protected SNAP operation unavailable' using errcode='42501'; end if;
  select * into v from parent_private.snap_final_packet_verifications where packet_id=p.id;
  if not found or v.id::text is distinct from p_packet#>>'{protectedSnapPacket,verificationId}'
    or not parent_private.snap_protected_route_verified(v.validator_version)
    or v.snapshot_id<>p.snapshot_id or v.snapshot_hash<>p.snapshot_hash or v.content_sha256<>p.content_sha256
    or v.verified_at<p.created_at or v.verified_at>clock_timestamp() or v.expires_at<=clock_timestamp() or v.expires_at>p.expires_at
    or p_packet is distinct from parent_private.snap_protected_operation_packet(p,v)
    then raise exception 'protected SNAP content verification unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_final_packet_authority(p.authorization_id,p_request,p_version,p.snapshot_id,p.snapshot_hash);
  if v.validator_version='pa600fs-direct-completion-2026-11-05.v1'
    and b#>>'{authorization,acquisition_authorization_id}' is null
    then raise exception 'protected SNAP construction authority unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request;
  select * into c from parent_private.provider_capabilities where program_id='snap-pa' and action='submit';
  if v.source is distinct from b#>'{snapshot,source}' or coalesce(b#>>'{snapshot,details,zip}','')!~'^191[0-9]{2}$'
    or r.mandate->>'mode' is distinct from 'full' or not(r.mandate->'allowedActions' ? 'submit')
    or not coalesce(c.enabled and c.transport_verified and c.requires_form and c.verified_until>clock_timestamp(),false)
    or c.required_acts is null or not('protectedSnapPacket'=any(c.allowed_fields)) or c.field_categories->>'protectedSnapPacket' is distinct from 'household'
    or not(array(select jsonb_array_elements_text(b->'dataCategories'))<@array(select value from jsonb_each_text(c.field_categories) where key=any(c.allowed_fields)))
    then raise exception 'protected SNAP execution permission unavailable' using errcode='42501'; end if;
  return jsonb_build_object('packetId',p.id,'verificationId',v.id,'dataCategories',b->'dataCategories','permissionVersion',c.permission_version);
exception when invalid_text_representation then raise exception 'protected SNAP operation unavailable' using errcode='42501';
end $$;
