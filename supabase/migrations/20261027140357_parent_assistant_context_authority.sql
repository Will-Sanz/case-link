-- Do not replay conversation from superseded facts or permission into model context.
-- Owner-visible history and its existing retention remain unchanged.

create or replace function parent_private.parent_claim_assistant() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_request uuid; v_message public.parent_assistant_messages; v_token uuid:=gen_random_uuid();
begin
  update public.parent_assistant_messages m set status='failed',error='This question expired or the request changed. Send it again with the latest information.',lease_token=null,lease_until=null,updated_at=now()
    where m.status in ('queued','running') and (m.expires_at<=now() or not parent_private.assistant_owner_available(m.request_id,m.request_version) or (m.status='running' and m.lease_until<=now()));
  if not exists(select 1 from parent_private.worker_health h where h.singleton and h.assistant_ready and h.expires_at>now()) then return null; end if;
  select r.id into v_request from public.parent_requests r join public.parent_assistant_messages m on m.request_id=r.id where m.status='queued' and m.expires_at>now() and parent_private.assistant_owner_available(r.id,m.request_version) order by m.created_at for update of r skip locked limit 1;
  if not found then return null; end if;
  select * into v_message from public.parent_assistant_messages where request_id=v_request and status='queued' for update;
  if not found or not parent_private.assistant_owner_available(v_request,v_message.request_version) then return null; end if;
  update public.parent_assistant_messages set status='running',lease_token=v_token,lease_until=least(expires_at,now()+interval '2 minutes'),updated_at=now() where id=v_message.id;
  return jsonb_build_object('messageId',v_message.id,'leaseToken',v_token,'question',v_message.question,'request',
    (select jsonb_build_object('id',r.id,'household_id',r.household_id,'version',r.version,'status',r.status,'intake',r.intake,'mandate',r.mandate,'plan',r.plan,'required_actions',r.required_actions,'facts',r.facts,'account_changed_at',r.account_changed_at,'created_at',r.created_at,'updated_at',r.updated_at,'next_actor',r.next_actor,'next_trigger',r.next_trigger,'next_run_at',r.next_run_at) from public.parent_requests r where r.id=v_request),
    'operations',(select coalesce(jsonb_agg(v),'[]') from (select id,program_id,need,state,evidence,updated_at from public.parent_operations o where request_id=v_request and parent_private.current_account_evidence(o.request_id,o.need,o.created_at) order by created_at desc limit 50) v),
    'reports',(select coalesce(jsonb_agg(v),'[]') from (select evidence->>'need' need,evidence->>'outcome' outcome,created_at from public.parent_events where request_id=v_request and parent_private.current_account_evidence(request_id,evidence->>'need',created_at) and kind='parent.outcome_reported' and actor='parent' and evidence->>'attribution'='parent_reported' order by created_at desc limit 10) v),
    'documents',(select coalesce(jsonb_agg(v),'[]') from (select status,count(*) total from public.parent_documents where request_id=v_request and status not in ('deleted','deletion_pending') group by status) v),
    'history',(select coalesce(jsonb_agg(v),'[]') from (select request_version,question,answer from public.parent_assistant_messages where request_id=v_request and request_version=v_message.request_version and status='answered' order by created_at desc limit 4) v),
    'progress',parent_private.request_progress(v_request),
    'runtime',(select jsonb_build_object('planningReady',planning_ready and expires_at>now(),'assistantReady',assistant_ready and expires_at>now()) from parent_private.worker_health where singleton));
end $$;
