create table parent_private.worker_health (
  singleton boolean primary key default true check(singleton),
  heartbeat_at timestamptz not null,
  expires_at timestamptz not null,
  planning_ready boolean not null default false,
  assistant_ready boolean not null default false
);
alter table parent_private.worker_health enable row level security;
revoke all on parent_private.worker_health from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create function parent_private.parent_record_worker_health(p_planning_ready boolean,p_assistant_ready boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into parent_private.worker_health(singleton,heartbeat_at,expires_at,planning_ready,assistant_ready)
    values(true,clock_timestamp(),clock_timestamp()+interval '90 seconds',coalesce(p_planning_ready,false),coalesce(p_assistant_ready,false))
    on conflict(singleton) do update set heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at,planning_ready=excluded.planning_ready,assistant_ready=excluded.assistant_ready;
end $$;
revoke execute on function parent_private.parent_record_worker_health(boolean,boolean) from public,anon,authenticated,service_role,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.parent_record_worker_health(boolean,boolean) to parent_worker;

create function parent_private.request_progress(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.parent_requests; j public.parent_jobs; h parent_private.worker_health;
  v_state text; v_summary text; v_running boolean:=false; v_next timestamptz;
begin
  select * into r from public.parent_requests where id=p_request;
  if not found then return null; end if;
  select * into j from public.parent_jobs where request_id=p_request;
  select * into h from parent_private.worker_health where singleton;
  v_running:=coalesce(h.planning_ready and h.expires_at>now() and parent_private.current_grant(r.id,r.version),false);
  if r.status='cancelled' then
    v_state:='cancelled';v_summary:='You cancelled this request. Future work is stopped.';
  elsif r.status='paused' then
    v_state:='paused';v_summary:='You paused this request. Resume when you are ready.';
  elsif r.status='closed' then
    v_state:='closed';v_summary:='This request is closed. Check the recorded outcomes below.';
  elsif (r.mandate->>'expiresAt')::timestamptz<=now() then
    v_state:='needs_parent';v_summary:='Your permission has expired. Review and renew it before background work can continue.';
  elsif not v_running then
    v_state:='service_offline';v_summary:='Your request is saved. Background planning is unavailable right now; no application submission is implied.';
  elsif j.state='leased' and j.lease_until>now() then
    v_state:='running';v_summary:='CaseLink is working on an authorized planning step. Only recorded receipts confirm an external action.';
  elsif j.state='failed' then
    v_state:='failed';v_summary:='A background step could not finish. Your saved information is safe; CaseLink needs to resolve the issue.';
  elsif exists(select 1 from jsonb_array_elements(r.required_actions) a where coalesce(a->>'resolver','parent')='parent' and a->>'resolved' is distinct from 'true') then
    v_state:='needs_parent';v_summary:='A step needs you. See the specific question or permission below; only affected work waits.';
  elsif j.state in ('queued','waiting') and j.run_at<=now() then
    v_state:='queued';v_summary:='Your next planning step is queued for the background service.';
  else
    v_state:='waiting';
    v_summary:=case when r.next_actor='service_operator' then 'CaseLink needs to finish connecting this program before it can send anything. Preparation is saved.'
      when r.next_actor in ('partner','agency') then 'Waiting for the next recorded program update. Check the activity below for what was actually sent.'
      else 'Preparation is saved. The next permitted check will run when it is due.' end;
  end if;
  if v_running and j.state in ('queued','waiting') and isfinite(j.run_at) then v_next:=j.run_at;end if;
  return jsonb_build_object('state',v_state,'summary',v_summary,
    'updatedAt',greatest(r.updated_at,j.updated_at),'nextRunAt',v_next,
    'canContinueAfterClosing',coalesce(v_running and j.state in ('queued','waiting','leased'),false));
end $$;
revoke execute on function parent_private.request_progress(uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create function public.parent_request_progress(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'parent request unavailable' using errcode='42501';end if;
  return parent_private.request_progress(p_request_id);
end $$;
create function public.parent_all_request_progress() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_parent_session() then raise exception 'parent session required' using errcode='42501';end if;
  return coalesce((select jsonb_object_agg(r.id::text,parent_private.request_progress(r.id))
    from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=auth.uid()),'{}'::jsonb);
end $$;
revoke execute on function public.parent_request_progress(uuid),public.parent_all_request_progress() from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_request_progress(uuid),public.parent_all_request_progress() to authenticated;
