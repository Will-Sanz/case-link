-- This new preparation purpose stays closed independently of SNAP and WIC.
alter table parent_private.processing_controls
  add column pgw_details_enabled boolean not null default false,
  add column pgw_details_approval_reference text,
  add column pgw_details_approved_until timestamptz,
  add column pgw_details_notice_version text;

create function parent_private.pgw_details_collection_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and coalesce((select
    pgw_details_enabled and length(btrim(coalesce(pgw_details_approval_reference,'')))>0
    and pgw_details_approved_until>now() and pgw_details_notice_version='pgw-application-details-2026-11-13.v1'
    from parent_private.processing_controls where singleton),false)
    and now()>='2026-11-13T21:39:43Z'::timestamptz and now()<'2026-11-20T21:39:43Z'::timestamptz;
$$;

create table public.parent_pgw_application_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  revision integer not null check(revision>0), base_version integer not null check(base_version>0), request_version integer not null check(request_version>=base_version),
  details jsonb not null check(jsonb_typeof(details)='object'), provenance jsonb not null check(jsonb_typeof(provenance)='object'),
  source jsonb not null check(jsonb_typeof(source)='object'),
  consent_evidence jsonb not null check(jsonb_typeof(consent_evidence)='object'
    and consent_evidence ?& array['subjectAuthorityDeclared','subjectStatement','accountAuthorityDeclared','accountStatement','accountAuthority','actorId','noticeVersion','declaredAt','revision','detailsSha256','accountNumberSha256','subjects']
    and consent_evidence->'subjectAuthorityDeclared'='true'::jsonb and consent_evidence->'accountAuthorityDeclared'='true'::jsonb
    and consent_evidence->>'accountAuthority' in ('self','authorized_caregiver')
    and consent_evidence->>'noticeVersion'=notice_version and (consent_evidence->>'revision')::integer=revision
    and consent_evidence->>'detailsSha256'=encode(sha256(convert_to(details::text,'UTF8')),'hex')
    and (consent_evidence->>'accountNumberSha256') is not distinct from encode(sha256(convert_to(details->>'accountNumber','UTF8')),'hex')),
  notice_version text not null check(notice_version='pgw-application-details-2026-11-13.v1'),
  idempotency_key uuid not null, created_at timestamptz not null default now(),
  unique(request_id,revision), unique(request_id,idempotency_key)
);
alter table public.parent_pgw_application_details enable row level security;
revoke all on public.parent_pgw_application_details from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant select on public.parent_pgw_application_details to authenticated;
create policy parent_pgw_details_read on public.parent_pgw_application_details for select to authenticated using(parent_private.owns_request(request_id));

create function parent_private.immutable_pgw_details() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'application snapshots are immutable' using errcode='23514'; end $$;
create trigger parent_pgw_details_immutable before update on public.parent_pgw_application_details for each row execute function parent_private.immutable_pgw_details();

create function parent_private.validate_pgw_details(p_details jsonb) returns void
language plpgsql set search_path='' as $$
declare v record; v_keys text[]; v_string text; v_max integer; v_ok boolean; v_ids text[];
begin
  if p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>65536 then raise exception 'invalid PGW details' using errcode='23514'; end if;
  for v in
    with recursive nodes(path,value) as (
      select ''::text,p_details union all
      select case when n.path='' then c.key else n.path||'.'||c.key end,c.value from nodes n cross join lateral (
        select key,value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end)
        union all select '*',value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end)
      ) c
    ) select * from nodes
  loop
    v_keys:=case
      when v.path='' then array['journey','currentCrpState','householdComplete','accountNumber','customer','address','phone','householdMembers','outsideSupport','zeroIncomePast30Days','livingExpenses','snap','housingSubsidy']
      when v.path='customer' then array['id','firstName','lastName','income','under18']
      when v.path='householdMembers.*' then array['id','firstName','lastName','income','dateOfBirth','relationship']
      when v.path in ('customer.income','householdMembers.*.income') then array['state','sources','noIncomeSituation']
      when v.path in ('customer.income.sources.*','householdMembers.*.income.sources.*') then array['id','kind']
      when v.path in ('address','outsideSupport.supporter.address') then array['street','city','state','zip']
      when v.path='outsideSupport' then array['receives','supporter']
      when v.path='outsideSupport.supporter' then array['id','firstName','lastName','address','phone','monthlyAmountCents']
      when v.path='livingExpenses' then array['food','housing','utilities']
      when v.path in ('snap','housingSubsidy') then array['receives','monthlyAmountCents']
      else null end;
    if v_keys is not null then
      if jsonb_typeof(v.value)<>'object' or exists(select 1 from jsonb_object_keys(v.value) k where not(k=any(v_keys)))
        or (v.path in ('customer','householdMembers.*','outsideSupport.supporter') and not(v.value ? 'id'))
        or (v.path in ('customer.income.sources.*','householdMembers.*.income.sources.*') and not(v.value ?& array['id','kind'])) then raise exception 'invalid PGW details' using errcode='23514'; end if;
      if v.path in ('customer.income','householdMembers.*.income') then
        if not(v.value ?& array['state','sources']) or jsonb_typeof(v.value->'sources')<>'array'
          or ((v.value->>'state'='sources') is distinct from (jsonb_array_length(v.value->'sources')>0))
          or (v.value ? 'noIncomeSituation' and v.value->>'state' is distinct from 'none')
          or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(v.value->'sources') x) then raise exception 'invalid PGW details' using errcode='23514'; end if;
      end if;
      if v.path in ('snap','housingSubsidy') and v.value ? 'monthlyAmountCents' and v.value->'receives' is distinct from 'true'::jsonb then raise exception 'invalid PGW details' using errcode='23514'; end if;
      if v.path='outsideSupport' and v.value ? 'supporter' and v.value->'receives' is distinct from 'true'::jsonb then raise exception 'invalid PGW details' using errcode='23514'; end if;
      continue;
    end if;
    v_string:=v.value#>>'{}'; v_max:=null;
    if v.path in ('customer.firstName','customer.lastName','householdMembers.*.firstName','householdMembers.*.lastName','householdMembers.*.relationship','outsideSupport.supporter.firstName','outsideSupport.supporter.lastName','address.city','outsideSupport.supporter.address.city') then v_max:=80;
    elsif v.path in ('address.street','outsideSupport.supporter.address.street') then v_max:=160;
    elsif v.path in ('address.state','outsideSupport.supporter.address.state') then v_max:=40;
    elsif v.path in ('customer.income.noIncomeSituation','householdMembers.*.income.noIncomeSituation','livingExpenses.food','livingExpenses.housing','livingExpenses.utilities') then v_max:=400;
    elsif v.path='accountNumber' then v_max:=80; end if;
    if v_max is not null then
      v_ok:=jsonb_typeof(v.value)='string' and (length(v_string)+(select count(*) from regexp_split_to_table(v_string,'') c where ascii(c)>65535)) between 1 and v_max
        and v_string=btrim(v_string,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') and v_string!~'[[:cntrl:]<>]';
    else
      v_ok:=case
        when v.path='journey' then v.value in ('"new_enrollment"','"recertification"','"reenrollment"','"pending"','"unknown"')
        when v.path='currentCrpState' then v.value in ('"not_enrolled"','"enrolled"','"previously_enrolled"','"unknown"')
        when v.path in ('householdComplete','zeroIncomePast30Days','customer.under18','outsideSupport.receives','snap.receives','housingSubsidy.receives') then jsonb_typeof(v.value)='boolean'
        when v.path in ('address.zip','outsideSupport.supporter.address.zip') then jsonb_typeof(v.value)='string' and v_string~'^[0-9]{5}$'
        when v.path in ('phone','outsideSupport.supporter.phone') then jsonb_typeof(v.value)='string' and v_string~'^[0-9]{3}-[0-9]{3}-[0-9]{4}$'
        when v.path='householdMembers.*.dateOfBirth' then jsonb_typeof(v.value)='string' and v_string~'^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' and to_char(v_string::date,'YYYY-MM-DD')=v_string
        when v.path='householdMembers' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=99
        when v.path in ('customer.income.sources','householdMembers.*.income.sources') then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=30
        when v.path in ('customer.income.state','householdMembers.*.income.state') then v.value in ('"sources"','"none"','"unknown"')
        when v.path in ('customer.income.sources.*.kind','householdMembers.*.income.sources.*.kind') then v.value#>>'{}'=any(array['employment','social_security','pension','cash_benefits','unemployment','disability','self_employment','child_support','spousal_support','foster_care','rental','other'])
        when v.path in ('outsideSupport.supporter.monthlyAmountCents','snap.monthlyAmountCents','housingSubsidy.monthlyAmountCents') then jsonb_typeof(v.value)='number' and v_string::numeric between 0 and 1000000000000 and trunc(v_string::numeric)=v_string::numeric
        when v.path in ('customer.id','householdMembers.*.id','customer.income.sources.*.id','householdMembers.*.income.sources.*.id','outsideSupport.supporter.id') then jsonb_typeof(v.value)='string' and
          (v_string~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or v_string in ('00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff'))
        else false end;
    end if;
    if not coalesce(v_ok,false) then raise exception 'invalid PGW details' using errcode='23514'; end if;
    if v.path='accountNumber' then
      if v_string~*'(^|[^A-Za-z0-9_])(password|passcode|ssn|itin|passport|pin|signature)([^A-Za-z0-9_]|$)' then raise exception 'invalid PGW details' using errcode='23514'; end if;
    elsif jsonb_typeof(v.value)='string' and v.path not in ('customer.id','householdMembers.*.id','customer.income.sources.*.id','householdMembers.*.income.sources.*.id','outsideSupport.supporter.id') then
      v_string:=replace(translate(normalize(v_string,NFKC),U&'\200B\200C\200D\2060\FEFF',''),U&'\1680',' ');
      if v_string~'[0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4}|[0-9]{12,19}'
        or v_string~*'(^|[^A-Za-z0-9_])(password|passcode|pin|ssn|social[[:space:]]+security([[:space:]]+number)?|signature|passport([[:space:]]+number)?|driver.?s?[[:space:]]+licen[cs]e([[:space:]]+number)?|student[[:space:]]+id([[:space:]]+number)?|visa[[:space:]]+number|itin|identification([[:space:]]+number)?|id[[:space:]]+number)[[:space:]]*(is[[:space:]]+|[:=#][[:space:]]*)[^[:space:]]+' then raise exception 'invalid PGW details' using errcode='23514'; end if;
    end if;
  end loop;
  select array_agg(person_id) into v_ids from (
    select p_details#>>'{customer,id}' person_id where p_details ? 'customer'
    union all select x->>'id' from jsonb_array_elements(coalesce(p_details->'householdMembers','[]')) x
    union all select p_details#>>'{outsideSupport,supporter,id}' where p_details#>'{outsideSupport,supporter}' is not null
  ) people;
  if (p_details->'householdComplete'='true'::jsonb and not(p_details ?& array['customer','householdMembers']))
    or (p_details ? 'livingExpenses' and p_details->'zeroIncomePast30Days' is distinct from 'true'::jsonb)
    or (p_details->'zeroIncomePast30Days'='true'::jsonb and (p_details#>'{outsideSupport,receives}'='true'::jsonb or p_details#>>'{customer,income,state}'='sources' or exists(select 1 from jsonb_array_elements(coalesce(p_details->'householdMembers','[]')) x where x#>>'{income,state}'='sources')))
    or (select count(*)<>count(distinct person_id) from unnest(v_ids) person_id) then raise exception 'invalid PGW details' using errcode='23514'; end if;
exception when others then raise exception 'invalid PGW details' using errcode='23514';
end $$;

create function parent_private.pgw_detail_leaves(p_value jsonb,p_path text default '') returns table(path text,value jsonb)
language plpgsql set search_path='' as $$
declare v record; v_path text:=p_path;
begin
  if jsonb_typeof(p_value)='object' then
    if p_path in ('customer','outsideSupport.supporter') then v_path:=p_path||'.'||(p_value->>'id'); end if;
    if p_value-'id'='{}'::jsonb and v_path<>'' then return query select v_path,'{}'::jsonb; return; end if;
    for v in select * from jsonb_each(p_value) where key<>'id' loop
      return query select * from parent_private.pgw_detail_leaves(v.value,case when v_path='' then v.key else v_path||'.'||v.key end);
    end loop;
  elsif (p_path='householdMembers' or p_path like '%.sources') and jsonb_array_length(p_value)>0 then
    for v in select x from jsonb_array_elements(p_value) x loop return query select * from parent_private.pgw_detail_leaves(v.x,p_path||'.'||(v.x->>'id')); end loop;
  else return query select p_path,p_value;
  end if;
end $$;

create function public.parent_save_pgw_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_subject_authority_declared boolean,p_account_authority_declared boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_latest public.parent_pgw_application_details; v_retry public.parent_pgw_application_details;
  v_id uuid; v_provenance jsonb:='{}'; v_old_leaves jsonb:='{}'; v_leaves jsonb:='{}'; v_leaf record; v_metadata jsonb; v_new_version integer;
  v_today text:=to_char(now() at time zone 'America/New_York','YYYY-MM-DD');
begin
  if p_subject_authority_declared is distinct from true or p_account_authority_declared is distinct from true or not parent_private.owns_request(p_request_id) or not parent_private.pgw_details_collection_enabled() then raise exception 'PGW collection unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if not coalesce(v_request.status in ('active','paused') and v_request.mandate_revoked_at is null and (v_request.mandate->>'expiresAt')::timestamptz>now(),false)
    or v_request.intake->'needs' is distinct from '["gas"]'::jsonb or v_request.intake->'utilityProviders' is distinct from '["pgw"]'::jsonb
    or not coalesce(v_request.intake->>'accountAuthority' in ('self','authorized_caregiver'),false)
    or not coalesce(parent_private.utility_preparation_scope_allowed(v_request.mandate,'pgw-crp'),false)
    or p_notice_version is distinct from 'pgw-application-details-2026-11-13.v1' then raise exception 'PGW collection unavailable' using errcode='42501'; end if;
  if p_idempotency_key is null or p_expected_version is null then raise exception 'invalid PGW save' using errcode='23514'; end if;
  select * into v_latest from public.parent_pgw_application_details where request_id=p_request_id order by revision desc limit 1;
  select * into v_retry from public.parent_pgw_application_details where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_retry.id is distinct from v_latest.id or v_retry.request_version<>v_request.version or v_retry.base_version<>p_expected_version or v_retry.details is distinct from p_details or v_retry.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    return v_retry.id;
  end if;
  if v_request.version<>p_expected_version then raise exception 'application changed; reload' using errcode='40001'; end if;
  if coalesce(v_latest.revision,0)>=500 or (select count(*) from public.parent_pgw_application_details where request_id=p_request_id and created_at>now()-interval '1 minute')>=20 then raise exception 'PGW save limit reached' using errcode='23514'; end if;
  perform parent_private.validate_pgw_details(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_leaves from parent_private.pgw_detail_leaves(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_old_leaves from parent_private.pgw_detail_leaves(coalesce(v_latest.details,'{}'));
  for v_leaf in select key path,value from jsonb_each(v_leaves) loop
    if v_old_leaves->v_leaf.path is distinct from v_leaf.value and v_leaf.path ~ '(^|\.)dateOfBirth$' and v_leaf.value#>>'{}'>v_today then raise exception 'invalid PGW dates' using errcode='23514'; end if;
    if v_old_leaves->v_leaf.path=v_leaf.value and v_latest.provenance ? v_leaf.path then v_metadata:=v_latest.provenance->v_leaf.path;
    else v_metadata:=jsonb_build_object('source','parent','confirmedAt',now(),'asOf',v_today); end if;
    v_provenance:=v_provenance||jsonb_build_object(v_leaf.path,v_metadata);
  end loop;
  if v_leaves<>v_old_leaves then perform parent_private.requeue_parent_change(p_request_id,'You updated private PGW preparation details. CaseLink will revalidate permitted work.'); end if;
  select version into v_new_version from public.parent_requests where id=p_request_id;
  insert into public.parent_pgw_application_details(request_id,revision,base_version,request_version,details,provenance,source,consent_evidence,notice_version,idempotency_key)
    values(p_request_id,coalesce(v_latest.revision,0)+1,p_expected_version,v_new_version,p_details,v_provenance,
      $pgw_source${"id":"pgw-crp-public-form-2026-11-13","version":"2026-11-13.v1","programId":"pgw-crp","sourceUrl":"https://www.pgworks.com/uploads/media/CRPApplicationEng.pdf","officialGuidanceUrl":"https://www.pgworks.com/about-your-bill/financial-support-programs/crp","sourceCheckedAt":"2026-11-13T21:39:43.000Z","verifiedUntil":"2026-11-20T21:39:43.000Z","sourceSha256":"f67e89ab9a0102d5cc95c73c6d1c14b7fe14daa697aa850b269826e0240a149c","sourceByteLength":2332657,"pageCount":4,"blankPageNumbers":[2],"fillableFieldCount":0,"identifierTypes":["ssn","drivers_license","student_id","passport","visa","itin","other"],"customerOfRecordOmissions":["governmentIdentifier","dateOfBirth"],"personalActs":["customer_signature_and_responsibilities","outside_supporter_signature_when_applicable"],"semanticLimits":["The observed source has no printed version identifier; this is an observation contract, not an invented provider version.","All non-customer household members, adults and children, require an accepted identifier. Opaque requirements are not completed identification and no raw identifier belongs in this formatter or application JSON.","The customer of record's ID and birth date are not required. Do not collect either just to prepare this application.","New enrollment, recertification, re-enrollment and pending work remain distinct. No draft establishes the correct existing-account journey or an amount due.","Gross income evidence, no-income statements, outside financial support and SNAP/housing amounts have separate requirements. Source types do not validate proof or establish a zero-income claim.","The customer and applicable outside supporter complete their actual personal acts. The formatter supplies no signature, date, responsibility assent, payment or financial commitment.","Static unsigned preparation is separate from protected member-ID insertion, final evidence assembly, accepted submission, receipt, reconnection or assistance.","The weekly source ceiling and local field/page limits are engineering bounds, not provider eligibility rules or processing approval."]}$pgw_source$::jsonb,
      jsonb_build_object('subjectAuthorityDeclared',true,'subjectStatement','I have permission to provide this information and prepare PGW CRP help for the customer of record, each household member named, including children and other adults, and any outside supporter whose information I provide.',
        'accountAuthorityDeclared',true,'accountStatement','I am the PGW account holder or have the account holder''s permission to prepare help for the exact PGW account provided. This does not authorize a signature, financial agreement, payment, submission or declaration for an outside supporter.',
        'accountAuthority',v_request.intake->>'accountAuthority','actorId',auth.uid(),'noticeVersion',p_notice_version,'declaredAt',now(),'revision',coalesce(v_latest.revision,0)+1,
        'detailsSha256',encode(sha256(convert_to(p_details::text,'UTF8')),'hex'),'accountNumberSha256',encode(sha256(convert_to(p_details->>'accountNumber','UTF8')),'hex'),
        'subjects',to_jsonb(array_remove(array[case when p_details ? 'customer' then 'customer.'||(p_details#>>'{customer,id}') end],null)||array(select 'householdMembers.'||(x->>'id') from jsonb_array_elements(coalesce(p_details->'householdMembers','[]')) x)||array_remove(array[case when p_details#>'{outsideSupport,supporter}' is not null then 'outsideSupport.supporter.'||(p_details#>>'{outsideSupport,supporter,id}') end],null))),
      p_notice_version,p_idempotency_key) returning id into v_id;
  return v_id;
end $$;

create function public.parent_start_pgw_application(p_intake jsonb,p_mandate jsonb,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_subject_authority_declared boolean,p_account_authority_declared boolean,p_source_request_id uuid default null,p_source_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_household uuid; v_request public.parent_requests; v_snapshot public.parent_pgw_application_details; v_request_id uuid;
begin
  if p_subject_authority_declared is distinct from true or p_account_authority_declared is distinct from true or not parent_private.pgw_details_collection_enabled() then raise exception 'application collection unavailable' using errcode='42501'; end if;
  perform parent_private.validate_intake(p_intake);
  if p_intake->'needs' is distinct from '["gas"]'::jsonb or p_intake->'householdSize' is distinct from 'null'::jsonb or p_intake->'incomeAmount' is distinct from 'null'::jsonb
    or p_intake->>'incomeFrequency' is distinct from 'unknown' or p_intake->'utilityProviders' is distinct from '["pgw"]'::jsonb
    or not coalesce(p_intake->>'accountAuthority' in ('self','authorized_caregiver'),false) then raise exception 'invalid PGW routing intake' using errcode='23514'; end if;
  v_household:=public.parent_ensure_account(); perform 1 from public.parent_households where id=v_household for no key update;
  if p_idempotency_key is null or (p_source_request_id is null)<>(p_source_version is null) then raise exception 'invalid application save' using errcode='23514'; end if;
  select * into v_request from public.parent_requests where household_id=v_household and start_key=p_idempotency_key for update;
  if found then
    if p_source_request_id is not null then perform public.parent_start_request_with_reused_zip(p_intake,p_mandate,p_idempotency_key,p_source_request_id,p_source_version);
    elsif v_request.intake_reuse ? 'zip' then raise exception 'application changed; reload' using errcode='40001'; end if;
    select * into v_snapshot from public.parent_pgw_application_details where request_id=v_request.id order by revision desc limit 1;
    if v_snapshot.id is null or v_snapshot.idempotency_key<>p_idempotency_key or v_snapshot.request_version<>v_request.version
      or v_request.intake is distinct from p_intake or v_request.mandate is distinct from p_mandate or v_snapshot.details is distinct from p_details or v_snapshot.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    perform public.parent_save_pgw_application_details(v_request.id,v_snapshot.base_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared);
    return v_request.id;
  end if;
  if p_source_request_id is not null then v_request_id:=public.parent_start_request_with_reused_zip(p_intake,p_mandate,p_idempotency_key,p_source_request_id,p_source_version);
  else v_request_id:=public.parent_start_request(p_intake,p_mandate,p_idempotency_key); end if;
  perform public.parent_save_pgw_application_details(v_request_id,1,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared);
  return v_request_id;
end $$;

create function public.parent_pgw_application_collection() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_pgw boolean; v_expiry timestamptz;
begin
  if not public.is_parent_session() then raise exception 'verified parent session required' using errcode='42501'; end if;
  v_pgw:=parent_private.pgw_details_collection_enabled();
  if v_pgw then select least(approved_until,pgw_details_approved_until,'2026-11-20T21:39:43Z'::timestamptz) into v_expiry from parent_private.processing_controls where singleton; end if;
  return jsonb_build_object('collectionEnabled',v_pgw,'noticeVersion',case when v_pgw then 'pgw-application-details-2026-11-13.v1' else null end,'expiresAt',v_expiry);
end $$;

revoke execute on function parent_private.pgw_details_collection_enabled(),parent_private.immutable_pgw_details(),parent_private.validate_pgw_details(jsonb),parent_private.pgw_detail_leaves(jsonb,text) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
revoke execute on function public.parent_save_pgw_application_details(uuid,integer,jsonb,text,uuid,boolean,boolean),public.parent_start_pgw_application(jsonb,jsonb,jsonb,text,uuid,boolean,boolean,uuid,integer),public.parent_pgw_application_collection() from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_save_pgw_application_details(uuid,integer,jsonb,text,uuid,boolean,boolean),public.parent_start_pgw_application(jsonb,jsonb,jsonb,text,uuid,boolean,boolean,uuid,integer),public.parent_pgw_application_collection() to authenticated;
