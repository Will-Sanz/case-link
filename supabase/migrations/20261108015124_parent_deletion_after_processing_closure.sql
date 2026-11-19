-- Parent-purpose deletion remains available after collection closes; this never enrolls an identity.
create function public.parent_get_deletion_status() returns text
language plpgsql volatile security definer set search_path='' as $$
declare v_status text;
begin
  select a.status into v_status from public.parent_accounts a
    join public.parent_households h on h.owner_id=a.id
    join auth.users u on u.id=a.id join auth.sessions s on s.user_id=u.id
    where a.id=auth.uid() and a.status in ('active','deletion_requested')
      and u.email is not null and length(btrim(u.email))>0 and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<clock_timestamp())
      and s.id=nullif(auth.jwt()->>'session_id','')::uuid
      and (s.not_after is null or s.not_after>clock_timestamp())
      and (not exists(select 1 from public.app_users x where x.id=u.id)
        or (public.has_password_session() and exists(select 1 from public.app_users x where x.id=u.id and x.is_active)));
  if v_status is null then raise exception 'parent deletion unavailable' using errcode='42501'; end if;
  return v_status;
end $$;

create or replace function public.parent_request_deletion() returns void
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_status text;
begin
  perform public.parent_get_deletion_status();
  -- Use the existing request-before-account lock order. Recheck after waiting for another deletion.
  perform 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id
    where h.owner_id=auth.uid() order by r.id for update of r;
  perform 1 from public.parent_accounts where id=auth.uid() for update;
  v_status:=public.parent_get_deletion_status();
  if v_status='deletion_requested' then return; end if;
  for v_id in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id
    where h.owner_id=auth.uid() order by r.id loop
    perform parent_private.invalidate_work(v_id,'Account deletion requested. Future sharing and processing have stopped.');
    update public.parent_requests set status='cancelled',mandate_revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=v_id;
    update public.parent_documents set status='deletion_pending',expires_at=least(expires_at,clock_timestamp()) where request_id=v_id and status<>'deleted';
    update parent_private.snap_final_packet_authorizations set revoked_at=coalesce(revoked_at,clock_timestamp()) where request_id=v_id and owner_id=auth.uid();
  end loop;
  insert into parent_private.deletion_tombstones(subject_hash)
    values(encode(sha256(convert_to('parent-account:'||auth.uid()::text,'UTF8')),'hex')) on conflict do nothing;
  update public.parent_accounts set status='deletion_requested',updated_at=clock_timestamp() where id=auth.uid();
  -- Existing independent retention claims ordinary files/artifacts and protected PDFs/keys by this status.
  -- No Auth user, school row, file or delivered provider copy is erased by this request.
end $$;
revoke execute on function public.parent_get_deletion_status(),public.parent_request_deletion()
  from public,anon,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer,parent_snap_sender;
grant execute on function public.parent_get_deletion_status(),public.parent_request_deletion() to authenticated;
