-- Exact metadata survives packet/key purge; replacing personal pages requires a new request version.
alter table public.parent_jobs
  add column snap_packet_id uuid,
  add column snap_capture_state text check(snap_capture_state in ('pending','checked','needs_parent','service_unavailable')),
  add column snap_capture_reason text check(snap_capture_reason in ('page_1_unreadable','page_5_unreadable','applicant_identifier_needed','personal_mark_or_date_needed','facts_correction_needed','check_unavailable','provider_rule_unresolved')),
  add column snap_capture_wake_lease_token uuid,
  add constraint parent_snap_capture_metadata check(
    (snap_packet_id is null and snap_capture_state is null and snap_capture_reason is null and snap_capture_wake_lease_token is null)
    or (snap_packet_id is not null and snap_capture_state is not null and
      ((snap_capture_state in ('pending','checked') and snap_capture_reason is null)
       or (snap_capture_state='needs_parent' and snap_capture_reason is not null and snap_capture_reason in ('page_1_unreadable','page_5_unreadable','applicant_identifier_needed','personal_mark_or_date_needed','facts_correction_needed'))
       or (snap_capture_state='service_unavailable' and snap_capture_reason is not null and snap_capture_reason in ('check_unavailable','provider_rule_unresolved'))))
  );

create function parent_private.snap_capture_current(p_request uuid,p_version integer,p_packet uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare p parent_private.snap_final_packets;
begin
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request and request_version=p_version;
  if not found or p.state<>'stored' or p.expires_at<=clock_timestamp() then return false; end if;
  perform parent_private.snap_final_packet_authority(p.authorization_id,p_request,p_version,p.snapshot_id,p.snapshot_hash);
  return true;
exception when others then return false;
end $$;

create function parent_private.reset_snap_capture_version() returns trigger language plpgsql set search_path='' as $$
begin
  if new.request_version is distinct from old.request_version then
    new.snap_packet_id:=null; new.snap_capture_state:=null; new.snap_capture_reason:=null; new.snap_capture_wake_lease_token:=null;
  end if;
  return new;
end $$;
create trigger parent_snap_capture_version before update of request_version on public.parent_jobs
  for each row execute function parent_private.reset_snap_capture_version();

create function parent_private.queue_sealed_snap_capture() returns trigger
language plpgsql security definer set search_path='' as $$
declare j public.parent_jobs;
begin
  if new.state<>'stored' or old.state='stored' then return new; end if;
  select * into j from public.parent_jobs where request_id=new.request_id for update;
  if not found or j.request_version is distinct from new.request_version or j.attempts>=48
    or j.state not in ('queued','waiting','leased','failed')
    or not parent_private.snap_capture_current(new.request_id,new.request_version,new.id)
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  if j.snap_packet_id is not null then
    if j.snap_packet_id is distinct from new.id then raise exception 'this version already has a chosen SNAP packet' using errcode='23514'; end if;
    return new;
  end if;
  update public.parent_jobs set snap_packet_id=new.id,snap_capture_state='pending',snap_capture_reason=null,
    snap_capture_wake_lease_token=case when state='leased' then lease_token end,
    state=case when state in ('queued','waiting','failed') and last_error is distinct from 'delivery_unknown' then 'queued' else state end,
    run_at=case when state in ('queued','waiting','failed') and last_error is distinct from 'delivery_unknown' then clock_timestamp() else run_at end,
    updated_at=clock_timestamp() where id=j.id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(new.request_id,'snap_application.uploaded','caselink',
    'Your exact application file was saved for private checks. It has not been submitted.',jsonb_build_object('packetId',new.id,'requestVersion',new.request_version));
  return new;
end $$;
create trigger parent_snap_capture_queued after update of state on parent_private.snap_final_packets
  for each row execute function parent_private.queue_sealed_snap_capture();

create function parent_private.wake_after_snap_capture() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.state='leased' and new.state in ('waiting','failed','done') and new.attempts<48
    and new.request_version=old.request_version and old.lease_token is not null
    and new.snap_capture_wake_lease_token=old.lease_token and new.snap_capture_state='pending'
    and new.last_error is distinct from 'delivery_unknown'
    and not exists(select 1 from public.parent_operations o where o.request_id=new.request_id and o.need='snap_new' and o.state='delivery_unknown')
    and parent_private.snap_capture_current(new.request_id,new.request_version,new.snap_packet_id) then
    new.state:='queued'; new.run_at:=clock_timestamp(); new.lease_token:=null; new.lease_until:=null;
    new.snap_capture_wake_lease_token:=null;
  end if;
  return new;
end $$;
create trigger parent_snap_capture_resumption before update of state on public.parent_jobs
  for each row execute function parent_private.wake_after_snap_capture();

create function parent_private.parent_get_snap_pending_capture(p_job uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.parent_jobs; p parent_private.snap_final_packets; c parent_private.processing_controls; r public.parent_requests;
begin
  select * into j from public.parent_jobs where id=p_job;
  j:=parent_private.require_lease(p_job,p_token,j.request_version);
  if j.snap_packet_id is null then return null; end if;
  if not parent_private.snap_capture_current(j.request_id,j.request_version,j.snap_packet_id) then
    return jsonb_build_object('packetId',j.snap_packet_id,'requestId',j.request_id,'requestVersion',j.request_version,'state','unavailable','reason','permission_or_file_unavailable','intent',null,'deadline',null);
  end if;
  select * into p from parent_private.snap_final_packets where id=j.snap_packet_id;
  select * into c from parent_private.processing_controls where singleton;
  select * into r from public.parent_requests where id=j.request_id;
  return jsonb_build_object('packetId',p.id,'requestId',j.request_id,'requestVersion',j.request_version,'state',j.snap_capture_state,'reason',j.snap_capture_reason,
    'intent',parent_private.snap_final_packet_binding(p)-'expiresAt',
    'deadline',to_char(least(j.lease_until,p.expires_at,c.approved_until,c.snap_details_approved_until,c.snap_protected_approved_until,(r.mandate->>'expiresAt')::timestamptz)
      at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

create function parent_private.parent_record_snap_capture_result(p_job uuid,p_token uuid,p_packet uuid,p_state text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare j public.parent_jobs; p parent_private.snap_final_packets; o public.parent_operations;
begin
  select * into j from public.parent_jobs where id=p_job;
  j:=parent_private.require_lease(p_job,p_token,j.request_version);
  if j.snap_packet_id is distinct from p_packet or not parent_private.snap_capture_current(j.request_id,j.request_version,p_packet)
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  if p_state is null or not (
    (p_state='checked' and p_reason is null)
    or (p_state='needs_parent' and p_reason is not null and p_reason in ('page_1_unreadable','page_5_unreadable','applicant_identifier_needed','personal_mark_or_date_needed','facts_correction_needed'))
    or (p_state='service_unavailable' and p_reason is not null and p_reason in ('check_unavailable','provider_rule_unresolved')))
    then raise exception 'invalid private SNAP check result' using errcode='23514'; end if;
  if p_state='checked' then
    select * into p from parent_private.snap_final_packets where id=p_packet;
    select * into o from public.parent_operations where id=p.operation_id;
    if not found or parent_private.required_personal_acts(o) is null then raise exception 'protected SNAP content verification unavailable' using errcode='42501'; end if;
    perform parent_private.snap_protected_operation_context(j.request_id,j.request_version,o.packet);
    perform parent_private.validate_operation_artifact(o);
  end if;
  if j.snap_capture_state=p_state and j.snap_capture_reason is not distinct from p_reason then return; end if;
  if j.snap_capture_state='checked' then raise exception 'the checked SNAP file is immutable' using errcode='23514'; end if;
  update public.parent_jobs set snap_capture_state=p_state,snap_capture_reason=p_reason,snap_capture_wake_lease_token=null,updated_at=clock_timestamp() where id=p_job;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(j.request_id,'snap_application.private_check','caselink',
    case when p_state='checked' then 'Your application file passed its private checks. Review and Submit are still separate steps.'
      when p_state='needs_parent' then 'A specific personal application step needs your attention.'
      else 'CaseLink has a private application check to resolve.' end,
    jsonb_build_object('packetId',p_packet,'state',p_state,'reason',p_reason));
end $$;

create function public.parent_get_snap_current_capture(p_request uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.parent_jobs; available boolean;
begin
  if not parent_private.owns_request(p_request) or not parent_private.current_grant(p_request,p_version)
    or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid
      and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  select * into j from public.parent_jobs where request_id=p_request and request_version=p_version;
  if j.snap_packet_id is null then return null; end if;
  available:=parent_private.snap_capture_current(p_request,p_version,j.snap_packet_id);
  return jsonb_build_object('packetId',j.snap_packet_id,'requestVersion',j.request_version,
    'state',case when available then j.snap_capture_state else 'unavailable' end,
    'reason',case when available then j.snap_capture_reason else 'permission_or_file_unavailable' end);
end $$;

-- Replacing private pages changes the exact application, while original saved facts and dates remain intact.
create function public.parent_replace_snap_personal_pages(p_request uuid,p_version integer,p_previous_packet uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.parent_requests; j public.parent_jobs;
begin
  if not parent_private.owns_request(p_request) then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  select * into r from public.parent_requests where id=p_request for update;
  select * into j from public.parent_jobs where request_id=p_request for update;
  if not parent_private.owns_request(p_request) or not parent_private.current_grant(p_request,r.version)
    or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid
      and (s.not_after is null or s.not_after>clock_timestamp()))
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  if p_previous_packet is null or p_version is null or p_version not between 1 and 2147483646 then raise exception 'invalid private SNAP correction' using errcode='23514'; end if;
  if r.version=p_version+1 and exists(select 1 from public.parent_events e where e.request_id=p_request and e.kind='snap_application.personal_pages_replaced'
    and e.evidence=jsonb_build_object('previousPacketId',p_previous_packet,'fromVersion',p_version,'requestVersion',r.version)) then return r.version; end if;
  if r.version is distinct from p_version or j.request_version is distinct from p_version or j.snap_packet_id is distinct from p_previous_packet
    then raise exception 'request changed; reload before replacing pages' using errcode='40001'; end if;
  if exists(select 1 from public.parent_operations o where o.request_id=p_request and o.need='snap_new' and o.action='submit'
      and (o.executed_at is not null or o.state in ('executing','delivery_unknown','sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved')))
    then raise exception 'the previous SNAP attempt must be reconciled before replacing its application' using errcode='23514'; end if;
  perform parent_private.snap_application_binding(p_request,p_version);
  perform parent_private.invalidate_work(p_request,'You replaced the private SNAP pages. Earlier file references remain in history; queued work must use the corrected version.');
  update public.parent_requests set version=version+1,plan=null,required_actions='[]',updated_at=clock_timestamp() where id=p_request;
  update public.parent_jobs set state='queued',request_version=p_version+1,run_at=clock_timestamp(),lease_token=null,lease_until=null,last_error=null,updated_at=clock_timestamp() where request_id=p_request;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request,'snap_application.personal_pages_replaced','parent',
    'You chose to replace the private application pages. Your saved answers were reused without renewing their dates.',
    jsonb_build_object('previousPacketId',p_previous_packet,'fromVersion',p_version,'requestVersion',p_version+1));
  return p_version+1;
end $$;

revoke execute on function parent_private.snap_capture_current(uuid,integer,uuid),parent_private.reset_snap_capture_version(),parent_private.queue_sealed_snap_capture(),
  parent_private.wake_after_snap_capture(),parent_private.parent_get_snap_pending_capture(uuid,uuid),parent_private.parent_record_snap_capture_result(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function parent_private.parent_get_snap_pending_capture(uuid,uuid) to parent_worker,parent_snap_finalizer;
grant execute on function parent_private.parent_record_snap_capture_result(uuid,uuid,uuid,text,text) to parent_snap_finalizer;
revoke execute on function public.parent_get_snap_current_capture(uuid,integer),public.parent_replace_snap_personal_pages(uuid,integer,uuid)
  from public,anon,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function public.parent_get_snap_current_capture(uuid,integer),public.parent_replace_snap_personal_pages(uuid,integer,uuid) to authenticated;
