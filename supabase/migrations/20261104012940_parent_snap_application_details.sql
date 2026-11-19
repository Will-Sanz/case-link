-- Separate purpose approval: the existing processing switch does not authorize this collection.
alter table parent_private.processing_controls
  add column snap_details_enabled boolean not null default false,
  add column snap_details_approval_reference text,
  add column snap_details_approved_until timestamptz,
  add column snap_details_notice_version text;

create function parent_private.snap_details_collection_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and coalesce((select
    snap_details_enabled and length(btrim(coalesce(snap_details_approval_reference,'')))>0
    and snap_details_approved_until>now()
    and snap_details_notice_version='snap-application-details-2026-11-03.v1'
    from parent_private.processing_controls where singleton),false)
    and now()>='2026-11-03T00:00:00Z'::timestamptz and now()<'2026-12-03T05:00:00Z'::timestamptz;
$$;

create table public.parent_snap_application_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  revision integer not null check(revision>0),
  base_version integer not null check(base_version>0),
  request_version integer not null check(request_version>=base_version),
  details jsonb not null check(jsonb_typeof(details)='object'),
  provenance jsonb not null check(jsonb_typeof(provenance)='object'),
  source jsonb not null check(jsonb_typeof(source)='object'),
  notice_version text not null check(notice_version='snap-application-details-2026-11-03.v1'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique(request_id,revision), unique(request_id,idempotency_key)
);
alter table public.parent_snap_application_details enable row level security;
revoke all on public.parent_snap_application_details from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant select on public.parent_snap_application_details to authenticated;
create policy parent_snap_details_read on public.parent_snap_application_details for select to authenticated
  using(parent_private.owns_request(request_id));

create function parent_private.immutable_snap_details() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'application snapshots are immutable' using errcode='23514';
end $$;
create trigger parent_snap_details_immutable before update on public.parent_snap_application_details
  for each row execute function parent_private.immutable_snap_details();

-- This mirrors the browser-safe SNAP contract; unknown containers and unknown leaves both fail closed.
create function parent_private.validate_snap_details(p_details jsonb) returns void
language plpgsql set search_path='' as $$
declare v record; v_ok boolean; v_keys text[]; v_string text; v_max integer; v_people jsonb; v_entries jsonb; v_person jsonb; v_entry jsonb; v_answer jsonb; v_expenses jsonb; v_claims jsonb; v_field text;
begin
  if p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>65536 then
    raise exception 'invalid application details' using errcode='23514';
  end if;
  for v in
    with recursive nodes(path,value) as (
      select ''::text,p_details
      union all
      select case when n.path='' then c.key else n.path||'.'||c.key end,c.value
      from nodes n cross join lateral (
        select key,value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end)
        union all
        select '*',value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end)
      ) c
    ) select * from nodes
  loop
    v_keys:=case v.path
      when '' then array['zip','language','otherLanguage','householdSize','incomeAmount','incomeFrequency','applicant','address','county','phone','otherPhone','bestTimeToCall','interpreter','interpreterLanguage','screening','household','income','history','expenses','expenseClaims','authorizedRepresentative']
      when 'applicant' then array['firstName','lastName','middleInitial']
      when 'address' then array['street','city','state']
      when 'screening' then array['lowCashAndIncome','migrantOrSeasonal','belowShelterCosts']
      when 'household.*' then array['id','firstName','lastName','middleInitial','dateOfBirth','sex','student','relationship','requestingSnap','citizen']
      when 'income' then array['month','hasIncome','entries']
      when 'income.entries.*' then array['id','personId','source','amount','frequency','status','date']
      when 'history' then array['fleeingOrProbation','welfareFraud','otherStateDisqualification']
      when 'history.fleeingOrProbation' then array['answer','names','date','state']
      when 'history.welfareFraud' then array['answer','names','date','state']
      when 'history.otherStateDisqualification' then array['answer','names']
      when 'expenses' then array['childSupport','courtOrdered','mealsIncludedInRent','heat','housingAssistance','housingAssistanceKind','utilityAllowance','outsidePayer','outsideExpenses','outsideAmount','outsideFrequency','outsidePayee','airConditioning','utilities','otherUtility','care','careMonthlyAmount','careRecipient','rent','condoFees','mortgage','propertyFees','homeownersInsurance','medical','otherMedical']
      when 'expenseClaims' then array['household','housing','medical']
      when 'authorizedRepresentative' then array['name','address','phone']
      when 'authorizedRepresentative.address' then array['street','city','state','zip']
      else null end;
    if v_keys is not null then
      if jsonb_typeof(v.value)<>'object' then raise exception 'invalid application details' using errcode='23514'; end if;
      if exists(select 1 from jsonb_object_keys(v.value) k where not(k=any(v_keys)))
        or (v.path in ('household.*','income.entries.*') and not(v.value ? 'id')) then
        raise exception 'invalid application details' using errcode='23514';
      end if;
      continue;
    end if;
    v_string:=v.value#>>'{}'; v_max:=null;
    if v.path in ('applicant.firstName','applicant.lastName','household.*.firstName','household.*.lastName','address.city','authorizedRepresentative.address.city','county','otherLanguage','interpreterLanguage') then v_max:=80;
    elsif v.path in ('applicant.middleInitial','household.*.middleInitial') then v_max:=2;
    elsif v.path in ('address.street','authorizedRepresentative.address.street') then v_max:=180;
    elsif v.path in ('phone','otherPhone','authorizedRepresentative.phone') then v_max:=30;
    elsif v.path='bestTimeToCall' then v_max:=70;
    elsif v.path in ('household.*.relationship','history.fleeingOrProbation.state','history.welfareFraud.state') then v_max:=40;
    elsif v.path='income.entries.*.source' then v_max:=100;
    elsif v.path in ('income.entries.*.frequency','expenses.outsideFrequency') then v_max:=60;
    elsif v.path in ('history.fleeingOrProbation.names','history.welfareFraud.names','history.otherStateDisqualification.names') then v_max:=200;
    elsif v.path in ('expenses.housingAssistanceKind','expenses.outsideExpenses','expenses.outsidePayee','expenses.otherUtility','expenses.careRecipient','expenses.otherMedical','authorizedRepresentative.name') then v_max:=160;
    end if;
    if v_max is not null then
      v_ok:=jsonb_typeof(v.value)='string' and (length(v_string)+(select count(*) from regexp_split_to_table(v_string,'') c where ascii(c)>65535)) between 1 and v_max
        and v_string=btrim(v_string,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        and v_string!~'[[:cntrl:]]';
      if v.path in ('phone','otherPhone','authorizedRepresentative.phone') then
        v_ok:=v_ok and v_string~'^\+?[0-9 ().-]+$' and length(regexp_replace(v_string,'[^0-9]','','g')) between 7 and 15;
      end if;
    else
      v_ok:=case
        when v.path in ('zip','authorizedRepresentative.address.zip') then jsonb_typeof(v.value)='string' and v_string~'^[0-9]{5}$'
        when v.path in ('address.state','authorizedRepresentative.address.state') then jsonb_typeof(v.value)='string' and v_string~'^[A-Z]{2}$'
        when v.path in ('household.*.id','income.entries.*.id','income.entries.*.personId') then jsonb_typeof(v.value)='string' and (v_string~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or v_string in ('00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff'))
        when v.path='language' then v.value in ('"en"','"es"','"other"')
        when v.path='incomeFrequency' then v.value in ('"weekly"','"biweekly"','"twice_monthly"','"monthly"','"yearly"')
        when v.path='household.*.sex' then v.value in ('"male"','"female"')
        when v.path='income.entries.*.status' then v.value in ('"received"','"expected"')
        when v.path in ('expenseClaims.household','expenseClaims.medical') then v.value in ('"claim"','"do_not_claim"') or (v.path='expenseClaims.medical' and v.value='"not_applicable"')
        when v.path='income.month' then jsonb_typeof(v.value)='string' and v_string~'^[0-9]{4}-(0[1-9]|1[0-2])$'
        when v.path in ('household.*.dateOfBirth','income.entries.*.date','history.fleeingOrProbation.date','history.welfareFraud.date') then jsonb_typeof(v.value)='string' and v_string~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and to_char(v_string::date,'YYYY-MM-DD')=v_string
        when v.path='householdSize' then jsonb_typeof(v.value)='number' and v_string::numeric between 1 and 30 and v_string::numeric=trunc(v_string::numeric)
        when v.path in ('incomeAmount','income.entries.*.amount','expenses.outsideAmount','expenses.careMonthlyAmount','expenses.rent','expenses.condoFees','expenses.mortgage','expenses.propertyFees','expenses.homeownersInsurance') then jsonb_typeof(v.value)='number' and v_string::numeric between 0 and 1000000
        when v.path in ('interpreter','screening.lowCashAndIncome','screening.migrantOrSeasonal','screening.belowShelterCosts','household.*.student','household.*.requestingSnap','household.*.citizen','income.hasIncome','history.fleeingOrProbation.answer','history.welfareFraud.answer','history.otherStateDisqualification.answer','expenses.childSupport','expenses.courtOrdered','expenses.mealsIncludedInRent','expenses.heat','expenses.housingAssistance','expenses.utilityAllowance','expenses.outsidePayer','expenses.airConditioning','expenses.care') then jsonb_typeof(v.value)='boolean'
        when v.path='household' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value) between 1 and 30
        when v.path='income.entries' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=100
        when v.path='expenses.utilities' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=10
        when v.path='expenses.medical' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=10
        when v.path='expenseClaims.housing' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=5
        when v.path='expenses.utilities.*' then v.value in ('"telephone"','"water"','"garbage"','"installation"','"electric"','"oil"','"sewer"','"gas"','"propane"','"other"')
        when v.path='expenses.medical.*' then v.value in ('"dental"','"doctor"','"equipment"','"premiums"','"hospital"','"prescriptions"','"homeAide"','"supplies"','"transport"','"other"')
        when v.path='expenseClaims.housing.*' then v.value in ('"rent"','"condoFees"','"mortgage"','"propertyFees"','"homeownersInsurance"')
        else false end;
    end if;
    if not coalesce(v_ok,false) then raise exception 'invalid application details' using errcode='23514'; end if;
    if jsonb_typeof(v.value)='string' and v.path not in ('household.*.id','income.entries.*.id','income.entries.*.personId') then
      v_string:=translate(normalize(v_string,NFKC),U&'\200B\200C\200D\2060\FEFF','');
      v_string:=replace(v_string,U&'\1680',' ');
      if v_string~'(^|[^A-Za-z0-9_])[0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4}($|[^A-Za-z0-9_])'
        or (v.path not in ('phone','otherPhone','authorizedRepresentative.phone') and v_string~'(^|[^A-Za-z0-9_])[0-9]{12,19}($|[^A-Za-z0-9_])')
        or v_string~*'(^|[^A-Za-z0-9_])(password|passcode|pin|ssn|social[[:space:]]+security([[:space:]]+number)?|signature|ebt[[:space:]]+pin)[[:space:]]*(is[[:space:]]+|[:=#][[:space:]]*)[^[:space:]]+' then
        raise exception 'invalid application details' using errcode='23514';
      end if;
    end if;
  end loop;
  v_people:=coalesce(p_details->'household','[]'); v_entries:=coalesce(p_details#>'{income,entries}','[]');
  if (select count(*)<>count(distinct p->>'id') from jsonb_array_elements(v_people) p)
    or (select count(*)<>count(distinct e->>'id') from jsonb_array_elements(v_entries) e) then raise exception 'invalid application details' using errcode='23514'; end if;
  for v_person in select value from jsonb_array_elements(v_people) loop
    if v_person ? 'citizen' and v_person->'requestingSnap' is distinct from 'true'::jsonb then raise exception 'invalid application details' using errcode='23514'; end if;
  end loop;
  if v_people->0 ? 'relationship' and upper(v_people->0->>'relationship')<>'SELF' then raise exception 'invalid application details' using errcode='23514'; end if;
  foreach v_field in array array['firstName','lastName','middleInitial'] loop
    if p_details->'applicant' ? v_field and v_people->0 ? v_field and p_details->'applicant'->v_field is distinct from v_people->0->v_field then raise exception 'invalid application details' using errcode='23514'; end if;
  end loop;
  if p_details#>'{income,hasIncome}'='false'::jsonb and jsonb_array_length(v_entries)>0 then raise exception 'invalid application details' using errcode='23514'; end if;
  for v_entry in select value from jsonb_array_elements(v_entries) loop
    if v_entry ? 'personId' and not exists(select 1 from jsonb_array_elements(v_people) p where p->>'id'=v_entry->>'personId') then raise exception 'invalid application details' using errcode='23514'; end if;
  end loop;
  for v_answer in select value from jsonb_each(coalesce(p_details->'history','{}')) loop
    if v_answer->'answer'='false'::jsonb and v_answer-'answer'<>'{}'::jsonb then raise exception 'invalid application details' using errcode='23514'; end if;
  end loop;
  if (p_details ? 'otherLanguage' and p_details->>'language' is distinct from 'other') or (p_details->'interpreter'='false'::jsonb and p_details ? 'interpreterLanguage') then raise exception 'invalid application details' using errcode='23514'; end if;
  v_expenses:=coalesce(p_details->'expenses','{}'); v_claims:=coalesce(p_details->'expenseClaims','{}');
  if (v_expenses->'childSupport'='false'::jsonb and v_expenses ? 'courtOrdered')
    or (v_expenses->'housingAssistance'='false'::jsonb and v_expenses ?| array['housingAssistanceKind','utilityAllowance'])
    or (v_expenses->'outsidePayer'='false'::jsonb and v_expenses ?| array['outsideExpenses','outsideAmount','outsideFrequency','outsidePayee'])
    or (v_expenses->'care'='false'::jsonb and v_expenses ?| array['careMonthlyAmount','careRecipient'])
    or (v_expenses ? 'otherUtility' and not coalesce(v_expenses->'utilities' ? 'other',false))
    or (v_expenses ? 'otherMedical' and not coalesce(v_expenses->'medical' ? 'other',false))
    or (v_claims->>'household'='do_not_claim' and v_expenses-array['medical','otherMedical']<>'{}'::jsonb)
    or (v_claims->>'medical' in ('not_applicable','do_not_claim') and (coalesce(jsonb_array_length(v_expenses->'medical'),0)>0 or v_expenses ? 'otherMedical'))
    or (v_claims->>'household'='do_not_claim' and coalesce(jsonb_array_length(v_claims->'housing'),0)>0) then raise exception 'invalid application details' using errcode='23514'; end if;
  foreach v_field in array array['utilities','medical'] loop
    if (select count(*)<>count(distinct x) from jsonb_array_elements(v_expenses->v_field) x) then raise exception 'invalid application details' using errcode='23514'; end if;
  end loop;
  if (select count(*)<>count(distinct x) from jsonb_array_elements(v_claims->'housing') x) then raise exception 'invalid application details' using errcode='23514'; end if;
  foreach v_field in array array['rent','condoFees','mortgage','propertyFees','homeownersInsurance'] loop
    if v_expenses ? v_field and v_claims ? 'housing' and not(v_claims->'housing' ? v_field) then raise exception 'invalid application details' using errcode='23514'; end if;
  end loop;
exception when others then
  raise exception 'invalid application details' using errcode='23514';
end $$;

-- Stable row IDs make reorderings harmless; checkbox sets remain single factual answers.
create function parent_private.snap_detail_leaves(p_value jsonb,p_path text default '') returns table(path text,value jsonb)
language plpgsql set search_path='' as $$
declare v record; v_child_path text;
begin
  if jsonb_typeof(p_value)='object' then
    if p_value='{}'::jsonb and p_path<>'' then return query select p_path,p_value; return; end if;
    for v in select * from jsonb_each(p_value) loop
      v_child_path:=case when p_path='' then v.key else p_path||'.'||v.key end;
      return query select * from parent_private.snap_detail_leaves(v.value,v_child_path);
    end loop;
  elsif p_path in ('household','income.entries') then
    for v in select x from jsonb_array_elements(p_value) x loop
      return query select * from parent_private.snap_detail_leaves(v.x,p_path||'.'||(v.x->>'id'));
    end loop;
  else
    return query select p_path,case when jsonb_typeof(p_value)='array' then
      (select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements(p_value) x) else p_value end;
  end if;
end $$;

create function public.parent_save_snap_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.parent_requests; v_latest public.parent_snap_application_details; v_retry public.parent_snap_application_details;
  v_id uuid; v_provenance jsonb:='{}'; v_previous jsonb:='{}'; v_old_leaves jsonb:='{}'; v_leaves jsonb:='{}'; v_leaf record; v_metadata jsonb;
  v_today text:=to_char(now() at time zone 'America/New_York','YYYY-MM-DD'); v_income_changed boolean; v_changed boolean;
  v_confirmed timestamptz; v_fact jsonb; v_field text; v_new_version integer;
begin
  if not parent_private.owns_request(p_request_id) or not parent_private.snap_details_collection_enabled() then raise exception 'application collection unavailable' using errcode='42501'; end if;
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if not parent_private.current_grant(p_request_id,v_request.version) or not(v_request.intake->'needs' ? 'snap_new')
    or not(v_request.mandate->'recipientIds' ? 'snap-pa') or not(v_request.mandate->'allowedActions' ? 'prepare')
    or not(v_request.mandate->'allowedData' ? 'household')
    or p_notice_version is distinct from 'snap-application-details-2026-11-03.v1' then raise exception 'application collection unavailable' using errcode='42501'; end if;
  if p_idempotency_key is null or p_expected_version is null then raise exception 'invalid application save' using errcode='23514'; end if;
  select * into v_latest from public.parent_snap_application_details where request_id=p_request_id order by revision desc limit 1;
  select * into v_retry from public.parent_snap_application_details where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_retry.id is distinct from v_latest.id or v_retry.request_version<>v_request.version or v_retry.base_version<>p_expected_version
      or v_retry.details is distinct from p_details or v_retry.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    return v_retry.id;
  end if;
  if v_request.version<>p_expected_version then raise exception 'application changed; reload' using errcode='40001'; end if;
  if coalesce(v_latest.revision,0)>=500 or (select count(*) from public.parent_snap_application_details where request_id=p_request_id and created_at>now()-interval '1 minute')>=20 then
    raise exception 'application save limit reached' using errcode='23514';
  end if;
  perform parent_private.validate_snap_details(p_details);
  if (p_details ?| array['income','incomeAmount','incomeFrequency','screening','expenses','expenseClaims']) and not(v_request.mandate->'allowedData' ? 'income') then raise exception 'application collection unavailable' using errcode='42501'; end if;
  v_previous:=coalesce(v_latest.details,'{}');
  select coalesce(jsonb_object_agg(path,value),'{}') into v_leaves from parent_private.snap_detail_leaves(p_details);
  select coalesce(jsonb_object_agg(path,value),'{}') into v_old_leaves from parent_private.snap_detail_leaves(v_previous);
  v_changed:=v_leaves<>v_old_leaves;
  v_income_changed:=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(v_leaves) where key like 'income.%') is distinct from
    (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(v_old_leaves) where key like 'income.%');
  if v_income_changed and ((p_details#>>'{income,month}' is not null and p_details#>>'{income,month}'<>left(v_today,7)) or exists(
    select 1 from jsonb_array_elements(coalesce(p_details#>'{income,entries}','[]')) e where e ? 'date' and
    (left(e->>'date',7)<>left(v_today,7) or (e->>'status'='received' and e->>'date'>v_today) or (e->>'status'='expected' and e->>'date'<v_today)))) then raise exception 'invalid application dates' using errcode='23514'; end if;
  for v_leaf in select key path,value from jsonb_each(v_leaves) loop
    if jsonb_typeof(v_leaf.value)='object' or v_leaf.path like 'household.%.id' or v_leaf.path like 'income.entries.%.id' then continue; end if;
    if v_old_leaves->v_leaf.path is distinct from v_leaf.value and
      (v_leaf.path like 'household.%.dateOfBirth' or v_leaf.path in ('history.fleeingOrProbation.date','history.welfareFraud.date')) and v_leaf.value#>>'{}'>v_today then raise exception 'invalid application dates' using errcode='23514'; end if;
    if v_old_leaves->v_leaf.path=v_leaf.value and v_latest.provenance ? v_leaf.path
      and (v_leaf.path not like 'income.%' or v_latest.provenance->v_leaf.path->>'period' is not distinct from p_details#>>'{income,month}') then
      v_metadata:=v_latest.provenance->v_leaf.path;
    else
      v_confirmed:=now(); v_fact:=null;
      if v_latest.id is null and v_leaf.path in ('zip','language') then
        select f into v_fact from jsonb_array_elements(v_request.facts) f where f->>'need'='snap_new' and f->>'field'=v_leaf.path and f->>'source'='parent'
          and (f->>'confirmedAt')::timestamptz between now()-interval '45 days' and now()
          and (f->>'asOf')::timestamptz between now()-interval '45 days' and (f->>'confirmedAt')::timestamptz order by (f->>'confirmedAt')::timestamptz desc limit 1;
        if v_fact->'value' is distinct from v_leaf.value then v_fact:=null; end if;
        if v_fact is not null then v_confirmed:=(v_fact->>'confirmedAt')::timestamptz;
        elsif not(v_leaf.path=any(v_request.intake_need_scoped_fields)) and v_request.intake->v_leaf.path=v_leaf.value
          and (v_request.intake_confirmed_at->>v_leaf.path)::timestamptz between now()-interval '45 days' and now() then
          v_confirmed:=(v_request.intake_confirmed_at->>v_leaf.path)::timestamptz;
        end if;
      end if;
      v_metadata:=jsonb_build_object('source','parent','confirmedAt',v_confirmed,'asOf',coalesce(v_fact->>'asOf',to_char(v_confirmed at time zone 'America/New_York','YYYY-MM-DD')));
      if v_leaf.path like 'income.%' and p_details#>>'{income,month}' is not null then v_metadata:=v_metadata||jsonb_build_object('period',p_details#>>'{income,month}'); end if;
    end if;
    v_provenance:=v_provenance||jsonb_build_object(v_leaf.path,v_metadata);
  end loop;
  if v_changed then perform parent_private.requeue_parent_change(p_request_id,'You updated private SNAP application details. CaseLink will revalidate permitted work.'); end if;
  select version into v_new_version from public.parent_requests where id=p_request_id;
  insert into public.parent_snap_application_details(request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key)
    values(p_request_id,coalesce(v_latest.revision,0)+1,p_expected_version,v_new_version,p_details,v_provenance,
      '{"templateId":"pa-snap-pa600fs-sg-2019","templateVersion":"2019-09-reviewed-2026-11-03","templateSha256":"21df1916ca4e05b72ebe4075d9005246cea35f755dd44a61c48772d20f0f57e0","inventoryId":"pa-snap-pa600fs-sg-2019-field-inventory","inventoryVersion":"2026-11-03.v1","inventorySha256":"5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee"}',p_notice_version,p_idempotency_key) returning id into v_id;
  return v_id;
end $$;

-- The queued job and complete initial answers become visible at the same commit.
create function public.parent_start_snap_application(p_intake jsonb,p_mandate jsonb,p_details jsonb,p_notice_version text,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_household uuid; v_request public.parent_requests; v_snapshot public.parent_snap_application_details; v_request_id uuid;
begin
  if not parent_private.snap_details_collection_enabled() then raise exception 'application collection unavailable' using errcode='42501'; end if;
  v_household:=public.parent_ensure_account();
  perform 1 from public.parent_households where id=v_household for update;
  if p_idempotency_key is null then raise exception 'invalid application save' using errcode='23514'; end if;
  select * into v_request from public.parent_requests where household_id=v_household and start_key=p_idempotency_key for update;
  if found then
    select * into v_snapshot from public.parent_snap_application_details where request_id=v_request.id order by revision desc limit 1;
    if v_snapshot.id is null or v_snapshot.idempotency_key<>p_idempotency_key or v_snapshot.request_version<>v_request.version
      or v_request.intake is distinct from p_intake or v_request.mandate is distinct from p_mandate or v_snapshot.details is distinct from p_details or v_snapshot.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
    perform public.parent_save_snap_application_details(v_request.id,v_snapshot.base_version,p_details,p_notice_version,p_idempotency_key);
    return v_request.id;
  end if;
  v_request_id:=public.parent_start_request(p_intake,p_mandate,p_idempotency_key);
  perform public.parent_save_snap_application_details(v_request_id,1,p_details,p_notice_version,p_idempotency_key);
  return v_request_id;
end $$;

revoke execute on function parent_private.snap_details_collection_enabled(),parent_private.immutable_snap_details(),parent_private.validate_snap_details(jsonb),parent_private.snap_detail_leaves(jsonb,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function parent_private.snap_details_collection_enabled() to authenticated;
revoke execute on function public.parent_save_snap_application_details(uuid,integer,jsonb,text,uuid),public.parent_start_snap_application(jsonb,jsonb,jsonb,text,uuid)
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_save_snap_application_details(uuid,integer,jsonb,text,uuid),public.parent_start_snap_application(jsonb,jsonb,jsonb,text,uuid) to authenticated;

-- Keep the existing timing RPC unchanged for older clients sharing this database.
create function public.parent_snap_application_collection() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_snap boolean;
begin
  if not public.is_parent_session() then raise exception 'verified parent session required' using errcode='42501'; end if;
  v_snap:=parent_private.snap_details_collection_enabled();
  return jsonb_build_object('collectionEnabled',v_snap,'noticeVersion',case when v_snap then 'snap-application-details-2026-11-03.v1' else null end);
end $$;
revoke execute on function public.parent_snap_application_collection() from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_snap_application_collection() to authenticated;
