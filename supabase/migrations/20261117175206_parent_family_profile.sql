-- Family basics have their own purpose gate; no existing programme or live processing is enabled.
alter table parent_private.processing_controls
  add column family_profile_enabled boolean not null default false,
  add column family_profile_approval_reference text,
  add column family_profile_approved_until timestamptz,
  add column family_profile_notice_version text;
create function parent_private.family_profile_collection_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and coalesce((select family_profile_enabled
    and length(btrim(coalesce(family_profile_approval_reference,'')))>0 and isfinite(family_profile_approved_until) and family_profile_approved_until>clock_timestamp()
    and family_profile_notice_version='family-profile-2026-11-17.v1' from parent_private.processing_controls where singleton),false);
$$;
create table parent_private.family_profiles (
  owner_id uuid primary key references public.parent_accounts(id) on delete cascade,
  revision integer not null default 0 check(revision>=0), details jsonb,
  provenance jsonb not null default '{}' check(jsonb_typeof(provenance)='object'),
  notice_version text, consent_evidence jsonb, last_mutation_key uuid,
  updated_at timestamptz not null default clock_timestamp(),
  check(details is null or jsonb_typeof(details)='object')
);
create table parent_private.family_profile_write_receipts (
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  idempotency_key uuid not null, write_hash text not null, revision integer not null,
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '45 days', primary key(owner_id,idempotency_key)
);
create table parent_private.family_profile_request_sources (
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  request_version integer not null, profile_revision integer not null,
  application_path text not null, profile_path text not null, source_hash text not null,
  confirmed_at timestamptz not null, expires_at timestamptz not null,
  primary key(request_id,request_version,application_path,profile_path)
);
alter table parent_private.family_profiles enable row level security;
alter table parent_private.family_profile_write_receipts enable row level security;
alter table parent_private.family_profile_request_sources enable row level security;
revoke all on parent_private.family_profiles,parent_private.family_profile_write_receipts,parent_private.family_profile_request_sources
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

create function parent_private.validate_family_profile(p_details jsonb) returns void
language plpgsql set search_path='' as $$
declare v record; keys text[]; s text; max_length integer; valid boolean;
begin
  if p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>65536 or not(p_details ? 'primaryPerson') then
    raise exception 'invalid family profile' using errcode='23514'; end if;
  for v in with recursive nodes(path,value) as (
    select ''::text,p_details union all
    select case when n.path='' then c.key else n.path||'.'||c.key end,c.value from nodes n cross join lateral (
      select key,value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}' end)
      union all select '*',value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]' end)
    ) c) select * from nodes loop
    keys:=case
      when v.path='' then array['primaryPerson','contact','homeAddress','mailingAddress','mailingAddressSameAsHome','preferredLanguage','otherLanguage','members']
      when v.path='primaryPerson' then array['id','firstName','middleInitial','lastName','dateOfBirth','income']
      when v.path='members.*' then array['id','firstName','middleInitial','lastName','dateOfBirth','relationship','income']
      when v.path='contact' then array['phone','email']
      when v.path in ('homeAddress','mailingAddress') then array['street','apartment','city','state','zip','county']
      when v.path in ('primaryPerson.income','members.*.income') then array['state','sources']
      when v.path in ('primaryPerson.income.sources.*','members.*.income.sources.*') then array['id','kind'] else null end;
    if keys is not null then
      if jsonb_typeof(v.value)<>'object' or exists(select 1 from jsonb_object_keys(v.value) k where not(k=any(keys)))
        or (v.path in ('primaryPerson','members.*','primaryPerson.income.sources.*','members.*.income.sources.*') and not(v.value ? 'id'))
        or (v.path in ('primaryPerson.income','members.*.income') and (not(v.value ?& array['state','sources'])
          or (v.value->>'state'='sources') is distinct from (jsonb_typeof(v.value->'sources')='array' and jsonb_array_length(v.value->'sources')>0)))
        or (v.path in ('primaryPerson.income.sources.*','members.*.income.sources.*') and not(v.value ? 'kind')) then
        raise exception 'invalid family profile' using errcode='23514'; end if;
      continue;
    end if;
    s:=v.value#>>'{}'; max_length:=null;
    if v.path in ('primaryPerson.firstName','primaryPerson.lastName','members.*.firstName','members.*.lastName','members.*.relationship','homeAddress.apartment','homeAddress.city','homeAddress.county','mailingAddress.apartment','mailingAddress.city','mailingAddress.county','otherLanguage') then max_length:=80;
    elsif v.path in ('primaryPerson.middleInitial','members.*.middleInitial') then max_length:=2;
    elsif v.path in ('homeAddress.street','mailingAddress.street') then max_length:=160;
    elsif v.path='contact.email' then max_length:=100; end if;
    if max_length is not null then
      valid:=jsonb_typeof(v.value)='string' and (length(s)+(select count(*) from regexp_split_to_table(s,'') c where ascii(c)>65535)) between 1 and max_length
        and s=btrim(s,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') and s!~'[[:cntrl:]<>]';
      if v.path='contact.email' then valid:=valid and s~'^(?:[A-Za-z0-9_''+\-]+\.)*[A-Za-z0-9_''+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$'; end if;
      s:=replace(translate(normalize(s,NFKC),U&'\200B\200C\200D\2060\FEFF',''),U&'\1680',' ');
      valid:=valid and s!~'[0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4}|[0-9]{12,19}'
        and s!~*'(^|[^A-Za-z0-9_])(password|passcode|pin|ssn|social[[:space:]]+security([[:space:]]+number)?|signature|ebt[[:space:]]+pin)[[:space:]]*(is[[:space:]]+|[:=#][[:space:]]*)[^[:space:]]+';
    else
      valid:=case
        when v.path='members' then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=29
        when v.path in ('primaryPerson.income.sources','members.*.income.sources') then jsonb_typeof(v.value)='array' and jsonb_array_length(v.value)<=30
        when v.path in ('primaryPerson.id','members.*.id','primaryPerson.income.sources.*.id','members.*.income.sources.*.id') then jsonb_typeof(v.value)='string' and s~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        when v.path in ('primaryPerson.dateOfBirth','members.*.dateOfBirth') then jsonb_typeof(v.value)='string' and s~'^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' and to_char(s::date,'YYYY-MM-DD')=s and s::date<=(clock_timestamp() at time zone 'America/New_York')::date
        when v.path='contact.phone' then jsonb_typeof(v.value)='string' and s~'^[0-9]{3}-[0-9]{3}-[0-9]{4}$'
        when v.path in ('homeAddress.state','mailingAddress.state') then jsonb_typeof(v.value)='string' and s~'^[A-Z]{2}$'
        when v.path in ('homeAddress.zip','mailingAddress.zip') then jsonb_typeof(v.value)='string' and s~'^[0-9]{5}$'
        when v.path='mailingAddressSameAsHome' then v.value in ('true','false')
        when v.path='preferredLanguage' then v.value in ('"en"','"es"','"other"')
        when v.path in ('primaryPerson.income.state','members.*.income.state') then v.value in ('"sources"','"none"','"unknown"')
        when v.path in ('primaryPerson.income.sources.*.kind','members.*.income.sources.*.kind') then jsonb_typeof(v.value)='string' and s=any(array['employment','self_employment','unemployment','pension','workers_compensation','veterans','cash_welfare','cash_benefits','child_support','spousal_support','social_security','disability','foster_care','benefits','outside_support','rental','other'])
        else false end;
    end if;
    if not coalesce(valid,false) then raise exception 'invalid family profile' using errcode='23514'; end if;
  end loop;
  if (p_details->'mailingAddressSameAsHome'='true' and p_details ? 'mailingAddress') or (p_details ? 'otherLanguage' and p_details->>'preferredLanguage' is distinct from 'other')
    or (select count(*)<>count(distinct person->>'id') from (select p_details->'primaryPerson' person union all select value from jsonb_array_elements(coalesce(p_details->'members','[]'))) people)
    or exists(select 1 from (select p_details->'primaryPerson' person union all select value from jsonb_array_elements(coalesce(p_details->'members','[]'))) people
      where (select count(*)<>count(distinct source->>'id') from jsonb_array_elements(coalesce(person#>'{income,sources}','[]')) source)) then
    raise exception 'invalid family profile' using errcode='23514'; end if;
exception when others then raise exception 'invalid family profile' using errcode='23514';
end $$;
create function parent_private.canonical_family_profile(p_value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; entry record;
begin
  if jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(parent_private.canonical_family_profile(value) order by value->>'id'),'[]') into result from jsonb_array_elements(p_value);
  elsif jsonb_typeof(p_value)='object' then
    select coalesce(jsonb_object_agg(key,parent_private.canonical_family_profile(value)),'{}') into result from jsonb_each(p_value);
  else result:=p_value; end if;
  return result;
end $$;
create function parent_private.family_profile_leaves(p_value jsonb,p_path text default '') returns table(path text,value jsonb)
language plpgsql set search_path='' as $$
declare v record;
begin
  if p_path like '%.income' then return query select p_path,p_value;
  elsif jsonb_typeof(p_value)='array' and p_path='members' then
    if jsonb_array_length(p_value)=0 then return query select p_path,p_value;
    else for v in select x from jsonb_array_elements(p_value) x loop return query select * from parent_private.family_profile_leaves(v.x,p_path||'.'||(v.x->>'id')); end loop; end if;
  elsif jsonb_typeof(p_value)='object' then
    for v in select e.key,e.value child from jsonb_each(p_value) e where e.key<>'id' loop
      return query select * from parent_private.family_profile_leaves(v.child,case when p_path='' then v.key else p_path||'.'||v.key end); end loop;
  else return query select p_path,p_value; end if;
end $$;
create function parent_private.family_profile_source_hash(p_details jsonb,p_path text) returns text
language sql stable set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_array(l.value,case when p_path like 'primaryPerson.%' then p_details#>'{primaryPerson,id}' else null end)::text,'UTF8')),'hex')
    from parent_private.family_profile_leaves(p_details) l where l.path=p_path;
$$;
create function parent_private.family_profile_reuse_allowed(p_request uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from parent_private.family_profile_request_sources s join public.parent_requests r on r.id=s.request_id
    join public.parent_households h on h.id=r.household_id left join parent_private.family_profiles p on p.owner_id=h.owner_id
    where s.request_id=p_request and s.request_version=p_version and (p.details is null or s.expires_at<=clock_timestamp()
      or s.confirmed_at>clock_timestamp() or parent_private.family_profile_source_hash(p.details,s.profile_path) is distinct from s.source_hash));
$$;
create function parent_private.carry_family_profile_sources() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into parent_private.family_profile_request_sources(request_id,request_version,profile_revision,application_path,profile_path,source_hash,confirmed_at,expires_at)
    select request_id,new.version,profile_revision,application_path,profile_path,source_hash,confirmed_at,expires_at
    from parent_private.family_profile_request_sources where request_id=new.id and request_version=old.version on conflict do nothing;
  return null;
end $$;
create trigger parent_family_profile_source_version after update of version on public.parent_requests
  for each row when(new.version is distinct from old.version) execute function parent_private.carry_family_profile_sources();
create function parent_private.invalidate_family_profile_sources() returns trigger
language plpgsql security definer set search_path='' as $$
declare target record;
begin
  for target in select distinct r.id,r.status from parent_private.family_profile_request_sources s join public.parent_requests r on r.id=s.request_id
    join public.parent_households h on h.id=r.household_id where h.owner_id=new.owner_id and s.request_version=r.version
      and parent_private.family_profile_source_hash(new.details,s.profile_path) is distinct from s.source_hash order by r.id loop
    perform 1 from public.parent_requests where id=target.id for update;
    if target.status in ('active','paused') then perform parent_private.requeue_parent_change(target.id,'A saved family answer changed. Queued uses of the earlier answer have stopped.');
    else perform parent_private.invalidate_work(target.id,'A saved family answer changed. Earlier attempted and submitted records remain in history.'); end if;
  end loop;
  return null;
end $$;
create trigger parent_family_profile_source_changes after update of details on parent_private.family_profiles for each row execute function parent_private.invalidate_family_profile_sources();

create function parent_private.family_profile_source(p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p parent_private.family_profiles; household uuid;
begin
  if not public.is_parent_session() or not parent_private.family_profile_collection_enabled() then raise exception 'family profile unavailable' using errcode='42501'; end if;
  select id into household from public.parent_households where owner_id=auth.uid() for no key update;
  select * into p from parent_private.family_profiles where owner_id=auth.uid() for update;
  if p.revision is distinct from p_revision or p.details is null then raise exception 'family profile changed' using errcode='40001'; end if;
  return jsonb_build_object('details',p.details,'provenance',p.provenance);
end $$;
create function parent_private.bind_family_profile(p_request uuid,p_expected_version integer,p_profile_revision integer,p_mappings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare source jsonb; mapping jsonb; source_path text; dates jsonb; result jsonb:='{}'; earliest timestamptz; confirmed timestamptz;
begin
  source:=parent_private.family_profile_source(p_profile_revision);
  perform 1 from public.parent_requests where id=p_request for update;
  if not parent_private.owns_request(p_request) or not exists(select 1 from public.parent_requests where id=p_request and version=p_expected_version and mandate->'allowedData' ? 'household') then
    raise exception 'family profile request unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_mappings) is distinct from 'array' or jsonb_array_length(p_mappings) not between 1 and 1000
    or (select count(*)<>count(distinct x->>'applicationPath') from jsonb_array_elements(p_mappings) x) then raise exception 'invalid profile mappings' using errcode='23514'; end if;
  for mapping in select value from jsonb_array_elements(p_mappings) loop
    if jsonb_typeof(mapping)<>'object' or (select count(*) from jsonb_object_keys(mapping))<>2 or not(mapping ?& array['applicationPath','profilePaths'])
      or jsonb_typeof(mapping->'applicationPath')<>'string' or mapping->>'applicationPath'!~'^[A-Za-z0-9_.-]{1,200}$'
      or jsonb_typeof(mapping->'profilePaths')<>'array' or jsonb_array_length(mapping->'profilePaths') not between 1 and 10
      or (select count(*)<>count(distinct x) from jsonb_array_elements(mapping->'profilePaths') x) then raise exception 'invalid profile mappings' using errcode='23514'; end if;
    earliest:=null; confirmed:=null;
    for source_path in select jsonb_array_elements_text(mapping->'profilePaths') loop
      dates:=source#>array['provenance',source_path];
      if dates is null or parent_private.family_profile_source_hash(source->'details',source_path) is null
        or (dates->>'confirmedAt')::timestamptz>clock_timestamp() or (dates->>'expiresAt')::timestamptz<=clock_timestamp()
        or (source_path like '%.income' and not exists(select 1 from public.parent_requests where id=p_request and mandate->'allowedData' ? 'income')) then
        raise exception 'family profile source unavailable' using errcode='42501'; end if;
      earliest:=least(earliest,(dates->>'expiresAt')::timestamptz); confirmed:=least(confirmed,(dates->>'confirmedAt')::timestamptz);
      insert into parent_private.family_profile_request_sources(request_id,request_version,profile_revision,application_path,profile_path,source_hash,confirmed_at,expires_at)
        values(p_request,p_expected_version,p_profile_revision,mapping->>'applicationPath',source_path,parent_private.family_profile_source_hash(source->'details',source_path),(dates->>'confirmedAt')::timestamptz,(dates->>'expiresAt')::timestamptz);
    end loop;
    result:=result||jsonb_build_object(mapping->>'applicationPath',jsonb_build_object('confirmedAt',confirmed,'expiresAt',earliest));
  end loop;
  return result;
end $$;

create function public.parent_get_family_profile_sources(p_request_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.parent_get_deletion_status()<>'active' or not exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id
    where r.id=p_request_id and r.version=p_expected_version and h.owner_id=auth.uid()) then raise exception 'family profile request unavailable' using errcode='42501'; end if;
  return jsonb_build_object('fields',(select coalesce(jsonb_agg(jsonb_build_object('applicationPath',application_path,'profilePaths',paths) order by application_path),'[]')
    from (select application_path,jsonb_agg(profile_path order by profile_path) paths from parent_private.family_profile_request_sources
      where request_id=p_request_id and request_version=p_expected_version and application_path<>'intake.zip' group by application_path) grouped));
end $$;
create function public.parent_get_family_profile() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p parent_private.family_profiles; enabled boolean; live_provenance jsonb; live_details jsonb;
begin
  if public.parent_get_deletion_status()<>'active' then raise exception 'family profile unavailable' using errcode='42501'; end if;
  select * into p from parent_private.family_profiles where owner_id=auth.uid();
  enabled:=parent_private.family_profile_collection_enabled();
  select coalesce(jsonb_object_agg(key,value),'{}') into live_provenance from jsonb_each(coalesce(p.provenance,'{}')) where (value->>'expiresAt')::timestamptz>clock_timestamp();
  live_details:=case when p.provenance='{}' then p.details when live_provenance='{}' then null else parent_private.purge_family_profile_value(p.details,live_provenance) end;
  return jsonb_build_object('ownerId',auth.uid(),'revision',coalesce(p.revision,0),'lastMutationKey',p.last_mutation_key,
    'collection',jsonb_build_object('collectionEnabled',enabled,'noticeVersion',case when enabled then 'family-profile-2026-11-17.v1' end,
      'expiresAt',case when enabled then (select least(family_profile_approved_until,approved_until) from parent_private.processing_controls where singleton) end,'retentionDays',45),
    'profile',case when live_details is null then null else jsonb_build_object('revision',p.revision,'details',live_details,'provenance',live_provenance,'idempotencyKey',p.last_mutation_key) end);
end $$;
create function public.parent_save_family_profile(p_expected_owner uuid,p_expected_revision integer,p_details jsonb,p_notice_version text,p_consent_accepted boolean,p_subject_authority_declared boolean,p_confirmed_paths text[],p_idempotency_key uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare p parent_private.family_profiles; receipt parent_private.family_profile_write_receipts; field record; v_provenance jsonb:='{}'; old_leaves jsonb;
  confirmed timestamptz:=date_trunc('milliseconds',clock_timestamp()); expiry timestamptz; hash text;
begin
  if not public.is_parent_session() or auth.uid() is distinct from p_expected_owner or not parent_private.family_profile_collection_enabled()
    or p_notice_version is distinct from 'family-profile-2026-11-17.v1' or p_consent_accepted is distinct from true or p_subject_authority_declared is distinct from true
    or p_expected_revision is null or p_expected_revision<0 or p_idempotency_key is null or p_confirmed_paths is null then raise exception 'family profile unavailable' using errcode='42501'; end if;
  perform parent_private.validate_family_profile(p_details);
  p_details:=parent_private.canonical_family_profile(p_details);
  perform 1 from public.parent_households where owner_id=auth.uid() for no key update;
  insert into parent_private.family_profiles(owner_id) values(auth.uid()) on conflict do nothing;
  select * into p from parent_private.family_profiles where owner_id=auth.uid() for update;
  hash:=encode(sha256(convert_to(jsonb_build_array('save',p_expected_revision,p_details,p_notice_version,p_confirmed_paths)::text,'UTF8')),'hex');
  select * into receipt from parent_private.family_profile_write_receipts where owner_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then if receipt.write_hash is distinct from hash or receipt.revision<>p.revision or p.last_mutation_key is distinct from p_idempotency_key then raise exception 'profile write changed' using errcode='40001'; end if; return receipt.revision; end if;
  if p.revision<>p_expected_revision then raise exception 'family profile changed' using errcode='40001'; end if;
  if (select count(*) from parent_private.family_profile_write_receipts where owner_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then
    raise exception 'family profile write limit' using errcode='23514'; end if;
  if cardinality(p_confirmed_paths)>1000 or (select count(*)<>count(distinct x) from unnest(p_confirmed_paths) x)
    or exists(select 1 from unnest(p_confirmed_paths) x where not exists(select 1 from parent_private.family_profile_leaves(p_details) leaf where leaf.path=x)) then raise exception 'invalid profile confirmations' using errcode='23514'; end if;
  select coalesce(jsonb_object_agg(path,value),'{}') into old_leaves from parent_private.family_profile_leaves(p.details);
  expiry:=least(confirmed+interval '45 days',(select family_profile_approved_until from parent_private.processing_controls where singleton));
  for field in select * from parent_private.family_profile_leaves(p_details) loop
    if old_leaves->field.path is not distinct from field.value and p.provenance ? field.path and not(field.path=any(p_confirmed_paths))
      and not(field.path like 'primaryPerson.%' and p.details#>'{primaryPerson,id}' is distinct from p_details#>'{primaryPerson,id}')
      and (p.provenance#>>array[field.path,'expiresAt'])::timestamptz<=clock_timestamp() then
      raise exception 'confirm the expired family answer before saving' using errcode='23514';
    end if;
    v_provenance:=v_provenance||jsonb_build_object(field.path,case when old_leaves->field.path is not distinct from field.value and p.provenance ? field.path and not(field.path=any(p_confirmed_paths))
      and not(field.path like 'primaryPerson.%' and p.details#>'{primaryPerson,id}' is distinct from p_details#>'{primaryPerson,id}') then p.provenance->field.path
      else jsonb_build_object('confirmedAt',confirmed,'expiresAt',expiry) end);
  end loop;
  update parent_private.family_profiles set revision=p.revision+1,details=p_details,provenance=v_provenance,notice_version=p_notice_version,
    consent_evidence=jsonb_build_object('actorId',auth.uid(),'noticeVersion',p_notice_version,'consentAccepted',true,'subjectAuthorityDeclared',true,'declaredAt',confirmed,'retentionDays',45),last_mutation_key=p_idempotency_key,updated_at=confirmed where owner_id=auth.uid();
  insert into parent_private.family_profile_write_receipts(owner_id,idempotency_key,write_hash,revision) values(auth.uid(),p_idempotency_key,hash,p.revision+1);
  return p.revision+1;
end $$;
create function public.parent_clear_family_profile(p_expected_owner uuid,p_expected_revision integer,p_idempotency_key uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare p parent_private.family_profiles; receipt parent_private.family_profile_write_receipts; hash text;
begin
  if public.parent_get_deletion_status() not in ('active','deletion_requested') or auth.uid() is distinct from p_expected_owner or p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'family profile unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_households where owner_id=auth.uid() for no key update;
  insert into parent_private.family_profiles(owner_id) values(auth.uid()) on conflict do nothing;
  select * into p from parent_private.family_profiles where owner_id=auth.uid() for update;
  hash:=encode(sha256(convert_to(jsonb_build_array('clear',p_expected_revision)::text,'UTF8')),'hex');
  select * into receipt from parent_private.family_profile_write_receipts where owner_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then if receipt.write_hash is distinct from hash or receipt.revision<>p.revision or p.last_mutation_key is distinct from p_idempotency_key then raise exception 'profile write changed' using errcode='40001'; end if; return receipt.revision; end if;
  if p.revision<>p_expected_revision then raise exception 'family profile changed' using errcode='40001'; end if;
  if p.details is null and (select count(*) from parent_private.family_profile_write_receipts where owner_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then
    raise exception 'family profile write limit' using errcode='23514'; end if;
  update parent_private.family_profiles set revision=p.revision+1,details=null,provenance='{}',consent_evidence=null,notice_version=null,last_mutation_key=p_idempotency_key,updated_at=clock_timestamp() where owner_id=auth.uid();
  insert into parent_private.family_profile_write_receipts(owner_id,idempotency_key,write_hash,revision) values(auth.uid(),p_idempotency_key,hash,p.revision+1);
  return p.revision+1;
end $$;

create function parent_private.purge_family_profile_value(p_value jsonb,p_provenance jsonb,p_path text default '') returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb; child jsonb; entry record;
begin
  if p_path like '%.income' or jsonb_typeof(p_value) not in ('object','array') or (p_path='members' and p_value='[]') then
    if (p_provenance#>>array[p_path,'expiresAt'])::timestamptz>clock_timestamp() then return p_value; end if; return null;
  elsif p_path='members' then
    result:='[]'; for entry in select value from jsonb_array_elements(p_value) loop child:=parent_private.purge_family_profile_value(entry.value,p_provenance,p_path||'.'||(entry.value->>'id')); if child is not null then result:=result||jsonb_build_array(child); end if; end loop; return case when result='[]' then null else result end;
  else
    result:='{}'; for entry in select key,value from jsonb_each(p_value) loop
      if entry.key='id' then result:=result||jsonb_build_object(entry.key,entry.value); else
        child:=parent_private.purge_family_profile_value(entry.value,p_provenance,case when p_path='' then entry.key else p_path||'.'||entry.key end);
        if child is not null then result:=result||jsonb_build_object(entry.key,child); end if; end if; end loop;
    if p_path like 'members.%' and (select count(*) from jsonb_object_keys(result))=1 and result ? 'id' then return null; end if; return result;
  end if;
end $$;
create function parent_private.parent_purge_family_profiles(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare p parent_private.family_profiles; clean jsonb; v_provenance jsonb; count integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'invalid profile purge limit' using errcode='23514'; end if;
  for p in select f.* from parent_private.family_profiles f where f.details is not null and (exists(select 1 from jsonb_each(f.provenance) e where (e.value->>'expiresAt')::timestamptz<=clock_timestamp())
    or exists(select 1 from public.parent_accounts a where a.id=f.owner_id and a.status='deletion_requested')) order by f.owner_id for update skip locked limit p_limit loop
    if exists(select 1 from public.parent_accounts where id=p.owner_id and status='deletion_requested') then clean:=null; v_provenance:='{}'; else
      select coalesce(jsonb_object_agg(key,value),'{}') into v_provenance from jsonb_each(p.provenance) where (value->>'expiresAt')::timestamptz>clock_timestamp();
      clean:=case when v_provenance='{}' then null else parent_private.purge_family_profile_value(p.details,v_provenance) end;
    end if;
    update parent_private.family_profiles set details=clean,provenance=v_provenance,revision=revision+1,updated_at=clock_timestamp() where owner_id=p.owner_id;
    count:=count+1;
  end loop;
  delete from parent_private.family_profile_write_receipts where expires_at<=clock_timestamp();
  return count;
end $$;
revoke execute on function parent_private.family_profile_collection_enabled(),parent_private.validate_family_profile(jsonb),parent_private.family_profile_leaves(jsonb,text),
  parent_private.canonical_family_profile(jsonb),parent_private.family_profile_source_hash(jsonb,text),parent_private.family_profile_reuse_allowed(uuid,integer),parent_private.carry_family_profile_sources(),parent_private.invalidate_family_profile_sources(),
  parent_private.family_profile_source(integer),parent_private.bind_family_profile(uuid,integer,integer,jsonb),parent_private.purge_family_profile_value(jsonb,jsonb,text),parent_private.parent_purge_family_profiles(integer)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function parent_private.parent_purge_family_profiles(integer) to parent_retention_worker;
revoke execute on function public.parent_get_family_profile_sources(uuid,integer),public.parent_get_family_profile(),public.parent_save_family_profile(uuid,integer,jsonb,text,boolean,boolean,text[],uuid),public.parent_clear_family_profile(uuid,integer,uuid)
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_get_family_profile_sources(uuid,integer),public.parent_get_family_profile(),public.parent_save_family_profile(uuid,integer,jsonb,text,boolean,boolean,text[],uuid),public.parent_clear_family_profile(uuid,integer,uuid) to authenticated;
