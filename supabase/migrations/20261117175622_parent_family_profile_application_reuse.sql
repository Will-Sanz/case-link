-- Fixed programme projection only. Client source labels and custom settings never establish provenance.
create table parent_private.family_profile_application_receipts (
  owner_id uuid not null references public.parent_accounts(id) on delete cascade,
  idempotency_key uuid not null, request_id uuid not null references public.parent_requests(id) on delete cascade,
  result_id uuid not null, source_hash text not null, write_hash text not null, mutation text not null check(mutation in ('start','save')), primary key(owner_id,idempotency_key,mutation)
);
alter table parent_private.family_profile_application_receipts enable row level security;
revoke all on parent_private.family_profile_application_receipts from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

create function parent_private.family_profile_application_value(p_value jsonb,p_path text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare part text; result jsonb:=p_value;
begin
  foreach part in array string_to_array(p_path,'.') loop
    if jsonb_typeof(result)='array' then select value into result from jsonb_array_elements(result) where value->>'id'=part;
    elsif jsonb_typeof(result)='object' then if result->>'id' is distinct from part then result:=result->part; end if;
    else return null; end if;
  end loop;
  return result;
end $$;
create function parent_private.family_profile_application_fact(p_value jsonb,p_path text) returns jsonb
language sql immutable set search_path='' as $$
  select case when p_path like '%.income' then jsonb_build_object('state',v->'state','sources',parent_private.canonical_family_profile(v->'sources')) else v end
    from (select parent_private.family_profile_application_value(p_value,p_path) v) selected;
$$;

create function parent_private.family_profile_application_projection(p_profile jsonb,p_kind text,p_intake jsonb,p_details jsonb,p_options jsonb,p_path text) returns jsonb
language plpgsql stable set search_path='' as $$
declare parts text[]:=string_to_array(p_path,'.'); profile jsonb:=p_profile->'details'; person jsonb; source_path text; target_value jsonb; paths text[];
  selected_id text; primary_id text:=p_profile#>>'{details,primaryPerson,id}'; role text; field text; address jsonb; address_path text; extras text[]:='{}'; key text; joined text;
  adult boolean; date_metadata jsonb;
begin
  if p_kind='snap_application' then
    if cardinality(parts)=2 and parts[1]='applicant' and parts[2]=any(array['firstName','lastName','middleInitial']) then source_path:='primaryPerson.'||parts[2];
    elsif cardinality(parts)=3 and parts[1]='household' and parts[3]=any(array['firstName','lastName','middleInitial','dateOfBirth','relationship']) then
      if parts[2]=primary_id then if parts[3]='relationship' then return null; end if; source_path:='primaryPerson.'||parts[3];
      elsif exists(select 1 from jsonb_array_elements(coalesce(profile->'members','[]')) x where x->>'id'=parts[2]) then source_path:='members.'||parts[2]||'.'||parts[3]; end if;
    elsif p_path=any(array['address.city','address.state','zip','county']) then source_path:='homeAddress.'||parts[cardinality(parts)];
    elsif p_path='address.street' then address:=profile->'homeAddress'; address_path:='homeAddress';
    elsif p_path='phone' then source_path:='contact.phone';
    elsif p_path='language' then source_path:='preferredLanguage';
    elsif p_path='otherLanguage' and profile->>'preferredLanguage'='other' then source_path:='otherLanguage'; end if;
  elsif p_kind='wic_application' then
    if p_path=any(array['contact.firstName','contact.lastName','contact.dateOfBirth']) then source_path:='primaryPerson.'||parts[2];
    elsif p_path=any(array['contact.phone','contact.email']) then source_path:=p_path;
    elsif cardinality(parts)=3 and parts[1]='children' and parts[3]=any(array['firstName','lastName','dateOfBirth'])
      and p_details->>'beneficiaries'=any(array['children','mother_and_children']) and p_options->'wicChildIds' ? parts[2]
      and exists(select 1 from jsonb_array_elements(coalesce(profile->'members','[]')) x where x->>'id'=parts[2]) then source_path:='members.'||parts[2]||'.'||parts[3];
    elsif p_path=any(array['contact.street','contact.city','contact.zip','contact.county']) then
      if profile->'mailingAddressSameAsHome'='true' then address:=profile->'homeAddress'; address_path:='homeAddress'; extras:=array['mailingAddressSameAsHome'];
      else address:=profile->'mailingAddress'; address_path:='mailingAddress'; end if;
      if parts[2]<>'street' then source_path:=address_path||'.'||parts[2]; address:=null; end if;
    end if;
  elsif p_kind=any(array['peco_application','pgw_application','water_application']) then
    if p_intake->>'accountAuthority'='self' then selected_id:=primary_id;
    elsif p_intake->>'accountAuthority'='authorized_caregiver' then
      selected_id:=p_options->>'accountPersonId';
      if selected_id is distinct from primary_id and not exists(select 1 from jsonb_array_elements(coalesce(profile->'members','[]')) x where x->>'id'=selected_id) then selected_id:=null; end if;
    end if;
    role:=case when p_kind='pgw_application' then 'customer' else 'applicant' end;
    if cardinality(parts)=3 and selected_id is not null and ((parts[1]=role and parts[2]=selected_id) or (parts[1]='householdMembers' and parts[2]<>selected_id)) then
      if parts[2]=primary_id then person:=profile->'primaryPerson'; source_path:='primaryPerson';
      else select x into person from jsonb_array_elements(coalesce(profile->'members','[]')) x where x->>'id'=parts[2]; source_path:='members.'||parts[2]; end if;
      if person is null then return null; end if; field:=parts[3];
      if field=any(array['firstName','lastName']) and p_kind<>'water_application'
        or field='middleInitial' and p_kind='peco_application'
        or field='dateOfBirth' and not(p_kind='pgw_application' and parts[1]='customer')
        or field='relationship' and parts[1]='householdMembers' and selected_id=primary_id and parts[2]<>primary_id then source_path:=source_path||'.'||field;
      elsif field='name' and p_kind='water_application' then
        paths:=array[source_path||'.firstName',source_path||'.lastName'];
        if person ?& array['firstName','lastName'] then target_value:=to_jsonb((person->>'firstName')||' '||(person->>'lastName')); end if; source_path:=null;
      elsif field='income' then
        if p_kind='peco_application' and parts[1]='householdMembers' then
          date_metadata:=p_profile#>array['provenance',source_path||'.dateOfBirth'];
          adult:=person ? 'dateOfBirth' and (person->>'dateOfBirth')::date<=((clock_timestamp() at time zone 'America/New_York')::date-interval '18 years')::date;
          if not coalesce(adult,false) or date_metadata is null or (date_metadata->>'confirmedAt')::timestamptz>clock_timestamp() or (date_metadata->>'expiresAt')::timestamptz<=clock_timestamp() then return null; end if;
        end if;
        source_path:=source_path||'.income';
      else return null; end if;
    elsif selected_id=primary_id and p_path=any(array['phone','email','homePhone','cellPhone']) then
      if p_path='phone' and p_kind=any(array['pgw_application','water_application']) then source_path:='contact.phone';
      elsif p_path='email' and p_kind='water_application' then source_path:='contact.email';
      elsif p_kind='peco_application' and ((p_path='homePhone' and p_options->>'pecoPhoneType'='home') or (p_path='cellPhone' and p_options->>'pecoPhoneType'='cell')) then source_path:='contact.phone'; end if;
    elsif p_options->'useHomeAddress'='true' and p_path=any(array['address.street','address.apartment','address.city','address.state','address.zip','propertyAddress']) then
      address:=profile->'homeAddress'; address_path:='homeAddress';
      if p_kind='peco_application' and parts[1]='address' then source_path:=address_path||'.'||parts[2]; address:=null;
      elsif p_kind='pgw_application' and p_path=any(array['address.city','address.state','address.zip']) then source_path:=address_path||'.'||parts[2]; address:=null;
      elsif not((p_kind='pgw_application' and p_path='address.street') or (p_kind='water_application' and p_path='propertyAddress')) then return null; end if;
    elsif p_kind='water_application' and selected_id=primary_id and p_path='mailingAddress' then
      if profile->'mailingAddressSameAsHome'='true' then address:=profile->'homeAddress'; address_path:='homeAddress'; extras:=array['mailingAddressSameAsHome'];
      else address:=profile->'mailingAddress'; address_path:='mailingAddress'; end if;
    end if;
  end if;
  if source_path is not null then
    target_value:=parent_private.family_profile_application_value(profile,source_path); paths:=extras||array[source_path];
  elsif address is not null and address ? 'street' then
    paths:=extras; joined:=null;
    foreach key in array case when p_kind='water_application' then array['street','apartment','city','state','zip'] else array['street','apartment'] end loop
      if address ? key then paths:=paths||(address_path||'.'||key); joined:=concat_ws(', ',joined,address->>key); end if;
    end loop;
    target_value:=to_jsonb(joined);
  end if;
  if target_value is null or paths is null or cardinality(paths)=0 then return null; end if;
  return jsonb_build_object('value',target_value,'profilePaths',paths);
end $$;

create function parent_private.verify_family_profile_application(p_kind text,p_intake jsonb,p_details jsonb,p_source jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile jsonb; mapping jsonb; projected jsonb; dates jsonb; source_path text; result jsonb:='{}'; confirmed timestamptz; expiry timestamptz;
  options jsonb:=coalesce(p_source->'options','{}'); paths jsonb; expected_paths jsonb;
begin
  if p_source->>'expectedOwnerId' is distinct from auth.uid()::text then raise exception 'profile application owner changed' using errcode='42501'; end if;
  if p_kind is null or not(p_kind=any(array['snap_application','wic_application','peco_application','pgw_application','water_application']))
    or jsonb_typeof(p_source) is distinct from 'object' or not(p_source ?& array['expectedOwnerId','revision','fields'])
    or exists(select 1 from jsonb_object_keys(p_source) k where not(k=any(array['expectedOwnerId','revision','fields','options'])))
    or jsonb_typeof(p_source->'revision') is distinct from 'number' or p_source->>'revision'!~'^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_source->'fields') is distinct from 'array' or jsonb_array_length(p_source->'fields') not between 1 and 1000
    or jsonb_typeof(options) is distinct from 'object' or exists(select 1 from jsonb_object_keys(options) k where not(k=any(array['accountPersonId','useHomeAddress','wicChildIds','pecoPhoneType'])))
    or (options ? 'accountPersonId' and (jsonb_typeof(options->'accountPersonId')<>'string' or options->>'accountPersonId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'))
    or (options ? 'useHomeAddress' and options->'useHomeAddress' not in ('true','false'))
    or (options ? 'pecoPhoneType' and (jsonb_typeof(options->'pecoPhoneType') is distinct from 'string' or options->>'pecoPhoneType' not in ('home','cell')))
    or (options ? 'wicChildIds' and (jsonb_typeof(options->'wicChildIds')<>'array' or jsonb_array_length(options->'wicChildIds')>29
      or exists(select 1 from jsonb_array_elements(options->'wicChildIds') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
      or (select count(*)<>count(distinct x) from jsonb_array_elements(options->'wicChildIds') x))) then raise exception 'invalid profile application source' using errcode='23514'; end if;
  begin
    profile:=parent_private.family_profile_source((p_source->>'revision')::integer);
  exception when serialization_failure then raise exception 'parent_family_profile_source_changed'; end;
  for mapping in select value from jsonb_array_elements(p_source->'fields') loop
    if jsonb_typeof(mapping) is distinct from 'object' or (select count(*) from jsonb_object_keys(mapping))<>2 or not(mapping ?& array['applicationPath','profilePaths'])
      or jsonb_typeof(mapping->'applicationPath') is distinct from 'string' or mapping->>'applicationPath'!~'^[A-Za-z0-9_.-]{1,200}$'
      or jsonb_typeof(mapping->'profilePaths') is distinct from 'array' or jsonb_array_length(mapping->'profilePaths') not between 1 and 10
      or result ? (mapping->>'applicationPath') then raise exception 'invalid profile application mapping' using errcode='23514'; end if;
    projected:=parent_private.family_profile_application_projection(profile,p_kind,p_intake,p_details,options,mapping->>'applicationPath');
    select jsonb_agg(x order by x) into paths from jsonb_array_elements(mapping->'profilePaths') x;
    select jsonb_agg(x order by x) into expected_paths from jsonb_array_elements(projected->'profilePaths') x;
    if projected is null or paths is distinct from expected_paths or projected->'value' is distinct from parent_private.family_profile_application_fact(p_details,mapping->>'applicationPath') then
      raise exception 'parent_family_profile_source_changed'; end if;
    confirmed:=null; expiry:=null;
    for source_path in select jsonb_array_elements_text(mapping->'profilePaths') loop
      dates:=profile#>array['provenance',source_path];
      if dates is null or (dates->>'confirmedAt')::timestamptz>clock_timestamp() or (dates->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'parent_family_profile_source_changed'; end if;
      confirmed:=least(confirmed,(dates->>'confirmedAt')::timestamptz); expiry:=least(expiry,(dates->>'expiresAt')::timestamptz);
    end loop;
    -- PECO adult income depends on its fresh birth date; that exact DOB is also kept in the source set.
    if p_kind='peco_application' and mapping->>'applicationPath' like 'householdMembers.%.income'
      and not exists(select 1 from jsonb_array_elements(p_source->'fields') x where x->>'applicationPath'=regexp_replace(mapping->>'applicationPath','\.income$','.dateOfBirth')) then
      raise exception 'profile income age source unavailable' using errcode='42501'; end if;
    result:=result||jsonb_build_object(mapping->>'applicationPath',jsonb_build_object('confirmedAt',confirmed,'expiresAt',expiry));
  end loop;
  return result;
end $$;

create function parent_private.family_profile_application_provenance() returns trigger
language plpgsql security definer set search_path='' as $$
declare source jsonb; dates jsonb; item record; leaf record; kind text; request public.parent_requests; previous jsonb; old_value jsonb;
begin
  kind:=case tg_table_name when 'parent_snap_application_details' then 'snap_application' when 'parent_wic_application_details' then 'wic_application'
    when 'parent_peco_application_details' then 'peco_application' when 'parent_pgw_application_details' then 'pgw_application' when 'parent_water_application_details' then 'water_application' end;
  select * into request from public.parent_requests where id=new.request_id;
  source:=nullif(current_setting('caselink.family_profile_application_source',true),'')::jsonb;
  if source is not null then
    if not parent_private.owns_request(new.request_id) then raise exception 'profile application unavailable' using errcode='42501'; end if;
    dates:=parent_private.verify_family_profile_application(kind,request.intake,new.details,source);
    for item in select key path,value from jsonb_each(dates) loop
      for leaf in select key path from jsonb_each(new.provenance) where key=item.path or (item.path like '%.income' and (key=item.path||'.state' or key like item.path||'.sources.%' or key=item.path||'.sources')) loop
        new.provenance:=jsonb_set(new.provenance,array[leaf.path],new.provenance->leaf.path||jsonb_build_object('confirmedAt',item.value->'confirmedAt','asOf',to_char((item.value->>'confirmedAt')::timestamptz at time zone 'America/New_York','YYYY-MM-DD')));
      end loop;
    end loop;
    execute format('select to_jsonb(s) from public.%I s where request_id=$1 order by revision desc limit 1',tg_table_name) into previous using new.request_id;
    if previous is not null and previous->'details'=new.details and previous->'provenance' is distinct from new.provenance and new.request_version=new.base_version then
      perform parent_private.requeue_parent_change(new.request_id,'Current saved family answers refreshed private application preparation.');
      select version into new.request_version from public.parent_requests where id=new.request_id;
    end if;
  end if;
  return new;
end $$;
create function parent_private.clear_changed_family_profile_application_sources() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb; item record;
begin
  execute format('select details from public.%I where request_id=$1 and id<>$2 order by revision desc limit 1',tg_table_name) into previous using new.request_id,new.id;
  if previous is not null then
    for item in select distinct application_path from parent_private.family_profile_request_sources where request_id=new.request_id and request_version=new.request_version and application_path<>'intake.zip' loop
      if parent_private.family_profile_application_fact(new.details,item.application_path) is distinct from parent_private.family_profile_application_fact(previous,item.application_path) then
        delete from parent_private.family_profile_request_sources where request_id=new.request_id and request_version=new.request_version and application_path=item.application_path;
      end if;
    end loop;
  end if;
  return null;
end $$;
do $$ declare name text; begin
  foreach name in array array['parent_snap_application_details','parent_wic_application_details','parent_peco_application_details','parent_pgw_application_details','parent_water_application_details'] loop
    execute format('create trigger family_profile_provenance before insert on public.%I for each row execute function parent_private.family_profile_application_provenance()',name);
    execute format('create trigger family_profile_changed_answers after insert on public.%I for each row execute function parent_private.clear_changed_family_profile_application_sources()',name);
  end loop;
end $$;

create function public.parent_start_application_with_family_profile(p_kind text,p_intake jsonb,p_mandate jsonb,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_family_profile_source jsonb,
  p_subject_authority_declared boolean default false,p_account_authority_declared boolean default false,p_source_request_id uuid default null,p_source_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare dates jsonb; old_setting text; request_id uuid; version integer; household uuid; receipt parent_private.family_profile_application_receipts; source_hash text; write_hash text;
begin
  if not public.is_parent_session() then raise exception 'profile application unavailable' using errcode='42501'; end if;
  select id into household from public.parent_households where owner_id=auth.uid() for no key update;
  if p_idempotency_key is null or (p_source_request_id is null)<>(p_source_version is null) then raise exception 'invalid profile application start' using errcode='23514'; end if;
  source_hash:=encode(sha256(convert_to(p_family_profile_source::text,'UTF8')),'hex');
  write_hash:=encode(sha256(convert_to(jsonb_build_array(p_kind,p_intake,p_mandate,p_details,p_notice_version,p_family_profile_source,p_subject_authority_declared,p_account_authority_declared,p_source_request_id,p_source_version)::text,'UTF8')),'hex');
  select * into receipt from parent_private.family_profile_application_receipts where owner_id=auth.uid() and idempotency_key=p_idempotency_key and mutation='start';
  if found then
    if receipt.source_hash is distinct from source_hash or receipt.write_hash is distinct from write_hash then raise exception 'profile application start changed' using errcode='40001'; end if;
    if not parent_private.owns_request(receipt.request_id) then raise exception 'profile application unavailable' using errcode='42501'; end if;
    return receipt.request_id;
  elsif exists(select 1 from public.parent_requests where household_id=household and start_key=p_idempotency_key) then raise exception 'profile application start changed' using errcode='40001'; end if;
  dates:=parent_private.verify_family_profile_application(p_kind,p_intake,p_details,p_family_profile_source);
  old_setting:=current_setting('caselink.family_profile_application_source',true);
  perform set_config('caselink.family_profile_application_source',p_family_profile_source::text,true);
  case p_kind
    when 'snap_application' then
      if p_source_request_id is null then request_id:=public.parent_start_snap_application(p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key);
      else request_id:=public.parent_start_request_with_reused_zip(p_intake,p_mandate,p_idempotency_key,p_source_request_id,p_source_version); perform public.parent_save_snap_application_details(request_id,1,p_details,p_notice_version,p_idempotency_key); end if;
    when 'wic_application' then request_id:=public.parent_start_wic_application(p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_source_request_id,p_source_version);
    when 'peco_application' then request_id:=public.parent_start_peco_application(p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared,p_source_request_id,p_source_version);
    when 'pgw_application' then request_id:=public.parent_start_pgw_application(p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared,p_source_request_id,p_source_version);
    when 'water_application' then request_id:=public.parent_start_water_application(p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared,p_account_authority_declared,p_source_request_id,p_source_version);
  end case;
  perform set_config('caselink.family_profile_application_source',coalesce(old_setting,''),true);
  select r.version into version from public.parent_requests r where r.id=request_id;
  perform parent_private.bind_family_profile(request_id,version,(p_family_profile_source->>'revision')::integer,p_family_profile_source->'fields');
  -- Routing ZIP is the same saved fact; a new request must not turn it into a newly confirmed source.
  if exists(select 1 from jsonb_array_elements(p_family_profile_source->'fields') x where x->'profilePaths' ? 'homeAddress.zip')
    and p_intake->'zip'=(select details#>'{homeAddress,zip}' from parent_private.family_profiles where owner_id=auth.uid()) then
    update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',(select provenance#>'{homeAddress.zip,confirmedAt}' from parent_private.family_profiles where owner_id=auth.uid())) where id=request_id;
    perform parent_private.bind_family_profile(request_id,version,(p_family_profile_source->>'revision')::integer,
      '[{"applicationPath":"intake.zip","profilePaths":["homeAddress.zip"]}]');
  end if;
  insert into parent_private.family_profile_application_receipts(owner_id,idempotency_key,request_id,result_id,source_hash,write_hash,mutation) values(auth.uid(),p_idempotency_key,request_id,request_id,source_hash,write_hash,'start');
  return request_id;
exception when others then
  perform set_config('caselink.family_profile_application_source',coalesce(old_setting,''),true); raise;
end $$;

create function public.parent_save_application_with_family_profile(p_kind text,p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_family_profile_source jsonb default null,
  p_subject_authority_declared boolean default false,p_account_authority_declared boolean default false,p_confirmed_paths text[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare request public.parent_requests; table_name text; previous jsonb; original_sources jsonb; item record; result uuid; final_version integer;
  source_hash text; write_hash text; receipt parent_private.family_profile_application_receipts; old_setting text; dates jsonb; refresh_routing boolean:=false;
begin
  if p_kind is null or not(p_kind=any(array['snap_application','wic_application','peco_application','pgw_application','water_application']))
    or p_idempotency_key is null or p_expected_version is null or p_confirmed_paths is null or (p_kind<>'snap_application' and cardinality(p_confirmed_paths)>0) then
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
    when 'wic_application' then result:=public.parent_save_wic_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_subject_authority_declared);
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

create or replace function parent_private.carry_family_profile_sources() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into parent_private.family_profile_request_sources(request_id,request_version,profile_revision,application_path,profile_path,source_hash,confirmed_at,expires_at)
    select request_id,new.version,profile_revision,application_path,profile_path,source_hash,confirmed_at,expires_at
    from parent_private.family_profile_request_sources where request_id=new.id and request_version=old.version
      and (application_path<>'intake.zip' or new.intake->'zip' is not distinct from old.intake->'zip') on conflict do nothing;
  return null;
end $$;
alter function parent_private.reusable_zip_source(uuid,uuid) rename to original_reusable_zip_source;
create function parent_private.reusable_zip_source(p_source uuid,p_household uuid) returns jsonb
language plpgsql stable set search_path='' as $$
begin
  if exists(select 1 from parent_private.family_profile_request_sources s join public.parent_requests r on r.id=s.request_id
    join public.parent_households h on h.id=r.household_id left join parent_private.family_profiles p on p.owner_id=h.owner_id
    where r.id=p_source and r.household_id=p_household and s.request_version=r.version and s.application_path='intake.zip'
      and (p.details is null or s.expires_at<=clock_timestamp() or s.confirmed_at>clock_timestamp()
        or parent_private.family_profile_source_hash(p.details,s.profile_path) is distinct from s.source_hash)) then return null; end if;
  return parent_private.original_reusable_zip_source(p_source,p_household);
end $$;
revoke all on function parent_private.reusable_zip_source(uuid,uuid),parent_private.original_reusable_zip_source(uuid,uuid)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

create function parent_private.replace_family_profile_application_value(p_value jsonb,p_path text[],p_new jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare position integer;
begin
  if cardinality(p_path)=0 then return p_new; end if;
  if jsonb_typeof(p_value)='array' then
    select (ordinality-1)::integer into position from jsonb_array_elements(p_value) with ordinality where value->>'id'=p_path[1];
    if position is null then raise exception 'profile application person changed' using errcode='23514'; end if;
    return jsonb_set(p_value,array[position::text],parent_private.replace_family_profile_application_value(p_value->position,p_path[2:],p_new));
  elsif jsonb_typeof(p_value)='object' then
    if p_value->>'id'=p_path[1] then return parent_private.replace_family_profile_application_value(p_value,p_path[2:],p_new); end if;
    return jsonb_set(p_value,array[p_path[1]],parent_private.replace_family_profile_application_value(p_value->p_path[1],p_path[2:],p_new));
  end if;
  raise exception 'profile application answer changed' using errcode='23514';
end $$;

-- A current profile save can update already authorized food preparation, never choose a new person or programme.
create function parent_private.refresh_food_profile_applications() returns trigger
language plpgsql security definer set search_path='' as $$
declare request public.parent_requests; previous jsonb; details jsonb; mappings jsonb; mapping jsonb; projected jsonb;
  options jsonb; source jsonb; kind text; table_name text; valid boolean; consent jsonb;
begin
  if new.details is null or auth.uid() is distinct from new.owner_id or not public.is_parent_session()
    or not parent_private.family_profile_collection_enabled() then return null; end if;
  for request in select r.* from public.parent_requests r join public.parent_households h on h.id=r.household_id
    where h.owner_id=new.owner_id and r.status='active' and r.mandate_revoked_at is null
      and exists(select 1 from parent_private.family_profile_request_sources s where s.request_id=r.id and s.request_version=r.version)
    order by r.id for update of r loop
    kind:=case when request.intake->'needs'='["snap_new"]'::jsonb then 'snap_application'
      when request.intake->'needs'='["wic_new"]'::jsonb then 'wic_application' end;
    if kind is null then continue; end if;
    table_name:=case kind when 'snap_application' then 'parent_snap_application_details' else 'parent_wic_application_details' end;
    execute format('select to_jsonb(s) from public.%I s where request_id=$1 order by revision desc limit 1',table_name) into previous using request.id;
    if previous is null then continue; end if;
    details:=previous->'details'; options:='{}'; consent:=previous->'consent_evidence';
    if kind='wic_application' then
      options:=jsonb_build_object('wicChildIds',(select coalesce(jsonb_agg(x->'id'),'[]') from jsonb_array_elements(coalesce(details->'children','[]')) x));
    end if;
    select jsonb_agg(jsonb_build_object('applicationPath',application_path,'profilePaths',paths)) into mappings
      from (select application_path,jsonb_agg(profile_path order by profile_path) paths from parent_private.family_profile_request_sources
        where request_id=request.id and request_version=request.version and application_path<>'intake.zip' group by application_path) fields;
    if mappings is null then continue; end if;
    valid:=true;
    for mapping in select value from jsonb_array_elements(mappings) loop
      projected:=parent_private.family_profile_application_projection(jsonb_build_object('details',new.details,'provenance',new.provenance),kind,request.intake,details,options,mapping->>'applicationPath');
      if projected is null or (select jsonb_agg(x order by x) from jsonb_array_elements(projected->'profilePaths') x) is distinct from mapping->'profilePaths' then valid:=false; exit; end if;
      details:=parent_private.replace_family_profile_application_value(details,string_to_array(mapping->>'applicationPath','.'),projected->'value');
    end loop;
    if not valid then continue; end if;
    source:=jsonb_build_object('expectedOwnerId',new.owner_id,'revision',new.revision,'fields',mappings,'options',options);
    begin
      perform public.parent_save_application_with_family_profile(kind,request.id,request.version,details,previous->>'notice_version',gen_random_uuid(),source,
        coalesce((consent->>'subjectAuthorityDeclared')::boolean,false),false,'{}');
    exception when check_violation or insufficient_privilege or serialization_failure or raise_exception then
      -- Incompatible or unavailable routes keep their invalidated work stopped; the profile correction is still useful elsewhere.
      null;
    end;
  end loop;
  return null;
end $$;
create trigger parent_family_profile_sync_food after update of details,provenance on parent_private.family_profiles
  for each row execute function parent_private.refresh_food_profile_applications();
revoke all on function parent_private.replace_family_profile_application_value(jsonb,text[],jsonb),parent_private.refresh_food_profile_applications()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

-- Preserve the existing live-account, mandate, cohort, revocation and processing checks verbatim.
create or replace function parent_private.current_grant(p_request uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.processing_enabled() and exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id join auth.users u on u.id=a.id
    where r.id=p_request and r.version=p_version and r.status='active' and r.mandate_revoked_at is null
      and a.status='active' and not exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex')) and (u.banned_until is null or u.banned_until<now())
      and parent_private.existing_account_available(a.id)
      and (r.mandate->>'expiresAt')::timestamptz>now()
      and (not(r.intake_reuse ? 'zip') or parent_private.reusable_zip_source((r.intake_reuse#>>'{zip,sourceRequestId}')::uuid,r.household_id) is not null))
    and parent_private.family_profile_reuse_allowed(p_request,p_version);
$$;
revoke execute on function parent_private.family_profile_application_value(jsonb,text),parent_private.family_profile_application_fact(jsonb,text),
  parent_private.family_profile_application_projection(jsonb,text,jsonb,jsonb,jsonb,text),parent_private.verify_family_profile_application(text,jsonb,jsonb,jsonb),
  parent_private.family_profile_application_provenance(),parent_private.clear_changed_family_profile_application_sources()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
revoke execute on function public.parent_start_application_with_family_profile(text,jsonb,jsonb,jsonb,text,uuid,jsonb,boolean,boolean,uuid,integer),public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[])
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_start_application_with_family_profile(text,jsonb,jsonb,jsonb,text,uuid,jsonb,boolean,boolean,uuid,integer),public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[]) to authenticated;
