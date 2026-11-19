-- A need-specific mirror change is not a correction of every other need.
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
  v_facts:=v_request.facts;
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
  -- A mirrored answer remains exact-need evidence even if its original fact is later removed.
  update public.parent_requests set intake_need_scoped_fields=array(
    select distinct k from unnest(intake_need_scoped_fields||array(
      select f from unnest(array['zip','householdSize','incomeAmount','incomeFrequency']) f
      where v_intake->f is distinct from v_request.intake->f
    )) k
  ) where id=p_request_id;
  perform parent_private.requeue_parent_change(p_request_id,'You answered a necessary question. CaseLink will use this current fact and resume the permitted work.');
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'fact.parent_answered','parent','You supplied a current fact for a support step.',jsonb_build_object('need',p_need,'field',p_field,'attribution','parent_reported'));
end $$;
