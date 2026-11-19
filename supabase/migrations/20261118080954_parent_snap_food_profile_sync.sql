-- Reuse corrected family facts for the supported SNAP plus immediate-food composition.
-- Keep WIC scope, fixed source dates, ownership, current authority and conflict recovery unchanged.
create or replace function parent_private.refresh_food_profile_applications() returns trigger
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
    kind:=case when request.intake->'needs' @> '["snap_new"]'::jsonb
      and request.intake->'needs' <@ '["food_now","snap_new"]'::jsonb then 'snap_application'
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
    exception when check_violation or insufficient_privilege or serialization_failure or sqlstate 'PT409' or raise_exception then
      -- Incompatible or unavailable routes keep their invalidated work stopped; the profile correction is still useful elsewhere.
      null;
    end;
  end loop;
  return null;
end $$;
