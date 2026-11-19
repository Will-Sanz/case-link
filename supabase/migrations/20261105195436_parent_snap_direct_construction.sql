-- Closed construction evidence only. This enables no collection, signing method, Submit or transport.
alter table parent_private.snap_final_packet_verifications
  drop constraint snap_final_packet_verifications_validator_version_check,
  add constraint snap_final_packet_verifications_validator_version_check check(validator_version in
    ('pa600fs-final-content-2026-11-04.v1','pa600fs-direct-completion-2026-11-05.v1'));

create function parent_private.parent_get_snap_direct_context(
  p_authorization uuid,p_request uuid,p_version integer,p_snapshot uuid,p_snapshot_hash text,p_content_hash text,p_size integer,p_packet uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; p parent_private.snap_final_packets; a parent_private.snap_final_packet_authorizations;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  b:=parent_private.snap_final_packet_authority(p_authorization,p_request,p_version,p_snapshot,p_snapshot_hash);
  a:=jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,b->'authorization');
  if p_packet is null or a.packet_id is distinct from p_packet or p_content_hash is null or a.content_sha256 is distinct from p_content_hash
    or p_size is null or a.byte_length is distinct from p_size
    then raise exception 'protected SNAP construction unavailable' using errcode='42501'; end if;
  p:=jsonb_populate_record(null::parent_private.snap_final_packets,jsonb_build_object('id',a.packet_id,'authorization_id',a.id,
    'request_id',a.request_id,'owner_id',a.owner_id,'request_version',a.request_version,'snapshot_id',a.snapshot_id,
    'snapshot_hash',a.snapshot_hash,'content_sha256',a.content_sha256,'byte_length',a.byte_length,'expires_at',a.expires_at));
  return jsonb_build_object('intent',parent_private.snap_final_packet_binding(p)-'expiresAt',
    'context',jsonb_build_object('requestVersion',p_version,'snapshotId',a.snapshot_id,'snapshotHash',a.snapshot_hash,
      'source',b#>'{snapshot,source}','applyingSubjectIds',to_jsonb(a.subject_ids)),
    'snapshot',b->'snapshot','preparedAt',to_char((b#>>'{snapshot,created_at}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'state',case when exists(select 1 from parent_private.snap_final_packets f where f.id=a.packet_id and f.authorization_id=a.id and f.state='stored') then 'stored' else 'authorized' end);
end $$;

create function parent_private.parent_read_snap_direct_construction(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets; v parent_private.snap_final_packet_verifications; b jsonb;
  acts text[]:=array['applicant_signature_printed_page_1','rights_certification_printed_page_5'];
begin
  perform 1 from public.parent_requests where id=p_request for update;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request;
  if not found or p.request_version is distinct from p_version or p.authorization_id is distinct from p_authorization
    or p.state<>'stored' or p.expires_at<=clock_timestamp()
    then raise exception 'protected SNAP construction unavailable' using errcode='42501'; end if;
  b:=parent_private.parent_get_snap_direct_context(p_authorization,p_request,p_version,p.snapshot_id,p.snapshot_hash,p.content_sha256,p.byte_length,p_packet);
  select * into v from parent_private.snap_final_packet_verifications where packet_id=p.id;
  if not found or v.validator_version is distinct from 'pa600fs-direct-completion-2026-11-05.v1'
    or v.snapshot_id is distinct from p.snapshot_id or v.snapshot_hash is distinct from p.snapshot_hash or v.content_sha256 is distinct from p.content_sha256
    or v.source is distinct from b#>'{snapshot,source}' or v.baseline_certification_regions is distinct from acts or v.required_personal_acts is distinct from acts
    or v.verified_at<p.created_at or v.verified_at>clock_timestamp() or v.expires_at is distinct from p.expires_at or v.expires_at<=clock_timestamp()
    then raise exception 'protected SNAP construction unavailable' using errcode='42501'; end if;
  return jsonb_build_object('verificationId',v.id,'packetId',p.id,'snapshotId',v.snapshot_id,'snapshotHash',v.snapshot_hash,
    'contentSha256',v.content_sha256,'validatorVersion',v.validator_version,'source',v.source,'requiredPersonalActs',to_jsonb(v.required_personal_acts),
    'verifiedAt',to_char(v.verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(v.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Only the isolated trusted renderer writes this receipt, in the encrypted packet's creation transaction.
-- It describes construction, never human origin, signature acceptance or agency receipt.
create function parent_private.parent_record_snap_direct_construction(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets; b jsonb;
  acts text[]:=array['applicant_signature_printed_page_1','rights_certification_printed_page_5'];
begin
  perform 1 from public.parent_requests where id=p_request for update;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request for update;
  if not found or p.request_version is distinct from p_version or p.authorization_id is distinct from p_authorization
    or p.state<>'stored' or p.created_xid<>pg_current_xact_id() or p.expires_at<=clock_timestamp()
    then raise exception 'protected SNAP construction unavailable' using errcode='42501'; end if;
  b:=parent_private.parent_get_snap_direct_context(p_authorization,p_request,p_version,p.snapshot_id,p.snapshot_hash,p.content_sha256,p.byte_length,p_packet);
  if jsonb_array_length(b#>'{snapshot,details,household}')>8
    or jsonb_array_length(coalesce(b#>'{snapshot,details,income,entries}','[]'::jsonb))>5
    or b#>'{snapshot,details,authorizedRepresentative}' is not null
    or exists(select 1 from jsonb_array_elements(b#>'{snapshot,details,household}') person
      where person->>'requestingSnap'='true' and person->>'citizen' is distinct from 'true')
    then raise exception 'protected SNAP construction route unavailable' using errcode='42501'; end if;
  if not exists(select 1 from parent_private.snap_final_packet_verifications where packet_id=p.id) then
    insert into parent_private.snap_final_packet_verifications(packet_id,snapshot_id,snapshot_hash,content_sha256,validator_version,source,
      baseline_certification_regions,required_personal_acts,verified_at,expires_at)
    values(p.id,p.snapshot_id,p.snapshot_hash,p.content_sha256,'pa600fs-direct-completion-2026-11-05.v1',b#>'{snapshot,source}',acts,acts,clock_timestamp(),p.expires_at);
  end if;
  return parent_private.parent_read_snap_direct_construction(p_packet,p_request,p_version,p_authorization);
end $$;

-- Direct construction cannot inherit the legacy path's accepted personal-completion method.
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
    or v.validator_version is distinct from 'pa600fs-final-content-2026-11-04.v1'
    or v.snapshot_id<>p.snapshot_id or v.snapshot_hash<>p.snapshot_hash or v.content_sha256<>p.content_sha256
    or v.verified_at<p.created_at or v.verified_at>clock_timestamp() or v.expires_at<=clock_timestamp() or v.expires_at>p.expires_at
    or p_packet is distinct from parent_private.snap_protected_operation_packet(p,v)
    then raise exception 'protected SNAP content verification unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_final_packet_authority(p.authorization_id,p_request,p_version,p.snapshot_id,p.snapshot_hash);
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

revoke execute on function parent_private.parent_get_snap_direct_context(uuid,uuid,integer,uuid,text,text,integer,uuid),
  parent_private.parent_record_snap_direct_construction(uuid,uuid,integer,uuid),parent_private.parent_read_snap_direct_construction(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function parent_private.parent_get_snap_direct_context(uuid,uuid,integer,uuid,text,text,integer,uuid),
  parent_private.parent_record_snap_direct_construction(uuid,uuid,integer,uuid),parent_private.parent_read_snap_direct_construction(uuid,uuid,integer,uuid)
  to parent_snap_finalizer;
