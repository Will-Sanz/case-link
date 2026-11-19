-- Routing and the applicant's private home remain independently sourced, even when their ZIP values match.
create function parent_private.snap_routing_start_hash(p_request uuid) returns text
language sql stable set search_path='' as $$
  select e.evidence->>'snapRoutingStartHash' from public.parent_events e
    where e.request_id=p_request and e.kind='request.started' and e.actor='parent'
      and e.evidence ? 'snapRoutingStartHash' order by e.created_at,e.id limit 1;
$$;
create function parent_private.independent_snap_routing(p_request uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.parent_requests r where r.id=p_request
    and (r.intake_reuse ? 'zip' or parent_private.snap_routing_start_hash(r.id) is not null));
$$;
revoke all on function parent_private.snap_routing_start_hash(uuid),parent_private.independent_snap_routing(uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_snap_sender,parent_utility_protected;

-- One transaction composes the existing source, private snapshot and profile writes; the audit stores only a hash.
create function public.parent_start_snap_application_with_routing(p_intake jsonb,p_mandate jsonb,p_details jsonb,p_notice_version text,p_idempotency_key uuid,
  p_source_request_id uuid,p_source_version integer,p_family_profile_source jsonb default null,p_template_id text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare household uuid; existing public.parent_requests; result uuid;
  previous text:=current_setting('caselink.snap_document_template',true); start_hash text;
begin
  household:=public.parent_ensure_account();
  if p_idempotency_key is null or p_source_request_id is null or p_source_version is null or p_source_version<1
    or (p_template_id is not null and parent_private.snap_application_source(p_template_id) is null)
    then raise exception 'invalid routed SNAP start' using errcode='23514'; end if;
  perform 1 from public.parent_households where id=household for no key update;
  start_hash:=encode(sha256(convert_to(jsonb_build_array(p_intake,p_mandate,p_details,p_notice_version,p_source_request_id,p_source_version,p_family_profile_source,p_template_id)::text,'UTF8')),'hex');
  select * into existing from public.parent_requests where household_id=household and start_key=p_idempotency_key for update;
  if found then
    if parent_private.snap_routing_start_hash(existing.id) is distinct from start_hash then raise exception 'routed SNAP start changed' using errcode='PT409'; end if;
    return existing.id;
  end if;
  perform set_config('caselink.snap_document_template',coalesce(p_template_id,''),true);
  if p_family_profile_source is not null then
    result:=public.parent_start_application_with_family_profile('snap_application',p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key,p_family_profile_source,false,false,p_source_request_id,p_source_version);
  else
    result:=public.parent_start_request_with_reused_zip(p_intake,p_mandate,p_idempotency_key,p_source_request_id,p_source_version);
    perform public.parent_save_snap_application_details(result,1,p_details,p_notice_version,p_idempotency_key);
  end if;
  perform set_config('caselink.snap_document_template',coalesce(previous,''),true);
  update public.parent_events set evidence=evidence||jsonb_build_object('snapRoutingStartHash',start_hash)
    where request_id=result and kind='request.started' and actor='parent';
  if not found then raise exception 'routed SNAP start audit unavailable' using errcode='PT409'; end if;
  return result;
exception when others then perform set_config('caselink.snap_document_template',coalesce(previous,''),true); raise;
end $$;
revoke all on function public.parent_start_snap_application_with_routing(jsonb,jsonb,jsonb,text,uuid,uuid,integer,jsonb,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_snap_sender,parent_utility_protected;
grant execute on function public.parent_start_snap_application_with_routing(jsonb,jsonb,jsonb,text,uuid,uuid,integer,jsonb,text) to authenticated;

-- Preserve the installed source/auth/version guards, owners and grants; fail if a predecessor anchor changed.
do $migration$
declare target record; definition text;
begin
  for target in select * from (values
    ('public.parent_start_request(jsonb,jsonb,uuid)', $old$    if found then$old$, $new$    if found then
      if parent_private.snap_routing_start_hash(v_existing.id) is not null then raise exception 'routed SNAP start changed' using errcode='PT409'; end if;$new$),
    ('public.parent_start_request_with_reused_zip(jsonb,jsonb,uuid,uuid,integer)', $old$  if found then$old$, $new$  if found then
    if parent_private.snap_routing_start_hash(existing.id) is not null then raise exception 'routed SNAP start changed' using errcode='PT409'; end if;$new$),
    ('public.parent_start_snap_application(jsonb,jsonb,jsonb,text,uuid)', $old$  if found then$old$, $new$  if found then
    if parent_private.snap_routing_start_hash(v_request.id) is not null then raise exception 'routed SNAP start changed' using errcode='PT409'; end if;$new$),
    ('public.parent_start_application_with_family_profile(text,jsonb,jsonb,jsonb,text,uuid,jsonb,boolean,boolean,uuid,integer)', $old$  source_hash:=$old$, $new$  if exists(select 1 from public.parent_requests r where r.household_id=household and r.start_key=p_idempotency_key and parent_private.snap_routing_start_hash(r.id) is not null) then raise exception 'routed SNAP start changed' using errcode='PT409'; end if;
  source_hash:=$new$),
    ('public.parent_start_application_with_family_profile(text,jsonb,jsonb,jsonb,text,uuid,jsonb,boolean,boolean,uuid,integer)', $old$  if exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->'profilePaths' ? 'homeAddress.zip')$old$, $new$  if (p_kind<>'snap_application' or p_source_request_id is null) and exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->'profilePaths' ? 'homeAddress.zip')$new$),
    ('parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[])', $old$elsif not(v_leaf.path=any(v_request.intake_need_scoped_fields)) and v_request.intake->v_leaf.path=v_leaf.value$old$, $new$elsif not(v_leaf.path='zip' and parent_private.independent_snap_routing(p_request_id)) and not(v_leaf.path=any(v_request.intake_need_scoped_fields)) and v_request.intake->v_leaf.path=v_leaf.value$new$),
    ('public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[])', $old$if p_kind='snap_application' and (('zip'=any(p_confirmed_paths))$old$, $new$if p_kind='snap_application' and not parent_private.independent_snap_routing(p_request_id) and (('zip'=any(p_confirmed_paths))$new$),
    ('public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[])', $old$refresh_routing:=exists($old$, $new$refresh_routing:=(p_kind<>'snap_application' or not parent_private.independent_snap_routing(p_request_id)) and exists($new$),
    ('public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[])', $old$if p_kind='snap_application' and p_details ? 'zip' and p_details->'zip' is distinct from request.intake->'zip' then$old$, $new$if p_kind='snap_application' and not parent_private.independent_snap_routing(p_request_id) and p_details ? 'zip' and p_details->'zip' is distinct from request.intake->'zip' then$new$),
    ('public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[])', $old$if refresh_routing or (p_kind='snap_application' and exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->>'applicationPath'='zip' and x->'profilePaths' ? 'homeAddress.zip')) then$old$, $new$if (p_kind<>'snap_application' or not parent_private.independent_snap_routing(p_request_id)) and (refresh_routing or (p_kind='snap_application' and exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->>'applicationPath'='zip' and x->'profilePaths' ? 'homeAddress.zip'))) then$new$),
    ('public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)', $old$    or (p_snap_details is not null and p_zip_source is not null)
    or (p_zip_source is not null and$old$, $new$    or (p_zip_source is not null and$new$),
    ('public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)', $old$  if p_snap_details is not null then
    if p_snap_template_id is not null then result:=$old$, $new$  if p_snap_details is not null then
    if p_zip_source is not null then result:=public.parent_start_snap_application_with_routing(p_intake,p_mandate,p_snap_details,p_snap_notice_version,p_idempotency_key,(p_zip_source->>'sourceRequestId')::uuid,(p_zip_source->>'sourceVersion')::integer,p_family_profile_source,p_snap_template_id);
    elsif p_snap_template_id is not null then result:=$new$)
  ) edits(signature,old_value,new_value) loop
    definition:=pg_get_functiondef(target.signature::regprocedure);
    if (length(definition)-length(replace(definition,target.old_value,'')))/length(target.old_value)<>1 then
      raise exception 'SNAP routing compatibility target changed: %',target.signature;
    end if;
    execute replace(definition,target.old_value,target.new_value);
  end loop;
end $migration$;
