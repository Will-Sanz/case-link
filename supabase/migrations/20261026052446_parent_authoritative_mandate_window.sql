-- Quote a deadline from the same clock that enforces the mandate, without changing its submitted packet.
create function public.parent_authorization_window() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_now timestamptz:=now();
begin
  if not public.is_parent_session() then
    raise exception 'verified parent session required' using errcode='42501';
  end if;
  return jsonb_build_object('issuedAt',v_now,'expiresAt',least(v_now+interval '30 days',v_now+interval '720 hours'));
end $$;
revoke execute on function public.parent_authorization_window()
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_authorization_window() to authenticated;
