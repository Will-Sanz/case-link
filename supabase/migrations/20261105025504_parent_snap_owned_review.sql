-- Owning-parent review metadata; bytes still go only through the isolated protected reader.
create function parent_private.clear_stale_snap_review() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.version is distinct from old.version then
    new.required_actions:=(select coalesce(jsonb_agg(a.value order by a.ordinality),'[]')
      from jsonb_array_elements(new.required_actions) with ordinality a
      where not coalesce(a.value->>'need'='snap_new' and a.value->>'reason'='submission_review' and a.value->>'field'='snap_final_submit',false));
  end if;
  return new;
end $$;
revoke execute on function parent_private.clear_stale_snap_review()
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
create trigger parent_snap_review_version before update of version on public.parent_requests
  for each row execute function parent_private.clear_stale_snap_review();

create function public.parent_get_snap_review(p_request uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.parent_jobs; p parent_private.snap_final_packets; o public.parent_operations;
begin
  if not parent_private.owns_request(p_request) or not parent_private.current_grant(p_request,p_version)
    or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid
      and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP review unavailable' using errcode='42501'; end if;
  select * into j from public.parent_jobs where request_id=p_request and request_version=p_version;
  if j.snap_packet_id is null then return null; end if;
  if not parent_private.snap_capture_current(p_request,p_version,j.snap_packet_id)
    then raise exception 'protected SNAP review unavailable' using errcode='42501'; end if;
  select * into p from parent_private.snap_final_packets where id=j.snap_packet_id;
  if p.operation_id is null then return null; end if;
  select * into o from public.parent_operations where id=p.operation_id and request_id=p_request and request_version=p_version;
  if not found or o.idempotency_key is distinct from 'snap-final:'||p.id::text
    or o.packet_hash is distinct from encode(sha256(convert_to(o.packet::text,'UTF8')),'hex')
    then raise exception 'protected SNAP review unavailable' using errcode='42501'; end if;
  perform parent_private.validate_operation_artifact(o);
  return jsonb_build_object('operationId',o.id,'requestId',o.request_id,'requestVersion',o.request_version,
    'need',o.need,'programId',o.program_id,'action',o.action,'state',o.state,'packet',o.packet,'packetHash',o.packet_hash,
    'dataCategories',o.data_categories,'documentIds',o.document_ids,'artifactId',o.artifact_id,'idempotencyKey',o.idempotency_key,
    'permissionVersion',o.permission_version,'protectedPacketCurrent',parent_private.snap_protected_packet_current(o),
    'protectedParentSubmitReady',parent_private.snap_protected_parent_submit_ready(o),
    'personalActsComplete',parent_private.personal_acts_complete(o),'snapSubmissionAuthorized',parent_private.snap_submission_authorized(o.id));
end $$;
revoke execute on function public.parent_get_snap_review(uuid,integer)
  from public,anon,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_get_snap_review(uuid,integer) to authenticated;
