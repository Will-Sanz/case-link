-- Explicit document scope does not authorize capture; protected consent and purpose checks remain separate.
create function parent_private.utility_preparation_scope_allowed(p_mandate jsonb,p_program_id text) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if p_program_id is null or p_program_id not in ('peco-cap','pgw-crp','pwd-tap')
    or jsonb_typeof(p_mandate) is distinct from 'object'
    or jsonb_typeof(p_mandate->'allowedActions') is distinct from 'array'
    or jsonb_typeof(p_mandate->'allowedData') is distinct from 'array' then return false; end if;
  return coalesce(p_mandate->>'mode'='prepare_only'
    and p_mandate->'recipientIds'=to_jsonb(array[p_program_id])
    and p_mandate->'allowedActions' ? 'prepare'
    and not exists(select 1 from jsonb_array_elements_text(p_mandate->'allowedActions') a where a not in ('research','prepare'))
    and (select count(*)=count(distinct a) from jsonb_array_elements_text(p_mandate->'allowedActions') a)
    and p_mandate->'allowedData' ?& array['household','income','utility']
    and not exists(select 1 from jsonb_array_elements_text(p_mandate->'allowedData') d where d not in ('household','income','utility','documents'))
    and (select count(*)=count(distinct d) from jsonb_array_elements_text(p_mandate->'allowedData') d),false);
end $$;
revoke all on function parent_private.utility_preparation_scope_allowed(jsonb,text) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create or replace function public.parent_save_peco_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_subject_authority_declared boolean,p_account_authority_declared boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_latest public.parent_peco_application_details; v_retry public.parent_peco_application_details;
  v_id uuid; v_provenance jsonb:='{}'; v_old_leaves jsonb:='{}'; v_leaves jsonb:='{}'; v_leaf record; v_metadata jsonb; v_new_version integer;
  v_today text:=to_char(now() at time zone 'America/New_York','YYYY-MM-DD');
begin
  if p_subject_authority_declared is distinct from true or p_account_authority_declared is distinct from true or not parent_private.owns_request(p_request_id) or not parent_private.peco_details_collection_enabled() then raise exception 'PECO collection unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if not coalesce(v_request.status in ('active','paused') and v_request.mandate_revoked_at is null and (v_request.mandate->>'expiresAt')::timestamptz>now(),false)
    or v_request.intake->'needs' is distinct from '["electricity"]'::jsonb or v_request.intake->'utilityProviders' is distinct from '["peco"]'::jsonb
    or not coalesce(v_request.intake->>'accountAuthority' in ('self','authorized_caregiver'),false)
    or not coalesce(parent_private.utility_preparation_scope_allowed(v_request.mandate,'peco-cap'),false)
    or p_notice_version is distinct from 'peco-application-details-2026-11-13.v1' then raise exception 'PECO collection unavailable' using errcode='42501'; end if;
  if p_idempotency_key is null or p_expected_version is null then raise exception 'invalid PECO save' using errcode='23514'; end if;
  select * into v_latest from public.parent_peco_application_details where request_id=p_request_id order by revision desc limit 1;
  select * into v_retry from public.parent_peco_application_details where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_retry.id is distinct from v_latest.id or v_retry.request_version<>v_request.version or v_retry.base_version<>p_expected_version or v_retry.details is distinct from p_details or v_retry.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    return v_retry.id;
  end if;
  if v_request.version<>p_expected_version then raise exception 'application changed; reload' using errcode='40001'; end if;
  if coalesce(v_latest.revision,0)>=500 or (select count(*) from public.parent_peco_application_details where request_id=p_request_id and created_at>now()-interval '1 minute')>=20 then raise exception 'PECO save limit reached' using errcode='23514'; end if;
  perform parent_private.validate_peco_details(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_leaves from parent_private.peco_detail_leaves(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_old_leaves from parent_private.peco_detail_leaves(coalesce(v_latest.details,'{}'));
  for v_leaf in select key path,value from jsonb_each(v_leaves) loop
    if v_old_leaves->v_leaf.path is distinct from v_leaf.value and v_leaf.path ~ '(^|\.)dateOfBirth$' and v_leaf.value#>>'{}'>v_today then raise exception 'invalid PECO dates' using errcode='23514'; end if;
    if v_old_leaves->v_leaf.path=v_leaf.value and v_latest.provenance ? v_leaf.path then v_metadata:=v_latest.provenance->v_leaf.path;
    else v_metadata:=jsonb_build_object('source','parent','confirmedAt',now(),'asOf',v_today); end if;
    v_provenance:=v_provenance||jsonb_build_object(v_leaf.path,v_metadata);
  end loop;
  if v_leaves<>v_old_leaves then perform parent_private.requeue_parent_change(p_request_id,'You updated private PECO preparation details. CaseLink will revalidate permitted work.'); end if;
  select version into v_new_version from public.parent_requests where id=p_request_id;
  insert into public.parent_peco_application_details(request_id,revision,base_version,request_version,details,provenance,source,consent_evidence,notice_version,idempotency_key)
    values(p_request_id,coalesce(v_latest.revision,0)+1,p_expected_version,v_new_version,p_details,v_provenance,
      '{"contractId":"peco-cap-2026-private-preparation-2026-11-13","contractVersion":"2026-11-13.v1","sourceUrl":"https://www.peco.com/cdn/assets/v3/assets/blt1b5616c79bacadb4/blt9d4fc50508d00567/69f41a34626de91f304d9b8f/PECO_CAP_Application_2026_v2.pdf?branch=prod_alias","sourceSha256":"87d4a25f808eac9e79eaf49197bb38c1e375d22b18ce0533995eca81698099cc","sourceByteLength":269140,"sourceCheckedAt":"2026-11-13T20:06:00.000Z","verifiedUntil":"2026-11-20T20:06:00.000Z"}',
      jsonb_build_object('subjectAuthorityDeclared',true,'subjectStatement','I have permission to provide this information and prepare PECO CAP help for myself and every person named, including children and any other adult.',
        'accountAuthorityDeclared',true,'accountStatement','I am the PECO account holder or have the account holder''s permission to prepare help for the exact PECO account provided in this request. This does not authorize payments, a financial agreement, a signature or submission.',
        'accountAuthority',v_request.intake->>'accountAuthority','actorId',auth.uid(),'noticeVersion',p_notice_version,'declaredAt',now(),'revision',coalesce(v_latest.revision,0)+1,
        'detailsSha256',encode(sha256(convert_to(p_details::text,'UTF8')),'hex'),'accountNumberSha256',encode(sha256(convert_to(p_details->>'accountNumber','UTF8')),'hex'),
        'subjects',to_jsonb(array_remove(array[case when p_details ? 'applicant' then 'applicant.'||(p_details#>>'{applicant,id}') end],null)||array(select 'householdMembers.'||(x->>'id') from jsonb_array_elements(coalesce(p_details->'householdMembers','[]')) x))),
      p_notice_version,p_idempotency_key) returning id into v_id;
  return v_id;
end $$;
