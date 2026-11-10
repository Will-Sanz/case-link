-- Exact verified packets can reach parent review without fresh AI planning. Begin/dispatch still require the separate Submit decision.
create or replace function parent_private.parent_claim_job(p_lease_seconds integer,p_continuation_only boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_token uuid:=gen_random_uuid(); v_request jsonb; v_request_id uuid;
begin
  if p_continuation_only is null then raise exception 'invalid continuation mode' using errcode='23514'; end if;
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'invalid lease duration' using errcode='23514'; end if;
  select r.id into v_request_id from public.parent_requests r join public.parent_jobs j on j.request_id=r.id
    where ((j.state in ('queued','waiting') and j.run_at<=now()) or (j.state='leased' and j.lease_until<now()))
      and j.attempts<48 and parent_private.current_grant(r.id,j.request_version)
      and (not p_continuation_only or (r.intake->'needs' ? 'snap_new' and exists(select 1 from public.parent_operations o
        where o.request_id=r.id and o.need='snap_new' and o.program_id='snap-pa' and o.action='submit'
          and o.artifact_id is null and cardinality(o.document_ids)=0
          and o.packet=jsonb_build_object('protectedSnapPacket',o.packet->'protectedSnapPacket')
          and jsonb_typeof(o.packet->'protectedSnapPacket')='object'
          and o.idempotency_key='snap-final:'||(o.packet#>>'{protectedSnapPacket,packetId}')
          and o.packet_hash=encode(sha256(convert_to(o.packet::text,'UTF8')),'hex')
          and (o.state in ('executing','delivery_unknown') or (o.state='prepared' and o.request_version=j.request_version
            and parent_private.snap_protected_packet_current(o) and parent_private.snap_protected_parent_submit_ready(o)
            and (not parent_private.snap_submission_authorized(o.id) or parent_private.personal_acts_complete(o)))))))
    order by j.run_at for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_job from public.parent_jobs where request_id=v_request_id for update;
  if not parent_private.current_grant(v_request_id,v_job.request_version) then return null; end if;
  -- Lock order is request, job, operation for claims, cancellation and dispatch alike.
  update public.parent_operations set state='delivery_unknown',updated_at=now()
    where request_id=v_request_id and state='executing';
  update public.parent_jobs set state='leased',lease_token=v_token,lease_until=now()+make_interval(secs=>p_lease_seconds),lease_started_at=now(),attempts=attempts+1,updated_at=now() where id=v_job.id;
  select to_jsonb(r)-'mandate_revoked_at'-'start_key' into v_request from public.parent_requests r where r.id=v_request_id;
  return jsonb_build_object('jobId',v_job.id,'leaseToken',v_token,'request',v_request,
    'documents',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('object_path',case when d.status='raw_deleted' or d.expires_at<=now() then null else d.object_path end,'raw_available',d.status in ('uploaded','processing','validated') and d.expires_at>now())),'[]') from public.parent_documents d where d.request_id=v_request_id and d.upload_confirmed_at is not null and d.status not in ('deleted','deletion_pending') and (d.expires_at>now() or (d.status in ('validated','raw_deleted') and d.facts_valid_until>now()))),
    'unknownOperations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.parent_operations o where o.request_id=v_request_id and o.state='delivery_unknown'));
end $$;
