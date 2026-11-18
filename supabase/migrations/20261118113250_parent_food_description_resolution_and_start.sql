-- Typed clarification is deterministic. It never creates another model charge or extends the original content deadline.
alter table parent_private.food_description_drafts add column routing_facts jsonb not null default '{}' check(jsonb_typeof(routing_facts)='object'),
  add column resolve_key uuid, add column resolve_hash text;
alter table parent_private.food_description_calls add column model_projection jsonb, add column result_selection jsonb;

-- Keep the original minimized model input distinct from a later, deterministic routing projection.
do $$declare definition text; before text;
begin
  definition:=pg_get_functiondef('parent_private.food_description_context(parent_private.food_description_drafts)'::regprocedure);
  before:='''facts'',''{}''::jsonb';
  if position(before in definition)=0 then raise exception 'description context target changed'; end if;
  execute replace(definition,before,'''facts'',d.routing_facts');
  definition:=pg_get_functiondef('parent_private.parent_reserve_food_description(uuid,integer,uuid)'::regprocedure);
  before:='insert into parent_private.food_description_calls(draft_id,owner_id,revision,project_id) values(d.id,d.owner_id,d.revision,(select food_description_project_id from parent_private.processing_controls where singleton))';
  if position(before in definition)=0 then raise exception 'description immutable attempt target changed'; end if;
  execute replace(definition,before,'insert into parent_private.food_description_calls(draft_id,owner_id,revision,project_id,model_projection) values(d.id,d.owner_id,d.revision,(select food_description_project_id from parent_private.processing_controls where singleton),d.projection)');
  definition:=pg_get_functiondef('parent_private.parent_finish_food_description(uuid,integer,uuid,jsonb)'::regprocedure);
  before:='update parent_private.food_description_drafts set state=''result''';
  if position(before in definition)=0 then raise exception 'description result target changed'; end if;
  execute replace(definition,before,'update parent_private.food_description_calls set result_selection=p_selection where draft_id=d.id and revision=d.revision and result_selection is null; '||before);
end $$;

create function parent_private.food_description_current_routing_facts(d parent_private.food_description_drafts) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(d.routing_facts)
    where parent_private.fixed_source_timestamp(value->>'confirmedAt')<=clock_timestamp() and parent_private.fixed_source_timestamp(value->>'expiresAt')>clock_timestamp();
$$;
create function parent_private.food_description_minimized_history(p_context jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('need',h->'need','state',h->'state','current',h->'current') order by h->>'need',h->>'state',h->>'current'),'[]')
    from jsonb_array_elements(p_context->'history') h where h->'current'='true';
$$;
create function parent_private.food_description_repeated_input(d parent_private.food_description_drafts,p_description text,p_facts jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare charged jsonb; current_context jsonb; current_history jsonb;
begin
  select model_projection into charged from parent_private.food_description_calls where draft_id=d.id order by revision desc limit 1;
  if charged is null or d.content_expires_at<=clock_timestamp() then return false; end if;
  current_context:=parent_private.food_description_context(d);
  current_history:=parent_private.food_description_minimized_history(current_context);
  -- Display locale and revision are not new interpretation work. Existing content supplies this comparison only until its fixed expiry.
  return coalesce(charged->>'description'=p_description and charged->'routingFacts'=p_facts
    and charged->'catalogVersion'=current_context->'catalogVersion' and charged->'capabilityVersion'=current_context->'capabilityVersion'
    and charged->'ownedFoodHistory'=current_history and charged->'excludedNeedIds'=current_context->'excludedNeedIds',false);
end $$;

-- Only explicit enum answers from this tab join the minimized input; private profile/application fields cannot enter here.
create or replace function public.parent_queue_food_description(p_draft_id uuid,p_expected_owner uuid,p_expected_revision integer,p_queue_key uuid,p_input jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts; v_hash text; v_facts jsonb; item record; confirmed timestamptz;
begin
  if public.parent_get_deletion_status()<>'active' or auth.uid() is distinct from p_expected_owner then raise exception 'description owner unavailable' using errcode='42501'; end if;
  select * into d from parent_private.food_description_drafts where id=p_draft_id and owner_id=auth.uid() for update;
  if not found then raise exception 'description owner unavailable' using errcode='42501'; end if;
  if not parent_private.food_description_safe(p_input-'routingAnswers') or p_queue_key is null
    or (p_input ? 'routingAnswers' and (coalesce(jsonb_typeof(p_input->'routingAnswers'),'')<>'object' or (p_input->'routingAnswers')-array['foodForTwoDays','benefitHistory','existingIssue']<>'{}'))
    then raise exception 'description invalid input' using errcode='23514'; end if;
  v_hash:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
  if d.queue_key=p_queue_key and d.payload_hash=v_hash and d.revision=p_expected_revision+1 and d.state not in ('cancelled','expired') and d.content_expires_at>clock_timestamp() then return d.revision; end if;
  if d.queue_key=p_queue_key or d.revision is distinct from p_expected_revision or d.state in ('cancelled','expired') or d.content_expires_at<=clock_timestamp() then raise exception 'description changed' using errcode='PT409'; end if;
  if not parent_private.food_description_collection_available(auth.uid()) then raise exception 'description unavailable' using errcode='42501'; end if;
  v_facts:=parent_private.food_description_current_routing_facts(d);
  for item in select key,value from jsonb_each(coalesce(p_input->'routingAnswers','{}')) loop
    confirmed:=parent_private.fixed_source_timestamp(item.value->>'confirmedAt');
    if jsonb_typeof(item.value)<>'object' or not(item.value ?& array['value','confirmedAt']) or item.value-array['value','confirmedAt']<>'{}'
      or confirmed is null or confirmed>clock_timestamp()
      or (case item.key when 'foodForTwoDays' then coalesce(item.value->>'value','') not in ('yes','no','not_sure')
        when 'benefitHistory' then coalesce(item.value->>'value','') not in ('never','applied','receiving','not_sure')
        when 'existingIssue' then coalesce(item.value->>'value','') not in ('renewal','stopped','card','none','not_sure') else true end)
      then raise exception 'description invalid routing answer' using errcode='23514'; end if;
    if confirmed+interval '24 hours'>clock_timestamp() and (not(v_facts ? item.key) or v_facts#>array[item.key,'value'] is distinct from item.value->'value') then
      v_facts:=v_facts||jsonb_build_object(item.key,jsonb_build_object('value',item.value->'value','source','parent_typed','confirmedAt',confirmed,'expiresAt',least(d.content_expires_at,confirmed+interval '24 hours')));
    end if;
  end loop;
  if v_facts#>>'{benefitHistory,value}' is distinct from 'receiving' then v_facts:=v_facts-'existingIssue'; end if;
  if parent_private.food_description_repeated_input(d,p_input->>'description',v_facts) then raise exception 'description unchanged charged input' using errcode='PT409'; end if;
  update parent_private.food_description_drafts set revision=revision+1,state='queued',input=p_input-'routingAnswers',routing_facts=v_facts,payload_hash=v_hash,projection=null,selection=null,
    resolve_key=null,resolve_hash=null,queue_key=p_queue_key,dispatch_until=least(content_expires_at,clock_timestamp()+interval '15 minutes'),lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where id=d.id returning * into d;
  update parent_private.food_description_drafts set context=parent_private.food_description_context(d) where id=d.id;
  return d.revision;
end $$;

create function parent_private.food_description_content_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.state in ('cancelled','expired') or new.content_expires_at<=clock_timestamp() then
    new.routing_facts:='{}'; new.resolve_hash:=null;
    update parent_private.food_description_calls set model_projection=null,result_selection=null where draft_id=new.id and (model_projection is not null or result_selection is not null);
  end if;
  return new;
end $$;
create trigger parent_food_description_content_erasure before update on parent_private.food_description_drafts for each row execute function parent_private.food_description_content_changed();
create function parent_private.immutable_food_description_attempt() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.draft_id,new.owner_id,new.revision,new.charge_token,new.created_at,new.project_id) is distinct from (old.draft_id,old.owner_id,old.revision,old.charge_token,old.created_at,old.project_id)
    or (old.model_projection is not null and new.model_projection is not null and new.model_projection is distinct from old.model_projection)
    or (old.result_selection is not null and new.result_selection is not null and new.result_selection is distinct from old.result_selection)
    or (old.usage is not null and new.usage is distinct from old.usage) then raise exception 'description attempt is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger parent_food_description_attempt_immutable before update on parent_private.food_description_calls for each row execute function parent_private.immutable_food_description_attempt();

create function parent_private.food_description_values(d parent_private.food_description_drafts) returns jsonb
language plpgsql stable set search_path='' as $$
declare v_values jsonb:='{}'; item record;
begin
  for item in select key,value from jsonb_each(parent_private.food_description_current_routing_facts(d)) loop v_values:=v_values||jsonb_build_object(item.key,item.value->'value'); end loop;
  for item in select value->>'questionId' key,value->'value' value from jsonb_array_elements(coalesce(d.selection->'assertions','[]')) loop
    if not(v_values ? item.key) then v_values:=v_values||jsonb_build_object(item.key,item.value); end if;
  end loop;
  return v_values;
end $$;
create function parent_private.food_description_answers(d parent_private.food_description_drafts) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('foodForTwoDays',coalesce(v->'foodForTwoDays','"not_sure"'), 'benefitHistory',coalesce(v->'benefitHistory','"not_sure"'),
    'existingIssue',case when v->>'benefitHistory'='receiving' then coalesce(v->'existingIssue','"not_sure"') else 'null'::jsonb end)
    from (select parent_private.food_description_values(d) v) facts;
$$;
create function parent_private.food_description_needs(p_answers jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select to_jsonb(array_remove(array[
    case when p_answers->>'foodForTwoDays'<>'yes' then 'food_now' end,
    case p_answers->>'benefitHistory' when 'never' then 'snap_new' when 'applied' then 'snap_pending'
      when 'receiving' then case when p_answers->>'existingIssue'='renewal' then 'snap_renewal' when p_answers->>'existingIssue' in ('stopped','card','not_sure') then 'snap_problem' end end
  ],null));
$$;
create function public.parent_resolve_food_description(p_draft uuid,p_expected_owner uuid,p_expected_revision integer,p_answers jsonb,p_changed_fields text[],p_idempotency_key uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts; next_d parent_private.food_description_drafts; v_values jsonb; v_facts jsonb; original_answers jsonb; v_selection jsonb; v_projection jsonb; v_context jsonb; field text; v_hash text; v_needs jsonb;
begin
  if public.parent_get_deletion_status()<>'active' or auth.uid() is distinct from p_expected_owner then raise exception 'description owner unavailable' using errcode='42501'; end if;
  select * into d from parent_private.food_description_drafts where id=p_draft and owner_id=auth.uid() for update;
  if not found then raise exception 'description owner unavailable' using errcode='42501'; end if;
  if p_idempotency_key is null or p_changed_fields is null or not(p_changed_fields<@array['foodForTwoDays','benefitHistory','existingIssue'])
    or cardinality(p_changed_fields)<>(select count(distinct value) from unnest(p_changed_fields) value)
    or p_answers is null or jsonb_typeof(p_answers)<>'object' or not(p_answers ?& array['foodForTwoDays','benefitHistory','existingIssue'])
    or p_answers-array['foodForTwoDays','benefitHistory','existingIssue']<>'{}'
    or coalesce(p_answers->>'foodForTwoDays','') not in ('yes','no','not_sure') or coalesce(p_answers->>'benefitHistory','') not in ('never','applied','receiving','not_sure')
    or (case when p_answers->>'benefitHistory'='receiving' then coalesce(p_answers->>'existingIssue','') not in ('renewal','stopped','card','none','not_sure') else p_answers->'existingIssue'<>'null'::jsonb end)
    then raise exception 'description invalid clarification' using errcode='23514'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_array(p_answers,(select jsonb_agg(value order by value) from unnest(p_changed_fields) value))::text,'UTF8')),'hex');
  if d.resolve_key=p_idempotency_key and d.resolve_hash=v_hash and d.revision in (p_expected_revision,p_expected_revision+1) and d.state='result' and d.content_expires_at>clock_timestamp() then return d.revision; end if;
  if d.resolve_key=p_idempotency_key or d.revision is distinct from p_expected_revision or d.state<>'result' or d.content_expires_at<=clock_timestamp() then raise exception 'description changed' using errcode='PT409'; end if;
  if not parent_private.food_description_owner_available(d.owner_id) or d.context is distinct from parent_private.food_description_context(d) then raise exception 'description unavailable' using errcode='42501'; end if;
  v_values:=parent_private.food_description_values(d); original_answers:=parent_private.food_description_answers(d);
  v_facts:=parent_private.food_description_current_routing_facts(d);
  foreach field in array array['foodForTwoDays','benefitHistory','existingIssue'] loop
    if not(field=any(p_changed_fields)) and not(field='existingIssue' and 'benefitHistory'=any(p_changed_fields)) and p_answers->field is distinct from original_answers->field then raise exception 'description unconfirmed clarification' using errcode='23514'; end if;
    if field=any(p_changed_fields) and p_answers->field<>'null'::jsonb and (p_answers->field is distinct from v_values->field or not(v_facts ? field)) then
      v_facts:=v_facts||jsonb_build_object(field,jsonb_build_object('value',p_answers->field,'source','parent_typed','confirmedAt',clock_timestamp(),'expiresAt',d.content_expires_at));
    end if;
  end loop;
  if p_answers->>'benefitHistory'<>'receiving' then v_facts:=v_facts-'existingIssue'; end if;
  if v_facts=d.routing_facts then
    update parent_private.food_description_drafts set resolve_key=p_idempotency_key,resolve_hash=v_hash where id=d.id; return d.revision;
  end if;
  v_needs:=parent_private.food_description_needs(p_answers);
  select coalesce(jsonb_agg(need order by ordinal),'[]') into v_needs from jsonb_array_elements(v_needs) with ordinality n(need,ordinal)
    where not exists(select 1 from jsonb_array_elements(d.selection->'exclusions') e where e->'need'=n.need);
  v_selection:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(d.selection,'{needIds}',v_needs),'{selections}','[]'),'{questionIds}','[]'),'{assertions}',
    (select coalesce(jsonb_agg(assertion),'[]') from jsonb_array_elements(d.selection->'assertions') assertion where not(v_facts ? (assertion->>'questionId')) and not(assertion->>'questionId'='existingIssue' and p_answers->>'benefitHistory'<>'receiving')));
  next_d:=d; next_d.revision:=d.revision+1; next_d.routing_facts:=v_facts;
  v_context:=parent_private.food_description_context(next_d);
  v_projection:=jsonb_set(jsonb_set(jsonb_set(d.projection,'{revision}',to_jsonb(next_d.revision)),'{routingFacts}',v_facts),'{ownedFoodHistory}',parent_private.food_description_minimized_history(v_context));
  update parent_private.food_description_drafts set revision=revision+1,routing_facts=v_facts,context=v_context,projection=v_projection,selection=v_selection,
    resolve_key=p_idempotency_key,resolve_hash=v_hash,updated_at=clock_timestamp() where id=d.id returning * into d;
  if d.context is distinct from parent_private.food_description_context(d) or not parent_private.food_description_owner_available(d.owner_id) then raise exception 'description changed' using errcode='PT409'; end if;
  return d.revision;
end $$;
revoke execute on function parent_private.food_description_minimized_history(jsonb),parent_private.food_description_current_routing_facts(parent_private.food_description_drafts),parent_private.food_description_repeated_input(parent_private.food_description_drafts,text,jsonb),parent_private.food_description_content_changed(),parent_private.immutable_food_description_attempt(),parent_private.food_description_values(parent_private.food_description_drafts),parent_private.food_description_answers(parent_private.food_description_drafts),parent_private.food_description_needs(jsonb) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
revoke execute on function public.parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid) to authenticated;

-- Export the exact minimized attempted input while it exists, without extending its original deadline.
do $$declare definition text; before text;
begin
  definition:=pg_get_functiondef('public.parent_get_food_descriptions()'::regprocedure);
  before:='''revision'',c.revision,''chargedAt'',c.created_at,''usage'',c.usage';
  if position(before in definition)=0 then raise exception 'description rights export target changed'; end if;
  execute replace(definition,before,before||',''projectId'',c.project_id,''modelProjection'',case when d.content_expires_at>clock_timestamp() then c.model_projection else null end,''selection'',case when d.content_expires_at>clock_timestamp() then c.result_selection else null end');
  definition:=pg_get_functiondef('public.parent_get_food_descriptions()'::regprocedure);
  before:='''queueKey'',d.queue_key';
  if position(before in definition)=0 then raise exception 'description repeated-input metadata target changed'; end if;
  execute replace(definition,before,'''sameChargedContext'',case when d.state not in (''cancelled'',''expired'') and d.content_expires_at>clock_timestamp() then parent_private.food_description_repeated_input(d,d.input->>''description'',parent_private.food_description_current_routing_facts(d)) else false end,'||before);
end $$;

-- The service request retains only an opaque provenance pair, never description text or a content hash.
alter table public.parent_requests add column description_source jsonb check(description_source is null or coalesce((
  jsonb_typeof(description_source)='object' and description_source-array['draftId','revision']='{}'
  and description_source ?& array['draftId','revision'] and description_source->>'draftId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(description_source->'revision')='number' and (description_source->>'revision')::numeric between 1 and 2147483647
  and (description_source->>'revision')::numeric=trunc((description_source->>'revision')::numeric)),false));
create index parent_description_revision_sources on public.parent_requests((description_source->>'draftId'),(description_source->>'revision')) where description_source is not null;
create function parent_private.immutable_food_description_source() returns trigger language plpgsql set search_path='' as $$
begin
  if old.description_source is not null and new.description_source is distinct from old.description_source then raise exception 'description provenance is immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger parent_food_description_source_immutable before update on public.parent_requests for each row execute function parent_private.immutable_food_description_source();

-- Owned current scope stays outside the model input; same-source prior uses remain receipts rather than new work.
create function parent_private.food_description_current_requests(p_owner uuid,p_source jsonb) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('ownerId',p_owner,'requestId',r.id,'requestVersion',r.version,'requestStatus',r.status,'needIds',scope.needs,'pendingSnapFollowUp',r.status in ('active','paused') and r.mandate->'allowedActions' ? 'follow_up' and (r.mandate->>'expiresAt')::timestamptz>clock_timestamp() and exists(
      select 1 from jsonb_array_elements_text(r.intake->'needs') application_need cross join lateral jsonb_array_elements_text(r.mandate->'recipientIds') recipient
      cross join lateral parent_private.current_program_operation(r.id,application_need,recipient) operation
      where application_need in ('snap_new','snap_renewal') and parent_private.program_supports_need(recipient,application_need) and operation.state in ('agency_submitted','assistance_approved')
        and not exists(select 1 from public.parent_operations completed where completed.request_id=r.id and completed.need=application_need and completed.state='support_received'
          and completed.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed') and parent_private.current_account_evidence(completed.request_id,completed.need,completed.created_at))
        and operation.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed'))) order by r.created_at desc,r.id),'[]')
  from public.parent_requests r join public.parent_households h on h.id=r.household_id
    left join lateral (select evidence->'descriptionNeeds' needs from public.parent_events e where e.request_id=r.id and e.kind='request.started' and e.actor='parent' and e.evidence->'descriptionSource'=p_source order by e.created_at,e.id limit 1) original on true
    cross join lateral (select coalesce(jsonb_agg(distinct need order by need),'[]') needs from jsonb_array_elements_text(case when r.description_source=p_source then coalesce(original.needs,'[]'::jsonb)||(r.intake->'needs') else r.intake->'needs' end) need
      where need=any(array['food_now','snap_new','snap_pending','snap_renewal','snap_problem'])
        and (r.description_source=p_source and original.needs ? need or exists(select 1 from jsonb_array_elements_text(r.mandate->'recipientIds') recipient where parent_private.program_supports_need(recipient,need)))
        and (r.description_source=p_source or need<>'food_now' or not(parent_private.parent_reported_support_received(r.id,'food_now') or exists(
          select 1 from public.parent_operations o where o.request_id=r.id and o.need='food_now' and o.state='support_received'
            and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')
            and parent_private.current_account_evidence(o.request_id,o.need,o.created_at))))) scope
  where h.owner_id=p_owner and (r.status in ('active','paused') or r.description_source=p_source) and jsonb_array_length(scope.needs)>0;
$$;
revoke execute on function parent_private.food_description_current_requests(uuid,jsonb) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
do $$declare definition text; before text;
begin
  definition:=pg_get_functiondef('public.parent_food_description_result(uuid)'::regprocedure);
  before:='''currentContext'',parent_private.food_description_context(d))';
  if position(before in definition)=0 then raise exception 'description current-work target changed'; end if;
  execute replace(definition,before,'''currentContext'',parent_private.food_description_context(d),''currentRequests'',parent_private.food_description_current_requests(d.owner_id,jsonb_build_object(''draftId'',d.id,''revision'',d.revision)))');
  definition:=pg_get_functiondef('parent_private.food_description_context(parent_private.food_description_drafts)'::regprocedure);
  before:='where h.owner_id=d.owner_id and n.need=any(array[''snap_new'',''snap_pending'',''snap_renewal'',''snap_problem''])';
  if position(before in definition)=0 then raise exception 'description same-source history target changed'; end if;
  execute replace(definition,before,before||' and r.description_source is distinct from jsonb_build_object(''draftId'',d.id,''revision'',d.revision)');
end $$;

create function public.parent_start_food_description_request(p_description_source jsonb,p_intake jsonb,p_mandate jsonb,p_idempotency_key uuid,
  p_snap_details jsonb default null,p_snap_notice_version text default null,p_family_profile_source jsonb default null,p_zip_source jsonb default null,p_snap_template_id text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare d parent_private.food_description_drafts; household uuid; existing public.parent_requests; result uuid; v_needs jsonb; v_values jsonb; known boolean;
begin
  household:=public.parent_ensure_account();
  perform 1 from public.parent_households where id=household for no key update;
  if p_idempotency_key is null or p_description_source is null or jsonb_typeof(p_description_source)<>'object'
    or p_description_source-array['draftId','revision']<>'{}' or not(p_description_source ?& array['draftId','revision'])
    or coalesce(p_description_source->>'draftId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_description_source->'revision') is distinct from 'number' or coalesce(p_description_source->>'revision','')!~'^[1-9][0-9]{0,9}$' or (p_description_source->>'revision')::numeric>2147483647
    or (p_snap_details is null and (p_snap_notice_version is not null or p_family_profile_source is not null or p_snap_template_id is not null))
    or (p_snap_details is not null and p_zip_source is not null)
    or (p_zip_source is not null and (jsonb_typeof(p_zip_source)<>'object' or p_zip_source-array['sourceRequestId','sourceVersion']<>'{}' or not(p_zip_source ?& array['sourceRequestId','sourceVersion'])
      or coalesce(p_zip_source->>'sourceRequestId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(p_zip_source->'sourceVersion') is distinct from 'number' or coalesce(p_zip_source->>'sourceVersion','')!~'^[1-9][0-9]{0,9}$' or (p_zip_source->>'sourceVersion')::numeric>2147483647))
    then raise exception 'description invalid start' using errcode='23514'; end if;
  select * into existing from public.parent_requests where household_id=household and start_key=p_idempotency_key for update;
  known:=found;
  if not known and p_zip_source is not null then
    begin
      perform 1 from public.parent_requests where id=(p_zip_source->>'sourceRequestId')::uuid and household_id=household for update nowait;
    exception when lock_not_available then raise exception 'parent_reuse_source_changed' using errcode='P0001'; end;
  end if;
  if not known then
    begin
      perform 1 from public.parent_requests where household_id=household and intake->'needs' ?| array['food_now','snap_new','snap_pending','snap_renewal','snap_problem'] order by id for update nowait;
    exception when lock_not_available then raise exception 'description current work is changing' using errcode='PT409'; end;
  end if;
  -- Match deletion and existing private starts: request before account, then draft; reserve never asks for a request lock.
  perform 1 from public.parent_accounts where id=auth.uid() for update;
  if public.parent_get_deletion_status()<>'active' then raise exception 'description owner unavailable' using errcode='42501'; end if;
  if known then
    if existing.description_source is distinct from p_description_source then raise exception 'description start changed' using errcode='PT409'; end if;
    if p_snap_details is null and p_zip_source is null and (existing.intake is distinct from p_intake or existing.mandate is distinct from p_mandate) then raise exception 'description start changed' using errcode='PT409'; end if;
    -- Delegate the existing exact receipt before current facts/source/expiry checks. It never reapplies an old packet.
  else
    if exists(select 1 from public.parent_requests previous join public.parent_events e on e.request_id=previous.id cross join lateral jsonb_array_elements_text(e.evidence->'descriptionNeeds') need where previous.household_id=household and previous.description_source=p_description_source and e.kind='request.started' and e.actor='parent' and e.evidence->'descriptionSource'=p_description_source and p_intake->'needs' ? need) then raise exception 'description need already started' using errcode='PT409'; end if;
    select * into d from parent_private.food_description_drafts where id=(p_description_source->>'draftId')::uuid and owner_id=auth.uid() for update;
    if not found or d.revision is distinct from (p_description_source->>'revision')::integer or d.state<>'result' or d.content_expires_at<=clock_timestamp()
      or not parent_private.food_description_owner_available(d.owner_id) or d.context is distinct from parent_private.food_description_context(d)
      then raise exception 'description source changed' using errcode='PT409'; end if;
    v_values:=parent_private.food_description_values(d); v_needs:=parent_private.food_description_needs(parent_private.food_description_answers(d));
    if jsonb_typeof(p_intake->'needs') is distinct from 'array' or jsonb_array_length(p_intake->'needs') not between 1 and 2
      or (select count(distinct need) from jsonb_array_elements_text(p_intake->'needs') need)<>jsonb_array_length(p_intake->'needs')
      or (select count(*) from jsonb_array_elements_text(p_intake->'needs') need where need<>'food_now')>1
      or not(p_intake->'needs'<@v_needs) or not((p_intake->'needs')<@(d.selection->'needIds'))
      or (not(v_values ? 'foodForTwoDays') and not exists(select 1 from jsonb_array_elements(d.selection->'exclusions') e where e->>'need'='food_now'))
      or (not(v_values ? 'benefitHistory') and exists(select 1 from unnest(array['snap_new','snap_pending','snap_renewal','snap_problem']) need where not exists(select 1 from jsonb_array_elements(d.selection->'exclusions') e where e->>'need'=need)))
      or (v_values->>'benefitHistory'='receiving' and not(v_values ? 'existingIssue'))
      or (v_values->>'foodForTwoDays'='no' and p_intake->>'urgency'<>'today')
      or exists(select 1 from jsonb_array_elements(d.selection->'exclusions') e where p_intake->'needs' ? (e->>'need'))
      or (p_intake->'needs' ? 'snap_new' and exists(select 1 from jsonb_array_elements(d.context->'history') h where h->>'need'<>'snap_problem' and (h->>'state' not in ('checking','prepared','withdrawn') or h->>'need' in ('snap_new','snap_pending') and h->>'requestStatus' in ('active','paused'))))
      or exists(select 1 from jsonb_array_elements(parent_private.food_description_current_requests(auth.uid(),p_description_source)) current_request
        cross join lateral jsonb_array_elements_text(current_request->'needIds') covered where
          p_intake->'needs' ? covered or (p_intake->'needs' ? 'snap_pending' and current_request->'pendingSnapFollowUp'='true'))
      then raise exception 'description routing changed' using errcode='PT409'; end if;
    perform parent_private.validate_intake(p_intake); perform parent_private.validate_mandate(p_mandate);
    if exists(select 1 from jsonb_array_elements_text(p_mandate->'recipientIds') recipient where not exists(
        select 1 from jsonb_array_elements(d.projection->'candidates') candidate where candidate->>'programId'=recipient
          and p_intake->'needs' ? (candidate->>'need') and (candidate->>'sourceCheckedAt')::date::timestamp at time zone 'UTC'<=clock_timestamp() and ((candidate->>'sourceCheckedAt')::date::timestamp at time zone 'UTC')+interval '30 days'>=clock_timestamp()))
      or exists(select 1 from jsonb_array_elements_text(p_intake->'needs') need where not exists(
        select 1 from jsonb_array_elements(d.projection->'candidates') candidate where candidate->>'need'=need and p_mandate->'recipientIds' ? (candidate->>'programId')
          and (candidate->>'sourceCheckedAt')::date::timestamp at time zone 'UTC'<=clock_timestamp() and ((candidate->>'sourceCheckedAt')::date::timestamp at time zone 'UTC')+interval '30 days'>=clock_timestamp()))
      then raise exception 'description programs changed' using errcode='PT409'; end if;
    if p_snap_details is not null and (not(p_intake->'needs' ? 'snap_new') or not(p_mandate->'recipientIds' ? 'snap-pa')) then raise exception 'description invalid SNAP start' using errcode='23514'; end if;
  end if;
  if p_snap_details is not null then
    if p_snap_template_id is not null then result:=public.parent_start_snap_application_source(p_intake,p_mandate,p_snap_details,p_snap_notice_version,p_idempotency_key,p_snap_template_id,p_family_profile_source);
    elsif p_family_profile_source is not null then result:=public.parent_start_application_with_family_profile('snap_application',p_intake,p_mandate,p_snap_details,p_snap_notice_version,p_idempotency_key,p_family_profile_source);
    else result:=public.parent_start_snap_application(p_intake,p_mandate,p_snap_details,p_snap_notice_version,p_idempotency_key); end if;
  elsif p_zip_source is not null then result:=public.parent_start_request_with_reused_zip(p_intake,p_mandate,p_idempotency_key,(p_zip_source->>'sourceRequestId')::uuid,(p_zip_source->>'sourceVersion')::integer);
  else result:=public.parent_start_request(p_intake,p_mandate,p_idempotency_key); end if;
  if not known then
    update public.parent_events set evidence=evidence||jsonb_build_object('descriptionSource',p_description_source,'descriptionNeeds',p_intake->'needs') where request_id=result and kind='request.started' and actor='parent';
    if not found then raise exception 'description start audit unavailable' using errcode='PT409'; end if;
    update public.parent_requests set description_source=p_description_source where id=result;
  end if;
  return result;
end $$;
revoke execute on function parent_private.immutable_food_description_source(),public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text) to authenticated;
