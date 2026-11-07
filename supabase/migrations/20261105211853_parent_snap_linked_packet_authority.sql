-- Every metadata/key route honors the linked pre-entry grant; unlinked binary packet authority is unchanged.
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
