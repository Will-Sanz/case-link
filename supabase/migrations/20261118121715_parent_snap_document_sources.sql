-- Exact document choice only. No source, registry, processing or provider setting is activated.
create function parent_private.snap_application_source(p_template_id text) returns jsonb
language sql immutable set search_path='' as $$
  select case p_template_id
    when 'pa-snap-pa600fs-sg-2019' then '{"templateId":"pa-snap-pa600fs-sg-2019","templateVersion":"2019-09-reviewed-2026-11-03","templateSha256":"21df1916ca4e05b72ebe4075d9005246cea35f755dd44a61c48772d20f0f57e0","inventoryId":"pa-snap-pa600fs-sg-2019-field-inventory","inventoryVersion":"2026-11-03.v1","inventorySha256":"5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee"}'::jsonb
    when 'pa-snap-pa600fs-sg-2019-es' then '{"templateId":"pa-snap-pa600fs-sg-2019-es","templateVersion":"2019-09-offline-2026-11-18.v1","templateSha256":"7c75e5509799c30841de6c553ba2c3ad0f11896dbfb6d198d33952c5151a400b","inventoryId":"pa-snap-pa600fs-sg-2019-es-rendering-map","inventoryVersion":"2026-11-18.v1","inventorySha256":"ec5123d2b21c5ed5309bf7215fae1d72b87f0240edf5d275affe0433bac2a6dc"}'::jsonb end;
$$;
create function parent_private.selected_snap_application_source(p_previous jsonb default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare choice text:=nullif(current_setting('caselink.snap_document_template',true),''); source jsonb;
begin
  source:=case when choice is not null then parent_private.snap_application_source(choice)
    when p_previous is not null then p_previous else parent_private.snap_application_source('pa-snap-pa600fs-sg-2019') end;
  if source is null or source is distinct from parent_private.snap_application_source(source->>'templateId')
    then raise exception 'invalid SNAP document source' using errcode='23514'; end if;
  return source;
end $$;
create function parent_private.snap_preview_source(p_source jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select case when p_source=parent_private.snap_application_source('pa-snap-pa600fs-sg-2019') then
    '{"id":"pa-snap-pa600fs-sg-2019-preview","version":"application-preview-2026-11-03.v1"}'::jsonb
    when p_source=parent_private.snap_application_source('pa-snap-pa600fs-sg-2019-es') then
    '{"id":"pa-snap-pa600fs-sg-2019-es-preview","version":"application-preview-2026-11-18.v1"}'::jsonb end;
$$;
revoke all on function parent_private.snap_application_source(text),parent_private.selected_snap_application_source(jsonb),parent_private.snap_preview_source(jsonb)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer;

-- Spanish completion needs its own exact-source/method evidence; the prior English route is unchanged.
alter table parent_private.provider_capabilities
  add column snap_spanish_completion_validator_version text,
  add column snap_spanish_completion_evidence_reference text,
  add column snap_spanish_completion_verified_until timestamptz,
  add constraint parent_snap_spanish_completion_evidence check(
    (snap_spanish_completion_validator_version is null and snap_spanish_completion_evidence_reference is null and snap_spanish_completion_verified_until is null)
    or (program_id='snap-pa' and action='submit' and snap_spanish_completion_validator_version is not null
      and snap_spanish_completion_validator_version in ('pa600fs-final-content-2026-11-04.v1','pa600fs-direct-completion-2026-11-05.v1')
      and snap_spanish_completion_evidence_reference is not null and length(btrim(snap_spanish_completion_evidence_reference)) between 1 and 2000
      and snap_spanish_completion_verified_until is not null and isfinite(snap_spanish_completion_verified_until)
      and snap_spanish_completion_verified_until<='2026-12-03T05:00:00Z'::timestamptz));
create function parent_private.snap_protected_source_verified(p_source jsonb,p_validator text) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(parent_private.snap_protected_route_verified(p_validator) and
    (p_source=parent_private.snap_application_source('pa-snap-pa600fs-sg-2019')
      or (p_source=parent_private.snap_application_source('pa-snap-pa600fs-sg-2019-es') and clock_timestamp()>='2026-11-18T00:00:00Z'::timestamptz
        and clock_timestamp()<'2026-12-03T05:00:00Z'::timestamptz and exists(select 1 from parent_private.provider_capabilities c
          where c.program_id='snap-pa' and c.action='submit' and c.snap_spanish_completion_validator_version=p_validator
            and length(btrim(c.snap_spanish_completion_evidence_reference)) between 1 and 2000
            and c.snap_spanish_completion_verified_until>clock_timestamp()))),false);
$$;
revoke all on function parent_private.snap_protected_source_verified(jsonb,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer;

create function parent_private.snap_protected_source_until(p_source jsonb) returns timestamptz
language sql stable set search_path='' as $$
  select case when p_source=parent_private.snap_application_source('pa-snap-pa600fs-sg-2019') then '2026-12-03T05:00:00Z'::timestamptz
    when p_source=parent_private.snap_application_source('pa-snap-pa600fs-sg-2019-es') then
      (select least(c.snap_spanish_completion_verified_until,c.verified_until,'2026-12-03T05:00:00Z'::timestamptz)
        from parent_private.provider_capabilities c where c.program_id='snap-pa' and c.action='submit') end;
$$;
revoke all on function parent_private.snap_protected_source_until(jsonb)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer;

-- Guarded edits preserve function identities, ACLs, current purpose checks and historical English behavior.
do $migration$
declare target record; definition text;
begin
  for target in select * from (values
    ('parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[])', $old$v_id uuid; v_provenance jsonb$old$, $new$v_source jsonb; v_id uuid; v_provenance jsonb$new$),
    ('parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[])', $old$  select * into v_retry from public.parent_snap_application_details$old$, $new$  v_source:=parent_private.selected_snap_application_source(v_latest.source);
  select * into v_retry from public.parent_snap_application_details$new$),
    ('parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[])', $old$or v_retry.confirmed_paths is distinct from p_confirmed_paths$old$, $new$or v_retry.source is distinct from v_source or v_retry.confirmed_paths is distinct from p_confirmed_paths$new$),
    ('parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[])', $old$v_changed:=v_leaves<>v_old_leaves or cardinality(p_confirmed_paths)>0;$old$, $new$v_changed:=v_leaves<>v_old_leaves or cardinality(p_confirmed_paths)>0 or (v_latest.id is not null and v_latest.source is distinct from v_source);$new$),
    ('parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[])', $old$'{"templateId":"pa-snap-pa600fs-sg-2019","templateVersion":"2019-09-reviewed-2026-11-03","templateSha256":"21df1916ca4e05b72ebe4075d9005246cea35f755dd44a61c48772d20f0f57e0","inventoryId":"pa-snap-pa600fs-sg-2019-field-inventory","inventoryVersion":"2026-11-03.v1","inventorySha256":"5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee"}',p_notice_version$old$, $new$v_source,p_notice_version$new$),
    ('public.parent_start_snap_application(jsonb,jsonb,jsonb,text,uuid)', $old$or v_request.intake is distinct from p_intake$old$, $new$or v_snapshot.source is distinct from parent_private.selected_snap_application_source() or v_request.intake is distinct from p_intake$new$),
    ('public.parent_start_application_with_family_profile(text,jsonb,jsonb,jsonb,text,uuid,jsonb,boolean,boolean,uuid,integer)', $old$p_source_version)::text,'UTF8')),'hex');$old$, $new$p_source_version)::text,'UTF8')),'hex');
  if p_kind='snap_application' and nullif(current_setting('caselink.snap_document_template',true),'') is not null then
    write_hash:=encode(sha256(convert_to(jsonb_build_array(write_hash,parent_private.selected_snap_application_source())::text,'UTF8')),'hex');
  end if;$new$),
    ('public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[])', $old$p_confirmed_paths)::text,'UTF8')),'hex');$old$, $new$p_confirmed_paths)::text,'UTF8')),'hex');
  if p_kind='snap_application' and nullif(current_setting('caselink.snap_document_template',true),'') is not null then
    write_hash:=encode(sha256(convert_to(jsonb_build_array(write_hash,parent_private.selected_snap_application_source())::text,'UTF8')),'hex');
  end if;$new$),
    ('parent_private.snap_application_binding(uuid,integer,uuid,text)', $old$v_snapshot.source<>'{"templateId":"pa-snap-pa600fs-sg-2019","templateVersion":"2019-09-reviewed-2026-11-03","templateSha256":"21df1916ca4e05b72ebe4075d9005246cea35f755dd44a61c48772d20f0f57e0","inventoryId":"pa-snap-pa600fs-sg-2019-field-inventory","inventoryVersion":"2026-11-03.v1","inventorySha256":"5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee"}'::jsonb$old$, $new$v_snapshot.source is distinct from parent_private.snap_application_source(v_snapshot.source->>'templateId')
    or (v_snapshot.source->>'templateId'='pa-snap-pa600fs-sg-2019-es' and now()<'2026-11-18T00:00:00Z'::timestamptz)$new$),
    ('parent_private.parent_get_snap_application_preparation(uuid,uuid,integer)', $old$id='pa-snap-pa600fs-sg-2019-preview'
    and version='application-preview-2026-11-03.v1'$old$, $new$id=parent_private.snap_preview_source(v_binding#>'{snapshot,source}')->>'id'
    and version=parent_private.snap_preview_source(v_binding#>'{snapshot,source}')->>'version'$new$),
    ('parent_private.parent_register_snap_application_preview(uuid,uuid,integer,uuid,text,text)', $old$select * into v_template from parent_private.form_templates where id='pa-snap-pa600fs-sg-2019-preview' and version='application-preview-2026-11-03.v1';$old$, $new$select * into v_template from jsonb_populate_record(null::parent_private.form_templates,v_state->'template');$new$),
    ('parent_private.validate_snap_preview_artifact(public.parent_form_artifacts)', $old$p_artifact.template_id<>'pa-snap-pa600fs-sg-2019-preview' or p_artifact.template_version<>'application-preview-2026-11-03.v1'$old$, $new$p_artifact.template_id is distinct from (parent_private.snap_preview_source(v_binding#>'{snapshot,source}')->>'id')
    or p_artifact.template_version is distinct from (parent_private.snap_preview_source(v_binding#>'{snapshot,source}')->>'version')$new$),
    ('parent_private.bind_snap_preview_artifact()', $old$new.template_id='pa-snap-pa600fs-sg-2019-preview'$old$, $new$new.template_id in ('pa-snap-pa600fs-sg-2019-preview','pa-snap-pa600fs-sg-2019-es-preview')$new$),
    ('parent_private.parent_get_form_template(text,text)', $old$t.id<>'pa-snap-pa600fs-sg-2019-preview'$old$, $new$t.id not in ('pa-snap-pa600fs-sg-2019-preview','pa-snap-pa600fs-sg-2019-es-preview')$new$),
    ('parent_private.mixed_food_snap_planning_ready(public.parent_requests)', $old$t.id='pa-snap-pa600fs-sg-2019-preview'
      and t.version='application-preview-2026-11-03.v1'$old$, $new$t.id=parent_private.snap_preview_source(binding#>'{snapshot,source}')->>'id'
      and t.version=parent_private.snap_preview_source(binding#>'{snapshot,source}')->>'version'$new$),
    ('parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text)', $old$  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects$old$, $new$  if not parent_private.snap_protected_source_verified(b#>'{snapshot,source}','pa600fs-direct-completion-2026-11-05.v1')
    then raise exception 'protected SNAP source method unavailable' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects$new$),
    ('parent_private.snap_final_packet_authority(uuid,uuid,integer,uuid,text)', $old$  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects$old$, $new$  if not parent_private.snap_protected_source_verified(b#>'{snapshot,source}',case when a.acquisition_authorization_id is null then 'pa600fs-final-content-2026-11-04.v1' else 'pa600fs-direct-completion-2026-11-05.v1' end)
    then raise exception 'protected SNAP source method unavailable' using errcode='42501'; end if;
  select array_agg((person->>'id')::uuid order by (person->>'id')::uuid) into subjects$new$),
    ('parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text)', $old$(r.mandate->>'expiresAt')::timestamptz,'2026-12-03T05:00:00Z'::timestamptz,$old$, $new$(r.mandate->>'expiresAt')::timestamptz,parent_private.snap_protected_source_until(b#>'{snapshot,source}'),$new$),
    ('public.parent_authorize_snap_final_packet(uuid,integer,uuid,text,uuid,text,integer,text,text,uuid[],boolean)', $old$(r.mandate->>'expiresAt')::timestamptz,'2026-12-03T05:00:00Z'::timestamptz,$old$, $new$(r.mandate->>'expiresAt')::timestamptz,parent_private.snap_protected_source_until(b#>'{snapshot,source}'),$new$),
    ('parent_private.snap_final_packet_authority(uuid,uuid,integer,uuid,text)', $old$  return b||jsonb_build_object('authorization',to_jsonb(a)$old$, $new$  if a.expires_at>parent_private.snap_protected_source_until(b#>'{snapshot,source}') then raise exception 'protected SNAP source expiry changed' using errcode='42501'; end if;
  return b||jsonb_build_object('authorization',to_jsonb(a)$new$)) changes(signature,old_text,new_text) loop
    select pg_get_functiondef(target.signature::regprocedure) into definition;
    if (length(definition)-length(replace(definition,target.old_text,'')))/length(target.old_text)<>1
      then raise exception 'SNAP source migration anchor changed: %',target.signature; end if;
    execute replace(definition,target.old_text,target.new_text);
  end loop;
end $migration$;

-- Transaction-local selection carries only a fixed source choice across the existing atomic profile write.
-- It is never permission, evidence or a caller-provided filename/tuple, and is restored on success and failure.
create function public.parent_start_snap_application_source(p_intake jsonb,p_mandate jsonb,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_template_id text,
  p_family_profile_source jsonb default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous text:=current_setting('caselink.snap_document_template',true); result uuid;
begin
  if parent_private.snap_application_source(p_template_id) is null
    then raise exception 'invalid SNAP document source' using errcode='23514'; end if;
  perform set_config('caselink.snap_document_template',p_template_id,true);
  if p_family_profile_source is not null then
    result:=public.parent_start_application_with_family_profile('snap_application',p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key,p_family_profile_source);
  else result:=public.parent_start_snap_application(p_intake,p_mandate,p_details,p_notice_version,p_idempotency_key); end if;
  perform set_config('caselink.snap_document_template',coalesce(previous,''),true);
  return result;
exception when others then perform set_config('caselink.snap_document_template',coalesce(previous,''),true); raise;
end $$;
create function public.parent_save_snap_application_source(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_template_id text,
  p_family_profile_source jsonb default null,p_confirmed_paths text[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare previous text:=current_setting('caselink.snap_document_template',true); result uuid;
begin
  if parent_private.snap_application_source(p_template_id) is null then raise exception 'invalid SNAP document source' using errcode='23514'; end if;
  perform set_config('caselink.snap_document_template',p_template_id,true);
  result:=public.parent_save_application_with_family_profile('snap_application',p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_family_profile_source,false,false,p_confirmed_paths);
  perform set_config('caselink.snap_document_template',coalesce(previous,''),true);
  return result;
exception when others then perform set_config('caselink.snap_document_template',coalesce(previous,''),true); raise;
end $$;
revoke all on function public.parent_start_snap_application_source(jsonb,jsonb,jsonb,text,uuid,text,jsonb),public.parent_save_snap_application_source(uuid,integer,jsonb,text,uuid,text,jsonb,text[])
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer;
grant execute on function public.parent_start_snap_application_source(jsonb,jsonb,jsonb,text,uuid,text,jsonb),public.parent_save_snap_application_source(uuid,integer,jsonb,text,uuid,text,jsonb,text[])
  to authenticated;
