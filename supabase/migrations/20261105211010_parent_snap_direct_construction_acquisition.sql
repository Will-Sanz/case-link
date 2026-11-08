-- Direct construction requires the informed pre-entry grant; legacy binary packet authority is unchanged.
create or replace function parent_private.parent_get_snap_direct_context(
  p_authorization uuid,p_request uuid,p_version integer,p_snapshot uuid,p_snapshot_hash text,p_content_hash text,p_size integer,p_packet uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; acquisition jsonb; p parent_private.snap_final_packets; a parent_private.snap_final_packet_authorizations;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  b:=parent_private.snap_final_packet_authority(p_authorization,p_request,p_version,p_snapshot,p_snapshot_hash);
  a:=jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,b->'authorization');
  if p_packet is null or a.packet_id is distinct from p_packet or p_content_hash is null or a.content_sha256 is distinct from p_content_hash
    or p_size is null or a.byte_length is distinct from p_size or a.authorization_kind is distinct from 'packet' or a.acquisition_authorization_id is null
    then raise exception 'protected SNAP construction unavailable' using errcode='42501'; end if;
  acquisition:=parent_private.snap_direct_acquisition_authority(a.acquisition_authorization_id,p_request,p_version,p_snapshot,p_snapshot_hash);
  if a.consented_at is distinct from (acquisition#>>'{acquisition,consented_at}')::timestamptz
    or a.expires_at>(acquisition->>'expiresAt')::timestamptz
    or a.policy_version is distinct from acquisition#>>'{acquisition,policy_version}'
    or a.retention_policy_version is distinct from acquisition#>>'{acquisition,retention_policy_version}'
    or to_jsonb(a.subject_ids) is distinct from acquisition#>'{acquisition,subject_ids}'
    or a.consent_reference is distinct from acquisition#>>'{acquisition,consent_reference}'
    or a.authority_declaration is distinct from acquisition#>>'{acquisition,authority_declaration}'
    then raise exception 'protected SNAP construction authority changed' using errcode='42501'; end if;
  p:=jsonb_populate_record(null::parent_private.snap_final_packets,jsonb_build_object('id',a.packet_id,'authorization_id',a.id,
    'request_id',a.request_id,'owner_id',a.owner_id,'request_version',a.request_version,'snapshot_id',a.snapshot_id,
    'snapshot_hash',a.snapshot_hash,'content_sha256',a.content_sha256,'byte_length',a.byte_length,'expires_at',a.expires_at));
  return jsonb_build_object('intent',parent_private.snap_final_packet_binding(p)-'expiresAt',
    'context',jsonb_build_object('requestVersion',p_version,'snapshotId',a.snapshot_id,'snapshotHash',a.snapshot_hash,
      'source',b#>'{snapshot,source}','applyingSubjectIds',to_jsonb(a.subject_ids)),
    'snapshot',b->'snapshot','preparedAt',to_char((b#>>'{snapshot,created_at}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'state',case when exists(select 1 from parent_private.snap_final_packets f where f.id=a.packet_id and f.authorization_id=a.id and f.state='stored') then 'stored' else 'authorized' end);
end $$;
