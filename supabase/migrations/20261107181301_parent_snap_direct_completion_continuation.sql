-- Complete only an exact, privately rendered direct packet. No method, policy or provider is enabled.
create function parent_private.parent_read_snap_direct_operation(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid,p_verification uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare p parent_private.snap_final_packets; o public.parent_operations; j public.parent_jobs; construction jsonb;
begin
  construction:=parent_private.parent_read_snap_direct_construction(p_packet,p_request,p_version,p_authorization);
  if p_verification is null or construction->>'verificationId' is distinct from p_verification::text
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request;
  select * into j from public.parent_jobs where request_id=p_request and request_version=p_version;
  select * into o from public.parent_operations where id=p.operation_id and request_id=p_request and request_version=p_version;
  if not found or j.snap_packet_id is distinct from p_packet or j.snap_capture_state is distinct from 'checked'
    or o.need<>'snap_new' or o.program_id<>'snap-pa' or o.action<>'submit'
    or o.idempotency_key is distinct from 'snap-final:'||p_packet::text
    or o.packet_hash is distinct from encode(sha256(convert_to(o.packet::text,'UTF8')),'hex')
    or o.packet#>>'{protectedSnapPacket,verificationId}' is distinct from p_verification::text
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  perform parent_private.validate_operation_artifact(o);
  return o.id;
end $$;

-- Called after sealing and recording construction, in their original transaction. Existing sealing
-- triggers queue the job; this closes the private check without a second worker or a new parent prompt.
create function parent_private.parent_finish_snap_direct_completion(p_packet uuid,p_request uuid,p_version integer,p_authorization uuid,p_verification uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare p parent_private.snap_final_packets; j public.parent_jobs; operation uuid; construction jsonb;
begin
  perform 1 from public.parent_requests where id=p_request for update;
  select * into j from public.parent_jobs where request_id=p_request for update;
  select * into p from parent_private.snap_final_packets where id=p_packet and request_id=p_request for update;
  if not found or p.request_version is distinct from p_version or p.authorization_id is distinct from p_authorization
    or p.created_xid is distinct from pg_current_xact_id() or p.state<>'stored'
    or j.request_version is distinct from p_version or j.snap_packet_id is distinct from p_packet
    or j.snap_capture_state is distinct from 'pending'
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  construction:=parent_private.parent_read_snap_direct_construction(p_packet,p_request,p_version,p_authorization);
  if p_verification is null or construction->>'verificationId' is distinct from p_verification::text
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  operation:=parent_private.parent_prepare_snap_final_operation(p_packet,p_request,p_version,p_authorization,p_verification);
  update public.parent_jobs set snap_capture_state='checked',snap_capture_reason=null,updated_at=clock_timestamp() where id=j.id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request,'snap_application.private_check','caselink',
    'Your application file passed its private checks. Review and Submit are still separate steps.',
    jsonb_build_object('packetId',p_packet,'state','checked','reason',null));
  if parent_private.parent_read_snap_direct_operation(p_packet,p_request,p_version,p_authorization,p_verification) is distinct from operation
    then raise exception 'protected SNAP continuation unavailable' using errcode='42501'; end if;
  return operation;
end $$;

-- A worker that already read the old state must get one fresh pass after this transaction commits.
-- Preserve its lease and all existing cancellation, current-authority, budget and unknown-delivery gates.
create or replace function parent_private.wake_after_snap_capture() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.state='leased' and new.state in ('waiting','failed','done') and new.attempts<48
    and new.request_version=old.request_version and old.lease_token is not null
    and new.snap_capture_wake_lease_token=old.lease_token and new.snap_capture_state in ('pending','checked')
    and new.last_error is distinct from 'delivery_unknown'
    and not exists(select 1 from public.parent_operations o where o.request_id=new.request_id and o.need='snap_new' and o.state='delivery_unknown')
    and parent_private.snap_capture_current(new.request_id,new.request_version,new.snap_packet_id) then
    new.state:='queued'; new.run_at:=clock_timestamp(); new.lease_token:=null; new.lease_until:=null;
    new.snap_capture_wake_lease_token:=null;
  end if;
  return new;
end $$;

revoke execute on function parent_private.parent_read_snap_direct_operation(uuid,uuid,integer,uuid,uuid),
  parent_private.parent_finish_snap_direct_completion(uuid,uuid,integer,uuid,uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
grant execute on function parent_private.parent_read_snap_direct_operation(uuid,uuid,integer,uuid,uuid),
  parent_private.parent_finish_snap_direct_completion(uuid,uuid,integer,uuid,uuid) to parent_snap_finalizer;
