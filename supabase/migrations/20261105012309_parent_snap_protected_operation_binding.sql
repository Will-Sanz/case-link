-- Canonical metadata only. No verifier writer, personal-act writer, Submit or transport is enabled here.
create table parent_private.snap_final_packet_verifications (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null unique references parent_private.snap_final_packets(id) on delete cascade,
  snapshot_id uuid not null references public.parent_snap_application_details(id) on delete cascade,
  snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
  content_sha256 text not null check(content_sha256~'^[a-f0-9]{64}$'),
  validator_version text not null check(validator_version='pa600fs-final-content-2026-11-04.v1'),
  source jsonb not null,
  baseline_certification_regions text[] not null check(baseline_certification_regions=array['applicant_signature_printed_page_1','rights_certification_printed_page_5']::text[]),
  verified_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null check(expires_at>verified_at)
);
alter table parent_private.snap_final_packet_verifications enable row level security;
revoke all on parent_private.snap_final_packet_verifications from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;

create function parent_private.immutable_snap_final_verification() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'protected SNAP verification is immutable' using errcode='23514'; end $$;
create trigger parent_snap_final_verification_immutable before update on parent_private.snap_final_packet_verifications
  for each row execute function parent_private.immutable_snap_final_verification();

create function parent_private.snap_protected_operation_packet(p parent_private.snap_final_packets,v parent_private.snap_final_packet_verifications) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('protectedSnapPacket',jsonb_build_object('packetId',p.id,'authorizationId',p.authorization_id,
    'snapshotId',p.snapshot_id,'snapshotHash',p.snapshot_hash,'contentSha256',p.content_sha256,'byteLength',p.byte_length,'verificationId',v.id));
$$;

-- A structural PDF check or a parent assertion is not this trusted content-verification receipt.
create function parent_private.snap_protected_operation_context(p_request uuid,p_version integer,p_packet jsonb) returns jsonb
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
    then raise exception 'protected SNAP execution permission unavailable' using errcode='42501'; end if;
  return jsonb_build_object('packetId',p.id,'verificationId',v.id,'dataCategories',b->'dataCategories','permissionVersion',c.permission_version);
exception when invalid_text_representation then raise exception 'protected SNAP operation unavailable' using errcode='42501';
end $$;

create function parent_private.parent_prepare_snap_final_operation(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid,p_verification uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets; v parent_private.snap_final_packet_verifications; o public.parent_operations; j public.parent_jobs;
  packet jsonb; context jsonb; categories text[]; packet_hash text; operation_key text:='snap-final:'||p_packet::text;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  select * into j from public.parent_jobs where request_id=p_request for update;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request for update;
  if not found or p.request_version is distinct from p_version or p.authorization_id is distinct from p_authorization
    then raise exception 'protected SNAP operation unavailable' using errcode='42501'; end if;
  select * into v from parent_private.snap_final_packet_verifications where id=p_verification and packet_id=p.id;
  if not found then raise exception 'protected SNAP content verification unavailable' using errcode='42501'; end if;
  packet:=parent_private.snap_protected_operation_packet(p,v);
  context:=parent_private.snap_protected_operation_context(p_request,p_version,packet);
  categories:=array(select jsonb_array_elements_text(context->'dataCategories'));
  packet_hash:=encode(sha256(convert_to(packet::text,'UTF8')),'hex');
  select * into o from public.parent_operations where request_id=p_request and idempotency_key=operation_key for update;
  if found then
    if p.operation_id is distinct from o.id or o.request_version<>p_version or o.need<>'snap_new' or o.program_id<>'snap-pa' or o.action<>'submit'
      or o.packet is distinct from packet or o.packet_hash<>packet_hash or o.data_categories is distinct from categories or cardinality(o.document_ids)<>0
      or o.artifact_id is not null or o.permission_version is distinct from context->>'permissionVersion'
      then raise exception 'protected SNAP operation changed' using errcode='42501'; end if;
    return o.id;
  end if;
  if p.operation_id is not null or exists(select 1 from public.parent_operations prior where prior.request_id=p_request and prior.request_version=p_version and prior.need='snap_new' and prior.action='submit')
    then raise exception 'a canonical SNAP operation already exists for this version' using errcode='23514'; end if;
  if j.id is null or j.request_version is distinct from p_version or j.attempts>=48
    or not coalesce(j.state in ('queued','waiting','failed') or (j.state='leased' and j.lease_token is not null and
      (j.lease_until<clock_timestamp() or (j.lease_until>clock_timestamp() and j.lease_started_at>=clock_timestamp()-interval '15 minutes'))),false)
    or j.last_error='delivery_unknown' or exists(select 1 from public.parent_operations where request_id=p_request and need='snap_new' and state='delivery_unknown')
    then raise exception 'protected SNAP continuation unavailable' using errcode='23514'; end if;
  insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,permission_version)
    values(p_request,p_version,'snap_new','snap-pa','submit',packet,packet_hash,categories,'{}',operation_key,context->>'permissionVersion') returning * into o;
  update parent_private.snap_final_packets set operation_id=o.id where id=p.id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request,'snap_application.prepared','caselink',
    'The exact protected SNAP application was prepared for your review.',jsonb_build_object('operationId',o.id,'packetId',p.id));
  return o.id;
end $$;

-- The old association entry point cannot attach an unrelated ordinary artifact or bypass content verification.
create or replace function parent_private.parent_bind_snap_final_packet(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid,p_operation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets; v parent_private.snap_final_packet_verifications; prepared uuid;
begin
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request;
  select * into v from parent_private.snap_final_packet_verifications where packet_id=p.id;
  if p.operation_id is distinct from p_operation or v.id is null then raise exception 'protected SNAP canonical operation unavailable' using errcode='42501'; end if;
  prepared:=parent_private.parent_prepare_snap_final_operation(p_packet,p_request,p_version,p_authorization,v.id);
  if prepared is distinct from p_operation then raise exception 'protected SNAP canonical operation unavailable' using errcode='42501'; end if;
  return prepared;
end $$;
revoke execute on function parent_private.immutable_snap_final_verification(),parent_private.snap_protected_operation_packet(parent_private.snap_final_packets,parent_private.snap_final_packet_verifications),
  parent_private.snap_protected_operation_context(uuid,integer,jsonb),parent_private.parent_prepare_snap_final_operation(uuid,uuid,integer,uuid,uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function parent_private.parent_prepare_snap_final_operation(uuid,uuid,integer,uuid,uuid) to parent_snap_finalizer;
