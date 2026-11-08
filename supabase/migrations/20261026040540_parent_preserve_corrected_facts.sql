alter table public.parent_requests add column account_changed_at jsonb not null default '{}' check(jsonb_typeof(account_changed_at)='object');
create function parent_private.effective_utility_provider(p_intake jsonb,p_facts jsonb,p_need text) returns text
language sql immutable set search_path='' as $$
  select coalesce((select f->>'value' from jsonb_array_elements(p_facts) f where f->>'need'=p_need and f->>'field'='utilityProvider' limit 1),case when p_intake->'utilityProviders' ? (case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end) then case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end when p_intake->'utilityProviders' ? 'other' then 'other' else 'unknown' end);
$$;
create function parent_private.facts_after_intake_change(p_old jsonb,p_new jsonb,p_facts jsonb) returns jsonb
language sql immutable set search_path='' as $$
  with retained as (select f,ordinal from jsonb_array_elements(p_facts) with ordinality answers(f,ordinal) where p_new->'needs' ? (f->>'need') and not (
    (f->>'field' in ('zip','householdSize','accountAuthority') and p_new->(f->>'field') is distinct from p_old->(f->>'field'))
    or (f->>'field' in ('income','incomeAmount','incomeFrequency') and (p_new->'incomeAmount' is distinct from p_old->'incomeAmount' or p_new->'incomeFrequency' is distinct from p_old->'incomeFrequency'))
    or (f->>'field'='utilityProvider' and p_new->'utilityProviders' is distinct from p_old->'utilityProviders' and not(p_new->'utilityProviders' @> jsonb_build_array(f->'value')))
    or (f->>'field'='shutoffDate' and p_new->'shutoffDate' is distinct from p_old->'shutoffDate' and (select count(*) from jsonb_array_elements_text(p_new->'needs') need where need in ('electricity','gas','water'))=1)
  )), compatible as (select coalesce(jsonb_agg(f),'[]') facts from retained)
  select coalesce(jsonb_agg(f order by ordinal),'[]') from retained cross join compatible where not(f->>'field' in ('utilityProvider','accountAuthority','amountDue','totalBalance','dueDate','shutoffDate') and p_old->'utilityProviders' is distinct from p_new->'utilityProviders' and parent_private.effective_utility_provider(p_old,p_facts,f->>'need')<>'unknown' and parent_private.effective_utility_provider(p_old,p_facts,f->>'need') is distinct from parent_private.effective_utility_provider(p_new,compatible.facts,f->>'need'));
$$;
-- Household edits supersede only matching answers; unrelated account corrections remain authoritative.
create or replace function public.parent_correct_request(p_request_id uuid,p_intake jsonb,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_facts jsonb; v_need text; v_changes jsonb;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  perform parent_private.validate_intake(p_intake);
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if v_request.version is distinct from p_expected_version or v_request.status in ('cancelled','closed') then raise exception 'request changed; reload before correcting' using errcode='40001'; end if;
  v_changes:=v_request.account_changed_at;
  v_facts:=parent_private.facts_after_intake_change(v_request.intake,p_intake,v_request.facts);
  for v_need in select jsonb_array_elements_text(p_intake->'needs') loop
    if v_need in ('electricity','gas','water') and v_request.intake->'utilityProviders' is distinct from p_intake->'utilityProviders' and parent_private.effective_utility_provider(v_request.intake,v_request.facts,v_need)<>'unknown' and parent_private.effective_utility_provider(v_request.intake,v_request.facts,v_need) is distinct from parent_private.effective_utility_provider(p_intake,v_facts,v_need) then
      v_changes:=jsonb_set(v_changes,array[v_need],to_jsonb(clock_timestamp()));
      if (select count(*) from jsonb_array_elements_text(p_intake->'needs') n where n in ('electricity','gas','water'))=1 and p_intake->'shutoffDate' is not distinct from v_request.intake->'shutoffDate' then p_intake:=jsonb_set(p_intake,'{shutoffDate}','null'); end if;
    end if;
  end loop;
  perform parent_private.invalidate_work(p_request_id,'You corrected your information. CaseLink will use the updated facts and reconcile work already sent.');
  update public.parent_requests set intake=p_intake,facts=v_facts,account_changed_at=v_changes,version=version+1,plan=null,required_actions='[]',updated_at=now() where id=p_request_id;
  update public.parent_jobs set state=case when v_request.status='active' then 'queued' else 'cancelled' end,request_version=v_request.version+1,run_at=now(),lease_token=null,lease_until=null,last_error=null,updated_at=now() where request_id=p_request_id;
end $$;
revoke execute on function public.parent_correct_request(uuid,jsonb,integer) from public,anon,service_role;
grant execute on function public.parent_correct_request(uuid,jsonb,integer) to authenticated;

create or replace function public.parent_answer_fact(p_request_id uuid,p_need text,p_field text,p_value jsonb,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_intake jsonb; v_category text; v_fact jsonb; v_facts jsonb; v_changes jsonb;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if v_request.version is distinct from p_expected_version or v_request.status not in ('active','paused') then raise exception 'request changed; reload before answering' using errcode='40001'; end if;
  if p_need is null or not(v_request.intake->'needs' ? p_need) or p_value is null or p_field is null or p_field not in ('zip','householdSize','income','incomeAmount','incomeFrequency','utilityProvider','accountAuthority','amountDue','totalBalance','dueDate','shutoffDate') then raise exception 'unsupported or missing factual answer' using errcode='23514'; end if;
  v_category:=case when p_field in ('zip','householdSize') then 'household' when p_field in ('income','incomeAmount','incomeFrequency') then 'income' else 'utility' end;
  if v_category='utility' and p_need not in ('electricity','gas','water') then raise exception 'utility facts must identify the utility need' using errcode='23514'; end if;
  v_intake:=v_request.intake;
  if p_field='income' then
    if jsonb_typeof(p_value)<>'object' or (select count(*) from jsonb_object_keys(p_value))<>2 or not(p_value ?& array['amount','frequency']) then raise exception 'income needs an amount and frequency together' using errcode='23514'; end if;
    perform parent_private.validate_packet(jsonb_build_object('incomeAmount',p_value->'amount','incomeFrequency',p_value->'frequency'),array['income'],array[]::uuid[],'prepare');
    v_intake:=jsonb_set(jsonb_set(v_intake,'{incomeAmount}',p_value->'amount'),'{incomeFrequency}',p_value->'frequency');
  else
    perform parent_private.validate_packet(jsonb_build_object(p_field,p_value),array[v_category],array[]::uuid[],'prepare');
    if p_field in ('zip','householdSize','incomeAmount','incomeFrequency') then v_intake:=jsonb_set(v_intake,array[p_field],p_value); end if;
  end if;
  v_changes:=v_request.account_changed_at;
  v_facts:=parent_private.facts_after_intake_change(v_request.intake,v_intake,v_request.facts);
  if p_field='utilityProvider' and parent_private.effective_utility_provider(v_request.intake,v_request.facts,p_need)<>'unknown' and parent_private.effective_utility_provider(v_request.intake,v_request.facts,p_need) is distinct from p_value#>>'{}' then
    v_facts:=(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements(v_facts) f where not(f->>'need'=p_need and f->>'field' in ('utilityProvider','accountAuthority','amountDue','totalBalance','dueDate','shutoffDate')));
    v_changes:=jsonb_set(v_changes,array[p_need],to_jsonb(clock_timestamp()));
    if (select count(*) from jsonb_array_elements_text(v_intake->'needs') n where n in ('electricity','gas','water'))=1 then v_intake:=jsonb_set(v_intake,'{shutoffDate}','null'); end if;
  end if;
  perform parent_private.validate_intake(v_intake);
  v_fact:=jsonb_build_object('need',p_need,'field',p_field,'value',p_value,'source','parent','confirmedAt',now(),'asOf',current_date);
  update public.parent_requests set intake=v_intake,account_changed_at=v_changes,plan=case when v_changes is distinct from v_request.account_changed_at then null else plan end,
    facts=(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements(v_facts) f where not(f->>'need'=p_need and f->>'field'=p_field))||jsonb_build_array(v_fact),
    required_actions=(select coalesce(jsonb_agg(case when a->>'need'=p_need and a->>'field'=p_field then a||'{"resolved":true}'::jsonb else a end),'[]') from jsonb_array_elements(required_actions) a)
    where id=p_request_id;
  perform parent_private.requeue_parent_change(p_request_id,'You answered a necessary question. CaseLink will use this current fact and resume the permitted work.');
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'fact.parent_answered','parent','You supplied a current fact for a support step.',jsonb_build_object('need',p_need,'field',p_field,'attribution','parent_reported'));
end $$;
create function parent_private.current_account_evidence(p_request uuid,p_need text,p_created_at timestamptz) returns boolean
language sql stable set search_path='' as $$
  select p_created_at>=coalesce((account_changed_at->>p_need)::timestamptz,'-infinity'::timestamptz) from public.parent_requests where id=p_request;
$$;
revoke execute on function parent_private.effective_utility_provider(jsonb,jsonb,text),parent_private.facts_after_intake_change(jsonb,jsonb,jsonb),parent_private.current_account_evidence(uuid,text,timestamptz) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;



create or replace function parent_private.close_request(p_request_id uuid,p_reason text,p_detail text,p_next_owner text,p_reentry text,p_actor text) returns void
language plpgsql set search_path='' as $$
declare v_request public.parent_requests; v_need text; v_program text; v_received boolean; v_all_received boolean:=true;
begin
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if not found or v_request.status not in ('active','paused') or p_reason is null or p_reason not in ('completed','parent_choice','all_permitted_routes_exhausted','provider_declined','out_of_area')
    or length(btrim(coalesce(p_detail,''))) not between 1 and 500 or p_next_owner is null or p_next_owner not in ('parent','partner','service_operator')
    or length(btrim(coalesce(p_reentry,''))) not between 1 and 500 then raise exception 'closure needs a reason, owner and re-entry path' using errcode='23514'; end if;
  if p_reason<>'parent_choice' then
    for v_need in select jsonb_array_elements_text(v_request.intake->'needs') loop
      select exists(select 1 from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=p_request_id and o.need=v_need and o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed'))
        or exists(select 1 from public.parent_events e where e.request_id=p_request_id and parent_private.current_account_evidence(e.request_id,e.evidence->>'need',e.created_at) and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'attribution'='parent_reported' and e.evidence->>'need'=v_need and e.evidence->>'outcome'='support_received') into v_received;
      if v_received then continue; end if;
      v_all_received:=false;
      if p_reason='completed' then raise exception 'every need requires attributed support received evidence' using errcode='23514'; end if;
      -- Missing connectors, unattempted needs and silence never count as exhausted routes.
      for v_program in select jsonb_array_elements_text(v_request.mandate->'recipientIds') loop
        if parent_private.program_supports_need(v_program,v_need) and not exists(select 1 from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=p_request_id and o.need=v_need and o.program_id=v_program and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed') and (p_reason<>'out_of_area' or o.evidence->>'reason'='out_of_area')) then raise exception 'permitted routes are not evidenced as exhausted for this need' using errcode='23514'; end if;
      end loop;
      if not exists(select 1 from public.parent_operations o where parent_private.current_account_evidence(o.request_id,o.need,o.created_at) and o.request_id=p_request_id and o.need=v_need and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) then raise exception 'every unresolved need requires an attributed outcome' using errcode='23514'; end if;
    end loop;
    if v_all_received and p_reason<>'completed' then raise exception 'successful needs require completed closure' using errcode='23514'; end if;
  end if;
  perform parent_private.invalidate_work(p_request_id,'This request was closed with a recorded reason and re-entry path.');
  update public.parent_requests set status='closed',closed_reason=p_reason,mandate_revoked_at=now(),version=version+1,next_actor=p_next_owner,next_trigger='parent_reentry',next_run_at=null,updated_at=now() where id=p_request_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'request.closed',p_actor,'This request is closed. You can return for support.',jsonb_build_object('reason',p_reason,'detail',p_detail,'nextOwner',p_next_owner,'reentry',p_reentry));
end $$;

create or replace function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.current_grant(p_request,p_version) and exists(select 1 from public.parent_requests r
    where r.id=p_request and r.mandate->'recipientIds' ? p_program and r.mandate->'allowedActions' ? p_action
    and p_data<@array(select jsonb_array_elements_text(r.mandate->'allowedData'))
    and (cardinality(p_documents)=0 or ('documents'=any(p_data) and not exists(select 1 from unnest(p_documents) d_id where not exists(select 1 from public.parent_documents d where d.id=d_id and d.request_id=r.id and d.status='validated' and d.expires_at>now()))))
    and (p_action in ('research','prepare') or (r.mandate->>'mode'='full' and exists(select 1 from parent_private.provider_capabilities c where c.program_id=p_program and c.action=p_action and c.enabled and c.transport_verified and c.requires_form is not null and c.verified_until>now() and c.required_acts is not null
      and not exists(select 1 from jsonb_each(p_packet) f where not f.key=any(c.allowed_fields) or c.field_categories->>f.key is null or not(c.field_categories->>f.key=any(p_data))))))
    and (p_action in ('research','prepare') or not('utility'=any(p_data)) or (p_need is not null and coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority') in ('self','authorized_caregiver') and (not(p_packet ? 'accountAuthority') or p_packet->>'accountAuthority'=coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority'))))
    and (p_action in ('research','prepare') or p_need not in ('electricity','gas','water') or (parent_private.effective_utility_provider(r.intake,r.facts,p_need) in ('unknown',case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end) and coalesce(p_packet->>'utilityProvider',case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end)=case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end))
    and (p_action<>'schedule' or r.mandate->>'bookingPreference'<>'ask_me'));
$$;

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
