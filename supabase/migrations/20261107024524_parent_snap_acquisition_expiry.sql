-- Bind fresh permission to the expiry the parent accepted; no processing or provider gate is enabled.
-- The old RPC has no expiry bound and must not remain an authenticated bypass.
drop function public.parent_authorize_snap_direct_acquisition(uuid,integer,uuid,text,uuid,text,text,uuid[],boolean);

create function public.parent_authorize_snap_direct_acquisition(p_request_id uuid,p_expected_version integer,p_snapshot_id uuid,p_snapshot_hash text,
  p_acquisition_id uuid,p_policy_version text,p_retention_policy_version text,p_subject_ids uuid[],p_authority_declared boolean,p_accepted_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; a parent_private.snap_final_packet_authorizations; subjects uuid[]; recorded_at timestamptz;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests where id=p_request_id for update;
  if not parent_private.owns_request(p_request_id) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP acquisition unavailable' using errcode='42501'; end if;
  b:=parent_private.snap_direct_acquisition_authority(null,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash);
  select array_agg(x order by x) into subjects from unnest(p_subject_ids) x;
  if p_accepted_expires_at is null or not isfinite(p_accepted_expires_at) or p_accepted_expires_at<=clock_timestamp()
    or p_accepted_expires_at is distinct from date_trunc('milliseconds',p_accepted_expires_at)
    or p_acquisition_id is null or p_policy_version is distinct from b#>>'{metadata,policyVersion}' or p_retention_policy_version is distinct from b#>>'{metadata,retentionPolicyVersion}'
    or p_authority_declared is distinct from true or p_subject_ids is null or cardinality(p_subject_ids) not between 1 and 30 or array_position(p_subject_ids,null) is not null
    or cardinality(p_subject_ids)<>(select count(distinct x) from unnest(p_subject_ids) x)
    or to_jsonb(subjects) is distinct from b#>'{metadata,subjectIds}'
    then raise exception 'invalid protected SNAP acquisition' using errcode='23514'; end if;
  if exists(select 1 from parent_private.snap_final_packet_authorizations x where x.id=p_acquisition_id and (x.request_id<>p_request_id or x.owner_id<>auth.uid() or x.authorization_kind<>'direct_entry'))
    then raise exception 'invalid protected SNAP acquisition' using errcode='23514'; end if;
  select * into a from parent_private.snap_final_packet_authorizations where id=p_acquisition_id and request_id=p_request_id and owner_id=auth.uid() and authorization_kind='direct_entry' for update;
  if found then
    b:=parent_private.snap_direct_acquisition_authority(a.id,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash);
    if (b->>'expiresAt')::timestamptz>p_accepted_expires_at then raise exception 'protected SNAP permission changed' using errcode='23514'; end if;
    return b->'metadata';
  end if;
  if b->'acquisition'<>'null'::jsonb then
    if (b->>'expiresAt')::timestamptz>p_accepted_expires_at then raise exception 'protected SNAP permission changed' using errcode='23514'; end if;
    return b->'metadata';
  end if;
  if (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id)>=500
    or (select count(*) from parent_private.snap_final_packet_authorizations where request_id=p_request_id and created_at>clock_timestamp()-interval '1 minute')>=20
    then raise exception 'invalid protected SNAP acquisition' using errcode='23514'; end if;
  recorded_at:=clock_timestamp();
  insert into parent_private.snap_final_packet_authorizations(id,request_id,owner_id,request_version,snapshot_id,snapshot_hash,subject_ids,
    recipient,need,purpose,policy_version,retention_policy_version,consent_reference,consented_at,expires_at,created_at,authorization_session_id,authority_declaration,authorization_kind)
  values(p_acquisition_id,p_request_id,auth.uid(),p_expected_version,p_snapshot_id,p_snapshot_hash,subjects,'snap-pa','snap_new','snap_final_application_packet',
    p_policy_version,p_retention_policy_version,'snap-direct-entry:'||p_acquisition_id::text,recorded_at,least((b->>'expiresAt')::timestamptz,p_accepted_expires_at),recorded_at,
    nullif(auth.jwt()->>'session_id','')::uuid,'parent_declared_household_data_authority','direct_entry');
  return parent_private.snap_direct_acquisition_authority(p_acquisition_id,p_request_id,p_expected_version,p_snapshot_id,p_snapshot_hash)->'metadata';
exception when unique_violation then raise exception 'invalid protected SNAP acquisition' using errcode='23514';
end $$;

revoke all on function public.parent_authorize_snap_direct_acquisition(uuid,integer,uuid,text,uuid,text,text,uuid[],boolean,timestamptz)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_authorize_snap_direct_acquisition(uuid,integer,uuid,text,uuid,text,text,uuid[],boolean,timestamptz) to authenticated;
