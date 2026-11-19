-- Explicit application-only confirmations do not recreate a cleared shared profile.
alter table public.parent_wic_application_details add column confirmed_paths text[] not null default '{}';

create function parent_private.wic_reaffirmable_paths(p_request uuid,p_version integer) returns text[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(distinct s.application_path order by s.application_path),'{}'::text[])
    from parent_private.family_profile_request_sources s join public.parent_requests r on r.id=s.request_id
    join public.parent_households h on h.id=r.household_id left join parent_private.family_profiles p on p.owner_id=h.owner_id
    where r.id=p_request and r.version=p_version and s.request_version=p_version and r.intake->'needs'='["wic_new"]'::jsonb
      and s.application_path<>'intake.zip' and (p.details is null or s.expires_at<=clock_timestamp() or s.confirmed_at>clock_timestamp()
        or parent_private.family_profile_source_hash(p.details,s.profile_path) is distinct from s.source_hash);
$$;

create function parent_private.save_wic_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_subject_authority_declared boolean,p_confirmed_paths text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_latest public.parent_wic_application_details; v_retry public.parent_wic_application_details;
  v_id uuid; v_provenance jsonb:='{}'; v_old_leaves jsonb:='{}'; v_leaves jsonb:='{}'; v_leaf record; v_metadata jsonb; v_changed boolean; v_new_version integer;
  v_today text:=to_char(now() at time zone 'America/New_York','YYYY-MM-DD');
begin
  if p_subject_authority_declared is distinct from true or not parent_private.owns_request(p_request_id) or not parent_private.wic_details_collection_enabled() then raise exception 'WIC collection unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if not coalesce(v_request.status in ('active','paused') and v_request.mandate_revoked_at is null and (v_request.mandate->>'expiresAt')::timestamptz>now(),false) or not(v_request.intake->'needs' ? 'wic_new')
    or not(v_request.mandate->'recipientIds' ? 'wic-pa') or not(v_request.mandate->'allowedActions' ? 'prepare')
    or not(v_request.mandate->'allowedData' ? 'household') or p_notice_version is distinct from 'wic-application-details-2026-11-13.v1' then
    raise exception 'WIC collection unavailable' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_expected_version is null or p_confirmed_paths is null or cardinality(p_confirmed_paths)>1000
    or exists(select 1 from unnest(p_confirmed_paths) path where path is null or length(path) not between 1 and 200)
    or cardinality(p_confirmed_paths)<>(select count(distinct path) from unnest(p_confirmed_paths) path) then raise exception 'invalid WIC save' using errcode='23514'; end if;
  select * into v_latest from public.parent_wic_application_details where request_id=p_request_id order by revision desc limit 1;
  select * into v_retry from public.parent_wic_application_details where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_retry.id is distinct from v_latest.id or v_retry.request_version<>v_request.version or v_retry.base_version<>p_expected_version
      or v_retry.confirmed_paths is distinct from p_confirmed_paths or v_retry.details is distinct from p_details or v_retry.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    return v_retry.id;
  end if;
  if v_request.version<>p_expected_version then raise exception 'application changed; reload' using errcode='40001'; end if;
  if coalesce(v_latest.revision,0)>=500 or (select count(*) from public.parent_wic_application_details where request_id=p_request_id and created_at>now()-interval '1 minute')>=20 then
    raise exception 'WIC save limit reached' using errcode='23514';
  end if;
  perform parent_private.validate_wic_details(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_leaves from parent_private.wic_detail_leaves(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_old_leaves from parent_private.wic_detail_leaves(coalesce(v_latest.details,'{}'));
  if exists(select 1 from unnest(p_confirmed_paths) path where not(v_leaves ? path) or jsonb_typeof(v_leaves->path)<>'string'
    or v_leaves->path is distinct from v_old_leaves->path) then raise exception 'invalid current WIC answer' using errcode='23514'; end if;
  v_changed:=v_leaves<>v_old_leaves or cardinality(p_confirmed_paths)>0;
  for v_leaf in select key path,value from jsonb_each(v_leaves) loop
    if (v_old_leaves->v_leaf.path is distinct from v_leaf.value or v_leaf.path=any(p_confirmed_paths)) and v_leaf.path ~ '(^|\.)dateOfBirth$' and v_leaf.value#>>'{}'>v_today then
      raise exception 'invalid WIC dates' using errcode='23514';
    end if;
    if v_old_leaves->v_leaf.path=v_leaf.value and v_latest.provenance ? v_leaf.path and not(v_leaf.path=any(p_confirmed_paths)) then v_metadata:=v_latest.provenance->v_leaf.path;
    else v_metadata:=jsonb_build_object('source','parent','confirmedAt',now(),'asOf',v_today);
    end if;
    v_provenance:=v_provenance||jsonb_build_object(v_leaf.path,v_metadata);
  end loop;
  if v_changed then perform parent_private.requeue_parent_change(p_request_id,'You updated private WIC application details. CaseLink will revalidate permitted work.'); end if;
  select version into v_new_version from public.parent_requests where id=p_request_id;
  insert into public.parent_wic_application_details(request_id,revision,base_version,request_version,details,provenance,source,consent_evidence,notice_version,idempotency_key,confirmed_paths)
    values(p_request_id,coalesce(v_latest.revision,0)+1,p_expected_version,v_new_version,p_details,v_provenance,
      '{"contractId":"pa-wic-preapplication-2026-11-13","contractVersion":"2026-11-13.v1","sourceUrl":"https://pawic.com/OnlineApplication.aspx","sourceSha256":"c6daa011c75c4b21838cea17a579d1097c09b00f0584e668eede2a343dd0b774","sourceCheckedAt":"2026-11-13T18:57:45.283Z","verifiedUntil":"2026-11-20T18:57:45.283Z"}',jsonb_build_object('subjectAuthorityDeclared',true,'statement','I have permission to provide this information and request this WIC help for myself and every person named, including children and any other adult.',
        'actorId',auth.uid(),'noticeVersion',p_notice_version,'declaredAt',now(),'revision',coalesce(v_latest.revision,0)+1,
        'detailsSha256',encode(sha256(convert_to(p_details::text,'UTF8')),'hex'),
        'subjects',to_jsonb(array_remove(array[case when p_details ? 'contact' then 'contact' end,case when p_details ? 'mother' then 'mother' end],null)||
          array(select 'children.'||(c->>'id') from jsonb_array_elements(coalesce(p_details->'children','[]')) c))),p_notice_version,p_idempotency_key,p_confirmed_paths) returning id into v_id;
  return v_id;
end $$;

create or replace function public.parent_save_wic_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_subject_authority_declared boolean) returns uuid
language sql security definer set search_path='' as $$
  select parent_private.save_wic_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,'{}'::text[]);
$$;

create or replace function public.parent_save_application_with_family_profile(p_kind text,p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_family_profile_source jsonb default null,
  p_subject_authority_declared boolean default false,p_account_authority_declared boolean default false,p_confirmed_paths text[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare request public.parent_requests; table_name text; previous jsonb; original_sources jsonb; item record; result uuid; final_version integer;
  source_hash text; write_hash text; receipt parent_private.family_profile_application_receipts; old_setting text; dates jsonb; refresh_routing boolean:=false;
begin
  if p_kind is null or not(p_kind=any(array['snap_application','wic_application','peco_application','pgw_application','water_application']))
    or p_idempotency_key is null or p_expected_version is null or p_confirmed_paths is null or (p_kind not in ('snap_application','wic_application') and cardinality(p_confirmed_paths)>0) then
    raise exception 'invalid profile application save' using errcode='23514'; end if;
  if not parent_private.owns_request(p_request_id) then raise exception 'profile application unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id where r.id=p_request_id for no key update of h;
  select * into request from public.parent_requests where id=p_request_id for update;
  table_name:=case p_kind when 'snap_application' then 'parent_snap_application_details' when 'wic_application' then 'parent_wic_application_details'
    when 'peco_application' then 'parent_peco_application_details' when 'pgw_application' then 'parent_pgw_application_details' when 'water_application' then 'parent_water_application_details' end;
  source_hash:=encode(sha256(convert_to(coalesce(p_family_profile_source,'null')::text,'UTF8')),'hex');
  write_hash:=encode(sha256(convert_to(jsonb_build_array(p_kind,p_request_id,p_expected_version,p_details,p_notice_version,p_family_profile_source,p_subject_authority_declared,p_account_authority_declared,p_confirmed_paths)::text,'UTF8')),'hex');
  select * into receipt from parent_private.family_profile_application_receipts where owner_id=auth.uid() and idempotency_key=p_idempotency_key and mutation='save';
  if found and (receipt.request_id is distinct from p_request_id or receipt.source_hash is distinct from source_hash or receipt.write_hash is distinct from write_hash) then raise exception 'profile application save changed' using errcode='40001'; end if;
  execute format('select to_jsonb(s) from public.%I s where request_id=$1 order by revision desc limit 1',table_name) into previous using p_request_id;
  if receipt.request_id is not null then
    if previous->>'id' is distinct from receipt.result_id::text then raise exception 'profile application save changed' using errcode='40001'; end if;
    return receipt.result_id;
  end if;
  if p_family_profile_source is not null then
    dates:=parent_private.verify_family_profile_application(p_kind,request.intake,p_details,p_family_profile_source);
  end if;
  if receipt.request_id is null and previous->>'idempotency_key'=p_idempotency_key::text and p_family_profile_source is not null then raise exception 'profile application save changed' using errcode='40001'; end if;
  if receipt.request_id is null then
    if request.version<>p_expected_version or request.status not in ('active','paused') then raise exception 'profile application save changed' using errcode='40001'; end if;
    select coalesce(jsonb_agg(to_jsonb(s)),'[]') into original_sources from parent_private.family_profile_request_sources s where request_id=p_request_id and request_version=p_expected_version;
    if p_kind='wic_application' and cardinality(p_confirmed_paths)>0 then
      if cardinality(p_confirmed_paths)>1000 or exists(select 1 from unnest(p_confirmed_paths) path where path is null)
        or cardinality(p_confirmed_paths)<>(select count(distinct path) from unnest(p_confirmed_paths) path)
        or not(p_confirmed_paths <@ parent_private.wic_reaffirmable_paths(p_request_id,p_expected_version))
        or exists(select 1 from jsonb_array_elements(coalesce(p_family_profile_source->'fields','[]')) f
          where f->>'applicationPath'=any(p_confirmed_paths)) then
        raise exception 'invalid current WIC answer' using errcode='23514';
      end if;
    end if;
    -- Only a genuinely changed parent answer or the existing typed reaffirmation can replace its old source.
    for item in select distinct application_path from parent_private.family_profile_request_sources where request_id=p_request_id and request_version=p_expected_version and application_path<>'intake.zip' loop
      if parent_private.family_profile_application_fact(p_details,item.application_path) is distinct from parent_private.family_profile_application_fact(previous->'details',item.application_path)
        or exists(select 1 from unnest(p_confirmed_paths) path where path=item.application_path or path like item.application_path||'.%') then
        delete from parent_private.family_profile_request_sources where request_id=p_request_id and request_version=p_expected_version and application_path=item.application_path;
      end if;
    end loop;
    if p_kind='snap_application' and (('zip'=any(p_confirmed_paths)) or (p_details ? 'zip' and p_details->'zip' is distinct from request.intake->'zip')) then
      delete from parent_private.family_profile_request_sources where request_id=p_request_id and request_version=p_expected_version and application_path='intake.zip';
    end if;
    if p_family_profile_source is not null then
      delete from parent_private.family_profile_request_sources s where s.request_id=p_request_id and s.request_version=p_expected_version
        and exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->>'applicationPath'=s.application_path);
      perform parent_private.bind_family_profile(p_request_id,p_expected_version,(p_family_profile_source->>'revision')::integer,p_family_profile_source->'fields');
      refresh_routing:=exists(select 1 from parent_private.family_profile_request_sources where request_id=p_request_id and request_version=p_expected_version and application_path='intake.zip')
        and exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->'profilePaths' ? 'homeAddress.zip');
      if refresh_routing then
        delete from parent_private.family_profile_request_sources where request_id=p_request_id and request_version=p_expected_version and application_path='intake.zip';
        perform parent_private.bind_family_profile(p_request_id,p_expected_version,(p_family_profile_source->>'revision')::integer,
          '[{"applicationPath":"intake.zip","profilePaths":["homeAddress.zip"]}]');
        update public.parent_requests set intake=jsonb_set(intake,'{zip}',(select details#>'{homeAddress,zip}' from parent_private.family_profiles where owner_id=auth.uid())) where id=p_request_id;
      end if;
    end if;
  end if;
  old_setting:=current_setting('caselink.family_profile_application_source',true);
  perform set_config('caselink.family_profile_application_source',coalesce(p_family_profile_source::text,''),true);
  case p_kind
    when 'snap_application' then result:=public.parent_reaffirm_snap_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_confirmed_paths);
    when 'wic_application' then result:=parent_private.save_wic_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_confirmed_paths);
    when 'peco_application' then result:=public.parent_save_peco_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared);
    when 'pgw_application' then result:=public.parent_save_pgw_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared);
    when 'water_application' then result:=public.parent_save_water_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared);
  end case;
  perform set_config('caselink.family_profile_application_source',coalesce(old_setting,''),true);
  select version into final_version from public.parent_requests where id=p_request_id;
  if p_kind='snap_application' and p_details ? 'zip' and p_details->'zip' is distinct from request.intake->'zip' then
    update public.parent_requests set intake=jsonb_set(intake,'{zip}',p_details->'zip') where id=p_request_id;
  end if;
  if final_version<>p_expected_version then
    -- Keep the previous attempted/submitted version's source history exactly as recorded.
    delete from parent_private.family_profile_request_sources where request_id=p_request_id and request_version=p_expected_version;
    insert into parent_private.family_profile_request_sources select * from jsonb_populate_recordset(null::parent_private.family_profile_request_sources,original_sources);
  end if;
  if p_family_profile_source is not null then
    delete from parent_private.family_profile_request_sources s where s.request_id=p_request_id and s.request_version=final_version
      and exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->>'applicationPath'=s.application_path);
    perform parent_private.bind_family_profile(p_request_id,final_version,(p_family_profile_source->>'revision')::integer,p_family_profile_source->'fields');
    if refresh_routing or (p_kind='snap_application' and exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->>'applicationPath'='zip' and x->'profilePaths' ? 'homeAddress.zip')) then
      delete from parent_private.family_profile_request_sources where request_id=p_request_id and request_version=final_version and application_path='intake.zip';
      perform parent_private.bind_family_profile(p_request_id,final_version,(p_family_profile_source->>'revision')::integer,
        '[{"applicationPath":"intake.zip","profilePaths":["homeAddress.zip"]}]');
      update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',(select provenance#>'{homeAddress.zip,confirmedAt}' from parent_private.family_profiles where owner_id=auth.uid())) where id=p_request_id;
    end if;
  end if;
  insert into parent_private.family_profile_application_receipts(owner_id,idempotency_key,request_id,result_id,source_hash,write_hash,mutation) values(auth.uid(),p_idempotency_key,p_request_id,result,source_hash,write_hash,'save');
  return result;
exception when others then perform set_config('caselink.family_profile_application_source',coalesce(old_setting,''),true); raise;
end $$;

revoke all on function parent_private.wic_reaffirmable_paths(uuid,integer),parent_private.save_wic_application_details(uuid,integer,jsonb,text,uuid,boolean,text[])
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
