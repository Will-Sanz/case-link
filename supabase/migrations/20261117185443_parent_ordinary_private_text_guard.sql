-- New writes share one text boundary; existing immutable snapshots are not rewritten or revalidated.
create function parent_private.ordinary_application_text_allowed(p_details jsonb,p_kind text) returns boolean
language plpgsql immutable set search_path='' as $$
declare leaf record; guarded_text text; normalized text; snap_phone boolean; id_paths text[];
begin
  if p_kind is null or not(p_kind=any(array['snap_application','wic_application','peco_application','pgw_application','water_application','family_profile'])) then return false; end if;
  if p_details is null then return p_kind='family_profile'; end if;
  if jsonb_typeof(p_details) is distinct from 'object' then return false; end if;
  id_paths:=case p_kind
    when 'snap_application' then array['household.*.id','income.entries.*.id','income.entries.*.personId']
    when 'wic_application' then array['children.*.id']
    when 'peco_application' then array['applicant.id','applicant.income.sources.*.id','householdMembers.*.id','householdMembers.*.income.sources.*.id']
    when 'pgw_application' then array['customer.id','customer.income.sources.*.id','householdMembers.*.id','householdMembers.*.income.sources.*.id','outsideSupport.supporter.id']
    when 'water_application' then array['applicant.id','applicant.income.sources.*.id','householdMembers.*.id','householdMembers.*.income.sources.*.id','outsideSupporters.*.id']
    when 'family_profile' then array['primaryPerson.id','primaryPerson.income.sources.*.id','members.*.id','members.*.income.sources.*.id'] end;
  for leaf in
    with recursive nodes(path,value) as (
      select ''::text,p_details union all
      select case when n.path='' then c.key else n.path||'.'||c.key end,c.value from nodes n cross join lateral (
        select key,value from jsonb_each(case when jsonb_typeof(n.value)='object' then n.value else '{}'::jsonb end)
        union all select '*',value from jsonb_array_elements(case when jsonb_typeof(n.value)='array' then n.value else '[]'::jsonb end)
      ) c
    ) select path,value#>>'{}' text_value from nodes where jsonb_typeof(value)='string'
  loop
    -- Structural validators still require actual UUIDs and the programme's dedicated account format.
    if leaf.path=any(id_paths) or (p_kind in ('peco_application','pgw_application') and leaf.path='accountNumber') then continue; end if;
    guarded_text:=leaf.text_value;
    if guarded_text~U&'[\0001-\001f\007f-\009f<>]' then return false; end if;
    normalized:=replace(translate(normalize(guarded_text,NFKC),U&'\200B\200C\200D\2060\FEFF',''),U&'\1680',' ');
    snap_phone:=p_kind='snap_application' and leaf.path=any(array['phone','otherPhone','authorizedRepresentative.phone'])
      and guarded_text~'^\+?[0-9 ().-]+$' and length(regexp_replace(guarded_text,'[^0-9]','','g')) between 7 and 15;
    if (snap_phone and normalized~'(^|[^A-Za-z0-9_])[0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4}($|[^A-Za-z0-9_])')
      or (not snap_phone and normalized~'[0-9]{3}[-./[:space:]‐‑‒–—―]*[0-9]{2}[-./[:space:]‐‑‒–—―]*[0-9]{4}|[0-9]{12,19}')
      or normalized~*'(^|[^A-Za-z0-9_])(password|passcode|pin|ssn([[:space:]./_‐‑‒–—―-]+number)?|social[[:space:]./_‐‑‒–—―-]+security([[:space:]./_‐‑‒–—―-]+number)?|signature|passport([[:space:]./_‐‑‒–—―-]+number)?|driver.?s?[[:space:]./_‐‑‒–—―-]+licen[cs]e([[:space:]./_‐‑‒–—―-]+number)?|student[[:space:]./_‐‑‒–—―-]+id([[:space:]./_‐‑‒–—―-]+number)?|visa([[:space:]./_‐‑‒–—―-]+number)?|itin([[:space:]./_‐‑‒–—―-]+number)?|identification([[:space:]./_‐‑‒–—―-]+number)?|id[[:space:]./_‐‑‒–—―-]+number|ebt[[:space:]./_‐‑‒–—―-]+pin|access[[:space:]./_‐‑‒–—―-]+code|application[[:space:]./_‐‑‒–—―-]+id|account[[:space:]./_‐‑‒–—―-]+(number|no))[[:space:]]*(is[[:space:]]+|[:=#][[:space:]]*)[^[:space:]]+' then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function parent_private.ordinary_application_text_allowed(jsonb,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

alter table public.parent_snap_application_details add constraint parent_snap_ordinary_text
  check(parent_private.ordinary_application_text_allowed(details,'snap_application')) not valid;
alter table public.parent_wic_application_details add constraint parent_wic_ordinary_text
  check(parent_private.ordinary_application_text_allowed(details,'wic_application')) not valid;
alter table public.parent_peco_application_details add constraint parent_peco_ordinary_text
  check(parent_private.ordinary_application_text_allowed(details,'peco_application')) not valid;
alter table public.parent_pgw_application_details add constraint parent_pgw_ordinary_text
  check(parent_private.ordinary_application_text_allowed(details,'pgw_application')) not valid;
alter table public.parent_water_application_details add constraint parent_water_ordinary_text
  check(parent_private.ordinary_application_text_allowed(details,'water_application')) not valid;
-- Mutable profiles also need expiry/deletion maintenance to remove legacy values independently.
alter function parent_private.validate_family_profile(jsonb) rename to validate_family_profile_structure;
create function parent_private.validate_family_profile(p_details jsonb) returns void
language plpgsql set search_path='' as $$
begin
  perform parent_private.validate_family_profile_structure(p_details);
  if not parent_private.ordinary_application_text_allowed(p_details,'family_profile') then
    raise exception 'invalid family profile' using errcode='23514';
  end if;
end $$;
revoke all on function parent_private.validate_family_profile(jsonb),parent_private.validate_family_profile_structure(jsonb)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
