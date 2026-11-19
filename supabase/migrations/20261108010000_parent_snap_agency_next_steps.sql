-- Preserve actual scoped agency observations; this does not activate a tracker or a submission transport.
alter table public.parent_jobs add column receipt_wake_lease_token uuid;

create or replace function public.parent_record_referral_status(p_operation_id uuid,p_state text,p_evidence jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_membership parent_private.trusted_memberships; v_operation public.parent_operations; v_evidence jsonb; v_hash text; v_id uuid; v_rank integer; v_current_rank integer; v_status jsonb; v_item jsonb; v_text text; v_date text;
begin
  v_membership:=parent_private.referral_membership(p_operation_id,true);
  select * into v_operation from public.parent_operations where id=p_operation_id;
  perform 1 from public.parent_requests where id=v_operation.request_id for update;
  perform 1 from public.parent_jobs where request_id=v_operation.request_id for update;
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  if v_operation.executed_at is null or v_operation.state in ('prepared','invalidated','failed') then raise exception 'no dispatched operation exists' using errcode='23514'; end if;
  if p_state is null or p_state not in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved')
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object' or pg_column_size(p_evidence)>2000
    or jsonb_typeof(p_evidence->'reference') is distinct from 'string' or jsonb_typeof(p_evidence->'observedAt') is distinct from 'string'
    or length(coalesce(p_evidence->>'reference','')) not between 1 and 200
    or not(p_evidence ?& array['reference','observedAt'])
    or exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('reference','observedAt','reason','agencyStatus'))
    or (p_evidence->>'observedAt')::timestamptz>now()+interval '5 minutes'
    or (p_evidence->>'observedAt')::timestamptz<v_operation.created_at-interval '1 day'
    or (p_evidence ? 'reason' and coalesce(p_evidence->>'reason','') not in ('provider_declined','out_of_area','all_permitted_routes_exhausted')) then raise exception 'attributed referral evidence required' using errcode='23514'; end if;
  if p_evidence ? 'agencyStatus' then
    v_status:=p_evidence->'agencyStatus';
    if v_operation.program_id<>'snap-pa' or v_operation.need not in ('snap_new','snap_renewal','snap_pending','snap_problem')
      or v_operation.action not in ('submit','follow_up') or not parent_private.current_grant(v_operation.request_id,v_operation.request_version)
      or p_state not in ('agency_submitted','assistance_approved','support_received','declined')
      or (p_evidence ? 'reason' and p_state<>'declined')
      or jsonb_typeof(v_status) is distinct from 'object'
      or jsonb_typeof(v_status->'reference') is distinct from 'string' or v_status->>'reference'<>p_evidence->>'reference' or (length(v_status->>'reference')+(select count(*) from regexp_split_to_table(v_status->>'reference','') c where ascii(c)>65535)) not between 1 and 200
      or v_status->>'reference'<>btrim(v_status->>'reference',U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      or p_evidence->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or jsonb_typeof(v_status->'observedAt') is distinct from 'string'
      or v_status->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (v_status->>'observedAt')::timestamptz<>(p_evidence->>'observedAt')::timestamptz
      or not(v_status ?| array['documents','interview','waitingForDecision'])
      or exists(select 1 from jsonb_object_keys(v_status) k where k not in ('reference','observedAt','documents','interview','waitingForDecision'))
      or (v_status ? 'waitingForDecision' and (v_status->'waitingForDecision' is distinct from 'true'::jsonb or p_state<>'agency_submitted'))
      or octet_length(jsonb_build_object('state',p_state,'source','authenticated_partner','reference',p_evidence->'reference','recordedAt',p_evidence->'observedAt','agencyStatus',v_status)::text)>1600
      then raise exception 'scoped SNAP agency status required' using errcode='23514'; end if;
    if v_status ? 'documents' then
      if jsonb_typeof(v_status->'documents') is distinct from 'array' or jsonb_array_length(v_status->'documents') not between 1 and 8 then
        raise exception 'bounded SNAP document descriptions required' using errcode='23514'; end if;
      for v_item in select value from jsonb_array_elements(v_status->'documents') loop
        if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'name') is distinct from 'string'
          or (length(v_item->>'name')+(select count(*) from regexp_split_to_table(v_item->>'name','') c where ascii(c)>65535)) not between 1 and 160
          or v_item->>'name'<>btrim(v_item->>'name',U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
          or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('name','dueDate')) then
          raise exception 'bounded SNAP document descriptions required' using errcode='23514'; end if;
        v_text:=translate(normalize(v_item->>'name',NFKC),U&'\200B\200C\200D\2060\FEFF','');
        if v_text~'[<>@]' or v_text~'(\+?1[[:space:].-]?)?(\([0-9]{3}\)|[0-9]{3})[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4}' or v_text~'[0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4}|[0-9]{12,19}'
          or v_text~*'\m(password|passcode|pin|ssn|social[[:space:]]+security([[:space:]]+number)?|account[[:space:]]+(number|no)|ebt)[[:space:]]*(is[[:space:]]+|[:=#][[:space:]]*)[^[:space:]]+'
          then raise exception 'SNAP descriptions cannot include protected identifiers' using errcode='23514'; end if;
        if v_item ? 'dueDate' then
          v_date:=v_item->>'dueDate';
          if jsonb_typeof(v_item->'dueDate') is distinct from 'string' or v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(v_date::date,'YYYY-MM-DD')<>v_date then
            raise exception 'absolute notice dates required' using errcode='23514'; end if;
        end if;
      end loop;
    end if;
    if v_status ? 'interview' then
      v_item:=v_status->'interview';
      if jsonb_typeof(v_item) is distinct from 'object' or v_item='{}'::jsonb
        or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('scheduledAt','dueDate','channel'))
        or (v_item ? 'channel' and (jsonb_typeof(v_item->'channel') is distinct from 'string' or v_item->>'channel' not in ('phone','in_person','video'))) then
        raise exception 'bounded SNAP interview details required' using errcode='23514'; end if;
      if v_item ? 'scheduledAt' then
        v_date:=v_item->>'scheduledAt';
        if jsonb_typeof(v_item->'scheduledAt') is distinct from 'string'
          or v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
          or not isfinite(v_date::timestamptz) then raise exception 'absolute notice dates required' using errcode='23514'; end if;
      end if;
      if v_item ? 'dueDate' then
        v_date:=v_item->>'dueDate';
        if jsonb_typeof(v_item->'dueDate') is distinct from 'string' or v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(v_date::date,'YYYY-MM-DD')<>v_date then
          raise exception 'absolute notice dates required' using errcode='23514'; end if;
      end if;
    end if;
  end if;
  v_evidence:=p_evidence||jsonb_build_object('source',case when v_membership.role='partner' then 'authenticated_partner' else 'operator_confirmed' end,'attribution',case when v_membership.role='partner' then 'partner_reported' else 'operator_confirmed' end,'packetHash',v_operation.packet_hash);
  v_hash:=encode(sha256(convert_to(jsonb_build_object('state',p_state,'evidence',v_evidence)::text,'UTF8')),'hex');
  select id into v_id from public.parent_receipts where operation_id=p_operation_id and evidence_hash=v_hash;
  if found then return v_id; end if;
  if p_evidence ? 'agencyStatus' and v_operation.state in ('agency_submitted','assistance_approved','support_received','declined') and (p_evidence->>'observedAt')::timestamptz<coalesce(v_operation.evidence->'agencyStatus'->>'observedAt',v_operation.evidence->>'observedAt',v_operation.evidence->>'recordedAt')::timestamptz then
    raise exception 'an older observation cannot replace the current status' using errcode='23514'; end if;
  v_rank:=case p_state when 'sent' then 1 when 'partner_received' then 2 when 'partner_accepted' then 3 when 'agency_submitted' then 4 when 'assistance_approved' then 5 when 'support_received' then 6 else 7 end;
  v_current_rank:=case v_operation.state when 'sent' then 1 when 'partner_received' then 2 when 'partner_accepted' then 3 when 'agency_submitted' then 4 when 'assistance_approved' then 5 when 'support_received' then 6 when 'declined' then 7 when 'unresolved' then 7 else 0 end;
  if v_current_rank>v_rank or (v_operation.state in ('support_received','declined','unresolved') and p_state<>v_operation.state) or (v_operation.state='assistance_approved' and p_state in ('declined','unresolved')) then raise exception 'definitive outcome cannot be silently replaced' using errcode='23514'; end if;
  insert into public.parent_receipts(request_id,operation_id,state,attribution,evidence,evidence_hash,recorded_by)
    values(v_operation.request_id,p_operation_id,p_state,v_evidence->>'attribution',v_evidence,v_hash,auth.uid()) returning id into v_id;
  update public.parent_operations set state=p_state,evidence=v_evidence,updated_at=now() where id=p_operation_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_operation.request_id,'referral.'||p_state,v_membership.role,'A scoped service contact reported: '||replace(p_state,'_',' ')||'.',v_evidence||jsonb_build_object('operationId',p_operation_id));
  -- New details at the same agency state must resume existing work too; never dispatch directly here.
  if p_evidence ? 'agencyStatus' then
    update public.parent_jobs set state=case when state='waiting' then 'queued' else state end,
      run_at=case when state='waiting' then now() else run_at end,
      receipt_wake_lease_token=case when state='leased' then lease_token else null end,updated_at=now()
      where request_id=v_operation.request_id and state in ('waiting','leased') and parent_private.current_grant(request_id,request_version);
  end if;
  return v_id;
end $$;
revoke execute on function public.parent_record_referral_status(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.parent_record_referral_status(uuid,text,jsonb) to authenticated;

create or replace function parent_private.parent_save_job_plan(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_plan jsonb,p_required_actions jsonb,p_next_run_at timestamptz default null,p_next_actor text default null,p_next_trigger text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_actor text; v_trigger text; v_plan jsonb;
begin
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,p_expected_version);
  if p_plan is null or p_required_actions is null or jsonb_typeof(p_plan)<>'object' or pg_column_size(p_plan)>100000 or p_plan->>'version' is distinct from '1' or jsonb_typeof(p_plan->'routes') is distinct from 'array'
    or jsonb_array_length(p_plan->'routes')>30 or jsonb_typeof(p_required_actions)<>'array' or jsonb_array_length(p_required_actions)>30 or pg_column_size(p_required_actions)>50000
    or (p_next_run_at is not null and p_next_run_at<now()+interval '30 seconds') then raise exception 'invalid work result' using errcode='23514'; end if;
  if p_next_actor is not null and p_next_actor not in ('caselink','parent','operator','service_operator','partner','agency') then raise exception 'invalid next owner' using errcode='23514'; end if;
  if p_next_trigger is not null and p_next_trigger not in ('scheduled_follow_up','parent_action_completed','provider_capability_enabled','verified_receipt_available','authorization_renewed','route_review_required','none') then raise exception 'invalid next trigger' using errcode='23514'; end if;
  -- A receipt recorded during this lease invalidates its loaded plan, not the lease or prior side effects.
  if v_job.receipt_wake_lease_token=p_lease_token then
    if v_job.attempts>=48 then
      perform parent_private.parent_fail_job(p_job_id,p_lease_token,'execution_error',null);
      return;
    end if;
    update public.parent_requests set next_actor='caselink',next_trigger='verified_receipt_available',next_run_at=now(),updated_at=now() where id=v_job.request_id;
    update public.parent_jobs set state='queued',run_at=now(),lease_token=null,lease_until=null,receipt_wake_lease_token=null,updated_at=now() where id=p_job_id;
    return;
  end if;
  v_actor:=case when p_next_actor='operator' then 'service_operator' else p_next_actor end;
  v_trigger:=p_next_trigger;
  if v_actor is null then v_actor:=case when p_next_run_at is not null then 'caselink' when exists(select 1 from jsonb_array_elements(p_required_actions) a where not coalesce((a->>'resolved')::boolean,false) and coalesce(a->>'resolver','parent')='parent') then 'parent' else 'service_operator' end; end if;
  if v_trigger is null then v_trigger:=case when p_next_run_at is not null then 'scheduled_follow_up' when v_actor='parent' then 'parent_action_completed' else 'provider_capability_enabled' end; end if;
  -- A late or replayed model snapshot cannot overwrite independently recorded delivery evidence.
  select jsonb_set(p_plan,'{routes}',coalesce(jsonb_agg(case when o.state is null then route else jsonb_set(route,'{state}',to_jsonb(o.state)) end),'[]')) into v_plan
    from jsonb_array_elements(p_plan->'routes') route left join lateral (select state from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=v_job.request_id and o.need=route->>'need' and o.program_id=route->>'programId' and o.state in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved') order by case when state='support_received' then 0 else 1 end,updated_at desc limit 1) o on true;
  update public.parent_requests set plan=v_plan,required_actions=p_required_actions,next_actor=v_actor,next_trigger=v_trigger,
    next_run_at=p_next_run_at,updated_at=now() where id=v_job.request_id;
  if not exists(select 1 from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n(need) where r.id=v_job.request_id and not (
    exists(select 1 from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=r.id and o.need=n.need and o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) or exists(select 1 from public.parent_events e where e.request_id=r.id and parent_private.current_account_evidence(e.request_id,e.evidence->>'need',e.created_at) and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'need'=n.need and e.evidence->>'outcome'='support_received' and e.evidence->>'attribution'='parent_reported'))) then
    perform parent_private.close_request(v_job.request_id,'completed','Every requested need has an attributed report of support received.','parent','Start a new request whenever support is needed again.','caselink');
    return;
  end if;
  if not exists(select 1 from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n(need) where r.id=v_job.request_id and not (
    exists(select 1 from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=r.id and o.need=n.need and o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) or exists(select 1 from public.parent_events e where e.request_id=r.id and parent_private.current_account_evidence(e.request_id,e.evidence->>'need',e.created_at) and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'need'=n.need and e.evidence->>'outcome'='support_received' and e.evidence->>'attribution'='parent_reported') or (
      exists(select 1 from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=r.id and o.need=n.need and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) and not exists(select 1 from jsonb_array_elements_text(r.mandate->'recipientIds') p(program) where parent_private.program_supports_need(p.program,n.need) and not exists(select 1 from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=r.id and o.need=n.need and o.program_id=p.program and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')))) )) then
    perform parent_private.close_request(v_job.request_id,'all_permitted_routes_exhausted','Recorded outcomes show the permitted routes are exhausted for each remaining need.','parent','Start a new request if circumstances change or more program options become available.','caselink');
    return;
  end if;
  update public.parent_jobs set state='waiting',run_at=coalesce(p_next_run_at,'infinity'::timestamptz),lease_token=null,lease_until=null,updated_at=now() where id=p_job_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_job.request_id,'plan.prepared','caselink','CaseLink checked your options and prepared the next steps.',jsonb_build_object('requestVersion',p_expected_version,'nextRunAt',p_next_run_at,'waitingFor',case when p_next_run_at is null then 'required_step_or_provider_connection' else 'scheduled_work' end));
end $$;
