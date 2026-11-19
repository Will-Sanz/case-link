-- Default-off WIC approval is separate from SNAP; the source-review ceiling grants no processing permission.
alter table parent_private.processing_controls
  add column wic_details_enabled boolean not null default false,
  add column wic_details_approval_reference text,
  add column wic_details_approved_until timestamptz,
  add column wic_details_notice_version text;

create function parent_private.wic_details_collection_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and coalesce((select
    wic_details_enabled and length(btrim(coalesce(wic_details_approval_reference,'')))>0
    and wic_details_approved_until>now()
    and wic_details_notice_version='wic-application-details-2026-11-13.v1'
    from parent_private.processing_controls where singleton),false)
    and now()>='2026-11-13T18:57:45.283Z'::timestamptz and now()<'2026-11-20T18:57:45.283Z'::timestamptz;
$$;

create table public.parent_wic_application_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  revision integer not null check(revision>0),
  base_version integer not null check(base_version>0),
  request_version integer not null check(request_version>=base_version),
  details jsonb not null check(jsonb_typeof(details)='object'),
  provenance jsonb not null check(jsonb_typeof(provenance)='object'),
  source jsonb not null check(jsonb_typeof(source)='object'),
  consent_evidence jsonb not null check(jsonb_typeof(consent_evidence)='object'
    and consent_evidence ?& array['subjectAuthorityDeclared','statement','actorId','noticeVersion','declaredAt','revision','detailsSha256','subjects']
    and consent_evidence->'subjectAuthorityDeclared'='true'::jsonb
    and consent_evidence->>'noticeVersion'=notice_version and (consent_evidence->>'revision')::integer=revision
    and consent_evidence->>'detailsSha256'=encode(sha256(convert_to(details::text,'UTF8')),'hex')),
  notice_version text not null check(notice_version='wic-application-details-2026-11-13.v1'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique(request_id,revision), unique(request_id,idempotency_key)
);
alter table public.parent_wic_application_details enable row level security;
revoke all on public.parent_wic_application_details from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant select on public.parent_wic_application_details to authenticated;
create policy parent_wic_details_read on public.parent_wic_application_details for select to authenticated
  using(parent_private.owns_request(request_id));

create function parent_private.immutable_wic_details() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'application snapshots are immutable' using errcode='23514';
end $$;
create trigger parent_wic_details_immutable before update on public.parent_wic_application_details
  for each row execute function parent_private.immutable_wic_details();

-- Contact postal ZIP is independently parent-supplied; household routing and its lineage stay outside private revisions.
create function parent_private.validate_wic_details(p_details jsonb) returns void
language plpgsql set search_path='' as $$
declare v record; v_keys text[]; v_string text; v_max integer; v_ok boolean;
begin
  if p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>32768 then
    raise exception 'invalid WIC details' using errcode='23514';
  end if;
  for v in
    with recursive nodes(path,value) as (
      select ''::text,p_details union all
      select case when n.path='' then c.key else n.path||'.'||c.key end,c.value
      from nodes n cross join lateral (
        select key,value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end)
        union all select '*',value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end)
      ) c
    ) select * from nodes
  loop
    v_keys:=case v.path
      when '' then array['applicationType','beneficiaries','appointmentPreference','contact','mother','children']
      when 'contact' then array['firstName','lastName','street','city','zip','county','email','phone','dateOfBirth']
      when 'mother' then array['firstName','lastName','dateOfBirth','status','expectedDeliveryDate']
      when 'children.*' then array['id','firstName','lastName','dateOfBirth']
      else null end;
    if v_keys is not null then
      if jsonb_typeof(v.value)<>'object' or exists(select 1 from jsonb_object_keys(v.value) k where not(k=any(v_keys)))
        or (v.path='children.*' and not(v.value ? 'id')) then raise exception 'invalid WIC details' using errcode='23514'; end if;
      continue;
    end if;
    v_string:=v.value#>>'{}'; v_max:=null;
    if v.path in ('contact.firstName','contact.lastName','contact.city','mother.firstName','mother.lastName','children.*.firstName','children.*.lastName') then v_max:=50;
    elsif v.path in ('contact.street','contact.email') then v_max:=100;
    end if;
    if v_max is not null then
      v_ok:=jsonb_typeof(v.value)='string' and
        (length(v_string)+(select count(*) from regexp_split_to_table(v_string,'') c where ascii(c)>65535)) between 1 and v_max
        and v_string=btrim(v_string,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        and v_string!~'[[:cntrl:]<>]';
      if v.path='contact.email' then
        v_ok:=v_ok and v_string~'^(?:[A-Za-z0-9_''+\-]+\.)*[A-Za-z0-9_''+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$';
      end if;
    else
      v_ok:=case
        when v.path='applicationType' then v.value in ('"new"','"reapplying"','"transfer"')
        when v.path='beneficiaries' then v.value in ('"mother"','"children"','"mother_and_children"')
        when v.path='appointmentPreference' then v.value in ('"morning"','"afternoon"')
        when v.path='contact.zip' then jsonb_typeof(v.value)='string' and v_string~'^[0-9]{5}$'
        when v.path='contact.county' then v.value='"Philadelphia"'
        when v.path='contact.phone' then jsonb_typeof(v.value)='string' and v_string~'^[0-9]{3}-[0-9]{3}-[0-9]{4}$'
        when v.path='mother.status' then v.value in ('"pregnant"','"postpartum"','"breastfeeding"')
        when v.path in ('contact.dateOfBirth','mother.dateOfBirth','mother.expectedDeliveryDate','children.*.dateOfBirth') then
          jsonb_typeof(v.value)='string' and v_string~'^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' and to_char(v_string::date,'YYYY-MM-DD')=v_string
        when v.path='children' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=30
        when v.path='children.*.id' then jsonb_typeof(v.value)='string' and
          (v_string~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or v_string in ('00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff'))
        else false end;
    end if;
    if not coalesce(v_ok,false) then raise exception 'invalid WIC details' using errcode='23514'; end if;
    if jsonb_typeof(v.value)='string' and v.path<>'children.*.id' then
      v_string:=replace(translate(normalize(v_string,NFKC),U&'\200B\200C\200D\2060\FEFF',''),U&'\1680',' ');
      if v_string~'[0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4}|[0-9]{12,19}'
        or v_string~*'(^|[^A-Za-z0-9_])(password|passcode|pin|ssn|social[[:space:]]+security([[:space:]]+number)?|signature|ebt[[:space:]]+pin)[[:space:]]*(is[[:space:]]+|[:=#][[:space:]]*)[^[:space:]]+' then
        raise exception 'invalid WIC details' using errcode='23514';
      end if;
    end if;
  end loop;
  if (p_details ? 'mother' and coalesce(p_details->>'beneficiaries','') not in ('mother','mother_and_children'))
    or (p_details ? 'children' and coalesce(p_details->>'beneficiaries','') not in ('children','mother_and_children'))
    or (p_details#>'{mother,expectedDeliveryDate}' is not null and p_details#>>'{mother,status}' is distinct from 'pregnant')
    or (p_details#>>'{mother,expectedDeliveryDate}' < p_details#>>'{mother,dateOfBirth}')
    or (select count(*)<>count(distinct c->>'id') from jsonb_array_elements(coalesce(p_details->'children','[]')) c) then
    raise exception 'invalid WIC details' using errcode='23514';
  end if;
exception when others then raise exception 'invalid WIC details' using errcode='23514';
end $$;

create function parent_private.wic_detail_leaves(p_value jsonb,p_path text default '') returns table(path text,value jsonb)
language plpgsql set search_path='' as $$
declare v record;
begin
  if jsonb_typeof(p_value)='object' then
    if p_value-'id'='{}'::jsonb and p_path<>'' then return query select p_path,'{}'::jsonb; return; end if;
    for v in select * from jsonb_each(p_value) where key<>'id' loop
      return query select * from parent_private.wic_detail_leaves(v.value,case when p_path='' then v.key else p_path||'.'||v.key end);
    end loop;
  elsif p_path='children' and jsonb_array_length(p_value)>0 then
    for v in select x from jsonb_array_elements(p_value) x loop
      return query select * from parent_private.wic_detail_leaves(v.x,p_path||'.'||(v.x->>'id'));
    end loop;
  else return query select p_path,p_value;
  end if;
end $$;

create function public.parent_save_wic_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_subject_authority_declared boolean) returns uuid
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
  if p_idempotency_key is null or p_expected_version is null then raise exception 'invalid WIC save' using errcode='23514'; end if;
  select * into v_latest from public.parent_wic_application_details where request_id=p_request_id order by revision desc limit 1;
  select * into v_retry from public.parent_wic_application_details where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_retry.id is distinct from v_latest.id or v_retry.request_version<>v_request.version or v_retry.base_version<>p_expected_version
      or v_retry.details is distinct from p_details or v_retry.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    return v_retry.id;
  end if;
  if v_request.version<>p_expected_version then raise exception 'application changed; reload' using errcode='40001'; end if;
  if coalesce(v_latest.revision,0)>=500 or (select count(*) from public.parent_wic_application_details where request_id=p_request_id and created_at>now()-interval '1 minute')>=20 then
    raise exception 'WIC save limit reached' using errcode='23514';
  end if;
  perform parent_private.validate_wic_details(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_leaves from parent_private.wic_detail_leaves(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_old_leaves from parent_private.wic_detail_leaves(coalesce(v_latest.details,'{}'));
  v_changed:=v_leaves<>v_old_leaves;
  for v_leaf in select key path,value from jsonb_each(v_leaves) loop
    if v_old_leaves->v_leaf.path is distinct from v_leaf.value and v_leaf.path ~ '(^|\.)dateOfBirth$' and v_leaf.value#>>'{}'>v_today then
      raise exception 'invalid WIC dates' using errcode='23514';
    end if;
    if v_old_leaves->v_leaf.path=v_leaf.value and v_latest.provenance ? v_leaf.path then v_metadata:=v_latest.provenance->v_leaf.path;
    else v_metadata:=jsonb_build_object('source','parent','confirmedAt',now(),'asOf',v_today);
    end if;
    v_provenance:=v_provenance||jsonb_build_object(v_leaf.path,v_metadata);
  end loop;
  if v_changed then perform parent_private.requeue_parent_change(p_request_id,'You updated private WIC application details. CaseLink will revalidate permitted work.'); end if;
  select version into v_new_version from public.parent_requests where id=p_request_id;
  insert into public.parent_wic_application_details(request_id,revision,base_version,request_version,details,provenance,source,consent_evidence,notice_version,idempotency_key)
    values(p_request_id,coalesce(v_latest.revision,0)+1,p_expected_version,v_new_version,p_details,v_provenance,
      '{"contractId":"pa-wic-preapplication-2026-11-13","contractVersion":"2026-11-13.v1","sourceUrl":"https://pawic.com/OnlineApplication.aspx","sourceSha256":"c6daa011c75c4b21838cea17a579d1097c09b00f0584e668eede2a343dd0b774","sourceCheckedAt":"2026-11-13T18:57:45.283Z","verifiedUntil":"2026-11-20T18:57:45.283Z"}',jsonb_build_object('subjectAuthorityDeclared',true,'statement','I have permission to provide this information and request this WIC help for myself and every person named, including children and any other adult.',
        'actorId',auth.uid(),'noticeVersion',p_notice_version,'declaredAt',now(),'revision',coalesce(v_latest.revision,0)+1,
        'detailsSha256',encode(sha256(convert_to(p_details::text,'UTF8')),'hex'),
        'subjects',to_jsonb(array_remove(array[case when p_details ? 'contact' then 'contact' end,case when p_details ? 'mother' then 'mother' end],null)||
          array(select 'children.'||(c->>'id') from jsonb_array_elements(coalesce(p_details->'children','[]')) c))),p_notice_version,p_idempotency_key) returning id into v_id;
  return v_id;
end $$;

-- The queued job and complete initial answers become visible at the same commit.
create function public.parent_start_wic_application(p_intake jsonb,p_mandate jsonb,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_subject_authority_declared boolean,p_source_request_id uuid default null,p_source_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_household uuid; v_request public.parent_requests; v_snapshot public.parent_wic_application_details; v_request_id uuid;
begin
  if p_subject_authority_declared is distinct from true or not parent_private.wic_details_collection_enabled() then raise exception 'application collection unavailable' using errcode='42501'; end if;
  perform parent_private.validate_intake(p_intake);
  if p_intake->'needs' is distinct from '["wic_new"]'::jsonb
    or p_intake->'householdSize' is distinct from 'null'::jsonb or p_intake->'incomeAmount' is distinct from 'null'::jsonb
    or p_intake->>'incomeFrequency' is distinct from 'unknown' or p_intake->'utilityProviders' is distinct from '[]'::jsonb
    or p_intake->'shutoffDate' is distinct from 'null'::jsonb or p_intake->>'accountAuthority' is distinct from 'self' then
    raise exception 'invalid WIC routing intake' using errcode='23514';
  end if;
  v_household:=public.parent_ensure_account();
  perform 1 from public.parent_households where id=v_household for no key update;
  if p_idempotency_key is null or (p_source_request_id is null)<>(p_source_version is null) then raise exception 'invalid application save' using errcode='23514'; end if;
  select * into v_request from public.parent_requests where household_id=v_household and start_key=p_idempotency_key for update;
  if found then
    if p_source_request_id is not null then
      perform public.parent_start_request_with_reused_zip(p_intake,p_mandate,p_idempotency_key,p_source_request_id,p_source_version);
    elsif v_request.intake_reuse ? 'zip' then raise exception 'application changed; reload' using errcode='40001'; end if;
    select * into v_snapshot from public.parent_wic_application_details where request_id=v_request.id order by revision desc limit 1;
    if v_snapshot.id is null or v_snapshot.idempotency_key<>p_idempotency_key or v_snapshot.request_version<>v_request.version
      or v_request.intake is distinct from p_intake or v_request.mandate is distinct from p_mandate or v_snapshot.details is distinct from p_details or v_snapshot.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    perform public.parent_save_wic_application_details(v_request.id,v_snapshot.base_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared);
    return v_request.id;
  end if;
  if p_source_request_id is not null then
    v_request_id:=public.parent_start_request_with_reused_zip(p_intake,p_mandate,p_idempotency_key,p_source_request_id,p_source_version);
  else v_request_id:=public.parent_start_request(p_intake,p_mandate,p_idempotency_key); end if;
  perform public.parent_save_wic_application_details(v_request_id,1,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared);
  return v_request_id;
end $$;

revoke execute on function parent_private.wic_details_collection_enabled(),parent_private.immutable_wic_details(),parent_private.validate_wic_details(jsonb),parent_private.wic_detail_leaves(jsonb,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.wic_details_collection_enabled() to authenticated;
revoke execute on function public.parent_save_wic_application_details(uuid,integer,jsonb,text,uuid,boolean),public.parent_start_wic_application(jsonb,jsonb,jsonb,text,uuid,boolean,uuid,integer)
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_save_wic_application_details(uuid,integer,jsonb,text,uuid,boolean),public.parent_start_wic_application(jsonb,jsonb,jsonb,text,uuid,boolean,uuid,integer) to authenticated;

-- Keep the existing timing RPC unchanged for older clients sharing this database.
create function public.parent_wic_application_collection() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_wic boolean; v_expiry timestamptz;
begin
  if not public.is_parent_session() then raise exception 'verified parent session required' using errcode='42501'; end if;
  v_wic:=parent_private.wic_details_collection_enabled();
  if v_wic then select least(approved_until,wic_details_approved_until,'2026-11-20T18:57:45.283Z'::timestamptz) into v_expiry
    from parent_private.processing_controls where singleton; end if;
  return jsonb_build_object('collectionEnabled',v_wic,'noticeVersion',case when v_wic then 'wic-application-details-2026-11-13.v1' else null end,'expiresAt',v_expiry);
end $$;
revoke execute on function public.parent_wic_application_collection() from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_wic_application_collection() to authenticated;
