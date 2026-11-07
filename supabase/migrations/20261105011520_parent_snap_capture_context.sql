-- Owned current preparation metadata only. This does not authorize protected capture or choose a packet.
create function public.parent_get_snap_capture_context(p_request_id uuid,p_expected_version integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b jsonb; subjects uuid[];
begin
  if p_expected_version is null or p_expected_version<1 or clock_timestamp()>='2026-12-03T05:00:00Z'::timestamptz
    or not parent_private.owns_request(p_request_id)
    then raise exception 'SNAP preparation context unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_application_binding(p_request_id,p_expected_version);
  if b is null or not parent_private.snap_snapshot_provenance_current(b->'snapshot')
    then raise exception 'SNAP preparation context unavailable' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects
    from jsonb_array_elements(coalesce(b#>'{snapshot,details,household}','[]'::jsonb)) person where person->>'requestingSnap'='true';
  return jsonb_build_object('requestVersion',p_expected_version,'snapshotId',b#>>'{snapshot,id}','snapshotHash',b->>'snapshotHash',
    'source',b#>'{snapshot,source}','applyingSubjectIds',coalesce(to_jsonb(subjects),'[]'::jsonb));
end $$;
revoke execute on function public.parent_get_snap_capture_context(uuid,integer)
  from public,anon,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_get_snap_capture_context(uuid,integer) to authenticated;
