-- Leased metadata only; no protected fields, key, bytes or public retrieval authority are added.
create function parent_private.guard_snap_initial_filing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.need='snap_new' and new.program_id='snap-pa' and new.action='submit' and new.packet ? 'protectedSnapPacket' and exists(
    select 1 from public.parent_operations prior where prior.request_id=new.request_id and prior.need='snap_new' and prior.program_id='snap-pa' and prior.action='submit'
      and (prior.executed_at is not null or prior.state in ('executing','delivery_unknown','sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved'))
  ) then raise exception 'an earlier initial SNAP filing requires reconciliation or an accepted follow-up route' using errcode='23514'; end if;
  return new;
end $$;
revoke execute on function parent_private.guard_snap_initial_filing() from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;
create trigger parent_snap_initial_filing before insert on public.parent_operations for each row execute function parent_private.guard_snap_initial_filing();

create function parent_private.snap_protected_packet_current(o public.parent_operations) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if o.state<>'prepared' or o.idempotency_key is distinct from 'snap-final:'||(o.packet#>>'{protectedSnapPacket,packetId}')
    or o.packet_hash is distinct from encode(sha256(convert_to(o.packet::text,'UTF8')),'hex') then return false; end if;
  return parent_private.required_personal_acts(o) is not null;
exception when others then return false;
end $$;
revoke execute on function parent_private.snap_protected_packet_current(public.parent_operations)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;

-- Submit may record only the two baseline parent reports; other actors' required evidence must already exist.
create function parent_private.snap_protected_parent_submit_ready(o public.parent_operations) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if not parent_private.snap_protected_packet_current(o) then return false; end if;
  return not exists(select 1 from unnest(parent_private.required_personal_acts(o)) required_act
    where required_act<>all(array['applicant_signature_printed_page_1','rights_certification_printed_page_5']) and not exists(
      select 1 from parent_private.personal_act_evidence e where e.operation_id=o.id and e.packet_hash=o.packet_hash and e.act=required_act
        and e.expires_at>clock_timestamp() and e.attribution is distinct from 'parent_reported'));
exception when others then return false;
end $$;
revoke execute on function parent_private.snap_protected_parent_submit_ready(public.parent_operations)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker,parent_snap_finalizer;

create or replace function parent_private.parent_get_operations(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('personalActsComplete',parent_private.personal_acts_complete(o),
    'snapSubmissionAuthorized',parent_private.snap_submission_authorized(o.id),
    'protectedParentSubmitReady',case when o.packet ? 'protectedSnapPacket' then parent_private.snap_protected_parent_submit_ready(o) else false end,
    'protectedPacketCurrent',case when o.packet ? 'protectedSnapPacket' then parent_private.snap_protected_packet_current(o) else false end)
    order by o.created_at),'[]') from public.parent_operations o where o.request_id=v_job.request_id);
end $$;
