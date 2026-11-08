-- Honor shortened linked-grant limits without requiring active processing; attempted evidence keeps its existing immutable expiry.
create or replace function parent_private.parent_purge_snap_final_packets(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare p record; request_row record; removed integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid protected cleanup limit' using errcode='23514'; end if;
  for request_row in select r.id from public.parent_requests r where exists(
    select 1 from parent_private.snap_final_packets f join public.parent_accounts a on a.id=f.owner_id join parent_private.snap_final_packet_authorizations c on c.id=f.authorization_id
    where f.request_id=r.id and (f.expires_at<=clock_timestamp() or a.status='deletion_requested'
      or exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||f.owner_id::text,'UTF8')),'hex'))
      or (not exists(select 1 from public.parent_operations o where o.id=f.operation_id and o.executed_at is not null) and
        (r.version<>f.request_version or r.status in ('cancelled','paused') or r.mandate_revoked_at is not null or c.revoked_at is not null or c.expires_at<=clock_timestamp() or exists(
            select 1 from parent_private.snap_final_packet_authorizations entry_authority
              left join parent_private.processing_controls controls on controls.singleton
              where entry_authority.id=c.acquisition_authorization_id and (entry_authority.revoked_at is not null or
                least(entry_authority.expires_at,entry_authority.consented_at+make_interval(secs=>controls.snap_protected_max_retention_seconds),
                  controls.approved_until,controls.snap_details_approved_until,controls.snap_protected_approved_until,
                  (r.mandate->>'expiresAt')::timestamptz)<=clock_timestamp()))))))
    order by r.id for update of r skip locked limit p_limit
  loop
    for p in select f.id from parent_private.snap_final_packets f join public.parent_requests r on r.id=f.request_id
      join public.parent_accounts a on a.id=f.owner_id join parent_private.snap_final_packet_authorizations c on c.id=f.authorization_id
      where f.request_id=request_row.id and (f.expires_at<=clock_timestamp() or a.status='deletion_requested'
        or exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||f.owner_id::text,'UTF8')),'hex'))
        or (not exists(select 1 from public.parent_operations o where o.id=f.operation_id and o.executed_at is not null) and
          (r.version<>f.request_version or r.status in ('cancelled','paused') or r.mandate_revoked_at is not null or c.revoked_at is not null or c.expires_at<=clock_timestamp() or exists(
            select 1 from parent_private.snap_final_packet_authorizations entry_authority
              left join parent_private.processing_controls controls on controls.singleton
              where entry_authority.id=c.acquisition_authorization_id and (entry_authority.revoked_at is not null or
                least(entry_authority.expires_at,entry_authority.consented_at+make_interval(secs=>controls.snap_protected_max_retention_seconds),
                  controls.approved_until,controls.snap_details_approved_until,controls.snap_protected_approved_until,
                  (r.mandate->>'expiresAt')::timestamptz)<=clock_timestamp())))))
      order by f.expires_at,f.id for update of f skip locked limit p_limit-removed
    loop
      delete from parent_private.snap_final_packets where id=p.id;
      removed:=removed+1;
    end loop;
    exit when removed>=p_limit;
  end loop;
  return removed;
end $$;
