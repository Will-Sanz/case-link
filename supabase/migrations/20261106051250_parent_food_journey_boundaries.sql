-- Close unreleased food operations and private WIC intake without changing stored records or grants.
begin;

create or replace function parent_private.validate_intake(p_intake jsonb) returns void
language plpgsql set search_path='' as $$
declare v_needs text[];
begin
  if p_intake is null or jsonb_typeof(p_intake)<>'object' or pg_column_size(p_intake)>12000
    or p_intake->'adultConfirmed' is distinct from 'true'::jsonb
    or coalesce(p_intake->>'zip','')!~'^\d{5}$'
    or coalesce(p_intake->>'urgency','') not in ('today','soon','planning')
    or coalesce(p_intake->>'language','') not in ('en','es')
    or coalesce(p_intake->>'incomeFrequency','') not in ('weekly','biweekly','twice_monthly','monthly','yearly','unknown')
    or coalesce(p_intake->>'accountAuthority','') not in ('self','authorized_caregiver','not_sure')
    or coalesce(p_intake->>'contactPreference','') not in ('in_app','email')
    or jsonb_typeof(p_intake->'needs') is distinct from 'array' then
    raise exception 'invalid parent intake' using errcode='23514';
  end if;
  select array_agg(v) into v_needs from jsonb_array_elements_text(p_intake->'needs') v;
  if coalesce(cardinality(v_needs),0) not between 1 and 10 or not v_needs<@array['food_now','snap_new','snap_renewal','snap_pending','snap_problem','wic_new','wic_continuing','electricity','gas','water']
    or cardinality(v_needs)<>(select count(distinct v) from unnest(v_needs) v)
    or (select count(*) from jsonb_object_keys(p_intake))<>14 then
    raise exception 'invalid intake needs or fields' using errcode='23514';
  end if;
  if not (p_intake ?& array['needs','urgency','zip','language','householdSize','childrenUnderFive','pregnantOrPostpartum','incomeAmount','incomeFrequency','utilityProviders','shutoffDate','accountAuthority','contactPreference','adultConfirmed']) then
    raise exception 'missing intake fields' using errcode='23514';
  end if;
  if p_intake->'householdSize'<>'null'::jsonb and (jsonb_typeof(p_intake->'householdSize')<>'number' or (p_intake->>'householdSize')::numeric not between 1 and 30 or (p_intake->>'householdSize')::numeric<>trunc((p_intake->>'householdSize')::numeric)) then raise exception 'invalid household size' using errcode='23514'; end if;
  if p_intake->'incomeAmount'<>'null'::jsonb and (jsonb_typeof(p_intake->'incomeAmount')<>'number' or (p_intake->>'incomeAmount')::numeric not between 0 and 1000000 or p_intake->>'incomeFrequency'='unknown') then raise exception 'invalid income' using errcode='23514'; end if;
  if jsonb_typeof(p_intake->'utilityProviders')<>'array' or jsonb_array_length(p_intake->'utilityProviders')>5 or exists(select 1 from jsonb_array_elements_text(p_intake->'utilityProviders') v where v not in ('peco','pgw','pwd','other','unknown')) then raise exception 'invalid utility providers' using errcode='23514'; end if;
  -- Private WIC questions stay closed until their assessment and permission are approved.
  if p_intake->'childrenUnderFive'<>'null'::jsonb or p_intake->'pregnantOrPostpartum'<>'null'::jsonb then raise exception 'private WIC household collection unavailable' using errcode='23514'; end if;
  if p_intake->'childrenUnderFive' not in ('null'::jsonb,'true'::jsonb,'false'::jsonb) or p_intake->'pregnantOrPostpartum' not in ('null'::jsonb,'true'::jsonb,'false'::jsonb) then raise exception 'invalid household facts' using errcode='23514'; end if;
  if p_intake->'shutoffDate'<>'null'::jsonb and (select count(*) from unnest(v_needs) n where n in ('electricity','gas','water'))>1 then raise exception 'combined utility dates need account-specific facts' using errcode='23514'; end if;
  if p_intake->'shutoffDate'<>'null'::jsonb and ((p_intake->>'shutoffDate')!~'^\d{4}-\d{2}-\d{2}$' or to_char((p_intake->>'shutoffDate')::date,'YYYY-MM-DD')<>p_intake->>'shutoffDate') then raise exception 'invalid shutoff date' using errcode='23514'; end if;
end $$;

create or replace function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;
begin
  -- A new-application program capability does not verify a different benefit journey.
  if p_need in ('snap_renewal','snap_pending','snap_problem','wic_new','wic_continuing') and p_action in ('submit','share','schedule') then return false; end if;
  if not(p_packet ? 'protectedSnapPacket') then
    return parent_private.ordinary_operation_allowed(p_request,p_version,p_program,p_action,p_data,p_documents,p_packet,p_need);
  end if;
  if p_need is distinct from 'snap_new' or p_program is distinct from 'snap-pa' or p_action is distinct from 'submit'
    or p_documents is null or cardinality(p_documents)<>0 then return false; end if;
  context:=parent_private.snap_protected_operation_context(p_request,p_version,p_packet);
  return p_data is not distinct from array(select jsonb_array_elements_text(context->'dataCategories'));
exception when others then return false;
end $$;

commit;
