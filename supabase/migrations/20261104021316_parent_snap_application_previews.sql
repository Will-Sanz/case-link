alter table public.parent_snap_application_details add column confirmed_paths text[] not null default '{}';

-- Private answers remain outside ordinary packets; this binding is immutable artifact metadata.
alter table public.parent_form_artifacts
  add column snap_snapshot_id uuid references public.parent_snap_application_details(id),
  add column snap_snapshot_hash text check(snap_snapshot_hash~'^[a-f0-9]{64}$'),
  add constraint parent_snap_artifact_binding_pair check((snap_snapshot_id is null)=(snap_snapshot_hash is null));
create index parent_snap_artifact_snapshot on public.parent_form_artifacts(snap_snapshot_id) where snap_snapshot_id is not null;

create function parent_private.snap_snapshot_provenance_current(p_snapshot jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare v record; v_metadata jsonb; v_confirmed timestamptz; v_as_of timestamptz; v_count integer:=0;
  v_today text:=to_char(now() at time zone 'America/New_York','YYYY-MM-DD');
begin
  for v in select * from parent_private.snap_detail_leaves(p_snapshot->'details') loop
    if jsonb_typeof(v.value)='object' or v.path like 'household.%.id' or v.path like 'income.entries.%.id' then continue; end if;
    v_count:=v_count+1; v_metadata:=p_snapshot->'provenance'->v.path;
    v_confirmed:=parent_private.fixed_source_timestamp(v_metadata->>'confirmedAt');
    v_as_of:=parent_private.fixed_source_timestamp(v_metadata->>'asOf');
    if jsonb_typeof(v_metadata) is distinct from 'object' or v_metadata->>'source' is distinct from 'parent'
      or exists(select 1 from jsonb_object_keys(v_metadata) k where k not in ('source','confirmedAt','asOf','period'))
      or v_confirmed is null or v_as_of is null or v_as_of>v_confirmed or v_confirmed>now()
      or v_confirmed>(p_snapshot->>'created_at')::timestamptz
      or ((v.path<>'householdSize' and v.path is distinct from ('household.'||(p_snapshot#>>'{details,household,0,id}')||'.relationship'))
        and (v_as_of<now()-interval '45 days' or v_confirmed<now()-interval '45 days'))
      or (v.path like 'income.%' and v_metadata->>'period' is distinct from p_snapshot#>>'{details,income,month}') then return false; end if;
  end loop;
  if v_count<>(select count(*) from jsonb_object_keys(p_snapshot->'provenance')) then return false; end if;
  if (p_snapshot#>'{details,householdSize}' is not null and (p_snapshot#>>'{details,householdSize}')::integer<>jsonb_array_length(coalesce(p_snapshot#>'{details,household}','[]')))
    or (jsonb_array_length(coalesce(p_snapshot#>'{details,household}','[]'))>0 and upper(p_snapshot#>>'{details,household,0,relationship}') is distinct from 'SELF') then return false; end if;
  if p_snapshot#>'{details,income}' is not null and p_snapshot#>>'{details,income,month}' is distinct from left(v_today,7) then return false; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_snapshot#>'{details,income,entries}','[]')) e where e ? 'date' and
    (left(e->>'date',7)<>left(v_today,7) or (e->>'status'='received' and e->>'date'>v_today) or (e->>'status'='expected' and e->>'date'<v_today))) then return false; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_snapshot#>'{details,household}','[]')) p where p->>'dateOfBirth'>v_today)
    or exists(select 1 from jsonb_each(coalesce(p_snapshot#>'{details,history}','{}')) h where h.value->>'date'>v_today) then return false; end if;
  return true;
exception when others then return false;
end $$;

create function parent_private.snap_application_binding(p_request uuid,p_version integer,p_snapshot uuid default null,p_hash text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_request public.parent_requests; v_snapshot public.parent_snap_application_details; v_hash text; v_categories text[]:=array['household'];
begin
  select * into v_request from public.parent_requests where id=p_request;
  select * into v_snapshot from public.parent_snap_application_details where request_id=p_request order by revision desc limit 1;
  if not found then
    if p_snapshot is not null then raise exception 'SNAP preparation unavailable' using errcode='42501'; end if;
    return null;
  end if;
  if not parent_private.current_grant(p_request,p_version) or not parent_private.snap_details_collection_enabled()
    or not(v_request.intake->'needs' ? 'snap_new') or not(v_request.mandate->'recipientIds' ? 'snap-pa')
    or not(v_request.mandate->'allowedActions' ? 'prepare')
    or v_snapshot.notice_version<>'snap-application-details-2026-11-03.v1'
    or v_snapshot.source<>'{"templateId":"pa-snap-pa600fs-sg-2019","templateVersion":"2019-09-reviewed-2026-11-03","templateSha256":"21df1916ca4e05b72ebe4075d9005246cea35f755dd44a61c48772d20f0f57e0","inventoryId":"pa-snap-pa600fs-sg-2019-field-inventory","inventoryVersion":"2026-11-03.v1","inventorySha256":"5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee"}'::jsonb then raise exception 'SNAP preparation unavailable' using errcode='42501'; end if;
  perform parent_private.validate_snap_details(v_snapshot.details);
  if v_snapshot.details ?| array['income','incomeAmount','incomeFrequency','screening','expenses','expenseClaims'] then v_categories:=v_categories||'income'::text; end if;
  if not v_categories<@array(select jsonb_array_elements_text(v_request.mandate->'allowedData')) then raise exception 'SNAP preparation unavailable' using errcode='42501'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('id',v_snapshot.id,'revision',v_snapshot.revision,'details',v_snapshot.details,
    'provenance',v_snapshot.provenance,'source',v_snapshot.source,'noticeVersion',v_snapshot.notice_version,'confirmedPaths',v_snapshot.confirmed_paths)::text,'UTF8')),'hex');
  if (p_snapshot is not null and v_snapshot.id<>p_snapshot) or (p_hash is not null and v_hash<>p_hash) then raise exception 'SNAP preparation changed' using errcode='42501'; end if;
  return jsonb_build_object('snapshot',to_jsonb(v_snapshot),'snapshotHash',v_hash,'dataCategories',v_categories);
end $$;

create function parent_private.parent_get_snap_application_preparation(p_job uuid,p_token uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_binding jsonb; v_template parent_private.form_templates; v_artifact public.parent_form_artifacts;
begin
  v_job:=parent_private.require_lease(p_job,p_token,p_version);
  v_binding:=parent_private.snap_application_binding(v_job.request_id,p_version);
  if v_binding is null then return null; end if;
  select * into v_template from parent_private.form_templates where id='pa-snap-pa600fs-sg-2019-preview'
    and version='application-preview-2026-11-03.v1' and program_id='snap-pa' and needs=array['snap_new'] and active and preparation_only
    and field_map='{}'::jsonb and required_fields='{}'::text[] and personal_fields='{}'::text[] and required_acts='{}'::text[] and content_sha256=v_binding#>>'{snapshot,source,templateSha256}'
    and verified_until>now() and verified_until<='2026-12-03T05:00:00Z'::timestamptz;
  if not found then raise exception 'SNAP preview source unavailable' using errcode='42501'; end if;
  if parent_private.snap_snapshot_provenance_current(v_binding->'snapshot') then
    select * into v_artifact from public.parent_form_artifacts f where f.request_id=v_job.request_id and f.request_version=p_version
      and f.snap_snapshot_id=(v_binding#>>'{snapshot,id}')::uuid and f.snap_snapshot_hash=v_binding->>'snapshotHash'
      and f.template_id=v_template.id and f.template_version=v_template.version and f.template_hash=v_template.content_sha256
      and f.form_input_digest=encode(sha256(convert_to('{}'::jsonb::text,'UTF8')),'hex')
      and f.status='stored' and f.expires_at>now() and f.preparation_only order by f.created_at desc limit 1;
  end if;
  return v_binding||jsonb_build_object('template',to_jsonb(v_template),'artifact',case when v_artifact.id is null then null else to_jsonb(v_artifact) end);
end $$;

create function parent_private.parent_register_snap_application_preview(p_job uuid,p_token uuid,p_version integer,p_snapshot uuid,p_hash text,p_content_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_state jsonb; v_template parent_private.form_templates; v_artifact public.parent_form_artifacts; v_id uuid:=gen_random_uuid();
begin
  v_job:=parent_private.require_lease(p_job,p_token,p_version);
  v_state:=parent_private.parent_get_snap_application_preparation(p_job,p_token,p_version);
  if v_state is null or v_state#>>'{snapshot,id}' is distinct from p_snapshot::text or v_state->>'snapshotHash' is distinct from p_hash
    or not parent_private.snap_snapshot_provenance_current(v_state->'snapshot')
    or p_content_sha256 is null or p_content_sha256!~'^[a-f0-9]{64}$' then raise exception 'SNAP preview changed or unavailable' using errcode='42501'; end if;
  select * into v_template from parent_private.form_templates where id='pa-snap-pa600fs-sg-2019-preview' and version='application-preview-2026-11-03.v1';
  insert into public.parent_form_artifacts(id,request_id,request_version,need,program_id,template_id,template_version,template_hash,form_input_digest,content_sha256,object_path,expires_at,snap_snapshot_id,snap_snapshot_hash)
    values(v_id,v_job.request_id,p_version,'snap_new','snap-pa',v_template.id,v_template.version,v_template.content_sha256,
      encode(sha256(convert_to('{}'::jsonb::text,'UTF8')),'hex'),p_content_sha256,v_job.request_id::text||'/'||v_id::text||'.pdf',
      least(v_template.verified_until,now()+interval '30 days'),p_snapshot,p_hash) returning * into v_artifact;
  return to_jsonb(v_artifact);
end $$;

create function parent_private.validate_snap_preview_artifact(p_artifact public.parent_form_artifacts) returns void
language plpgsql set search_path='' as $$
declare v_binding jsonb;
begin
  v_binding:=parent_private.snap_application_binding(p_artifact.request_id,p_artifact.request_version,p_artifact.snap_snapshot_id,p_artifact.snap_snapshot_hash);
  if p_artifact.template_id<>'pa-snap-pa600fs-sg-2019-preview' or p_artifact.template_version<>'application-preview-2026-11-03.v1'
    or p_artifact.snap_snapshot_id is null or p_artifact.snap_snapshot_hash is null or not p_artifact.preparation_only
    or v_binding is null or not parent_private.snap_snapshot_provenance_current(v_binding->'snapshot')
    or not exists(select 1 from parent_private.form_templates t where t.id=p_artifact.template_id and t.version=p_artifact.template_version
      and t.program_id='snap-pa' and t.needs=array['snap_new'] and t.active and t.preparation_only and t.field_map='{}'::jsonb
      and t.required_fields='{}'::text[] and t.personal_fields='{}'::text[] and t.required_acts='{}'::text[]
      and t.content_sha256=p_artifact.template_hash and t.content_sha256=v_binding#>>'{snapshot,source,templateSha256}'
      and t.verified_until>now() and t.verified_until<='2026-12-03T05:00:00Z'::timestamptz)
    then raise exception 'SNAP preview changed or unavailable' using errcode='42501'; end if;
end $$;

create function parent_private.bind_snap_preview_artifact() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.snap_snapshot_id,new.snap_snapshot_hash) is distinct from (old.snap_snapshot_id,old.snap_snapshot_hash) then raise exception 'SNAP artifact binding is immutable' using errcode='23514'; end if;
  if new.template_id='pa-snap-pa600fs-sg-2019-preview' or new.snap_snapshot_id is not null then
    if tg_op='INSERT' or (new.status='stored' and old.status is distinct from 'stored') then perform parent_private.validate_snap_preview_artifact(new); end if;
  end if;
  return new;
end $$;
create trigger parent_snap_preview_artifact before insert or update on public.parent_form_artifacts for each row execute function parent_private.bind_snap_preview_artifact();

create function parent_private.bind_snap_preview_operation() returns trigger
language plpgsql set search_path='' as $$
declare v_artifact public.parent_form_artifacts; v_binding jsonb;
begin
  select * into v_artifact from public.parent_form_artifacts where id=new.artifact_id and snap_snapshot_id is not null;
  if found then
    if new.action<>'prepare' or new.state='executing' then raise exception 'an unsigned SNAP preview cannot be dispatched' using errcode='42501'; end if;
    if tg_op='INSERT' then
      perform parent_private.validate_snap_preview_artifact(v_artifact);
      v_binding:=parent_private.snap_application_binding(new.request_id,new.request_version,v_artifact.snap_snapshot_id,v_artifact.snap_snapshot_hash);
      if not array(select jsonb_array_elements_text(v_binding->'dataCategories'))<@new.data_categories then raise exception 'SNAP data scope is incomplete' using errcode='42501'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger parent_snap_preview_operation before insert or update of state on public.parent_operations for each row execute function parent_private.bind_snap_preview_operation();

-- The generic selector/lookup remains the packet-only path, including its existing ZIP rehearsal.
create or replace function parent_private.parent_get_form_template(p_program_id text,p_need text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when count(*)=1 then (jsonb_agg(to_jsonb(t)))->0 else null end from parent_private.form_templates t
    where t.program_id=p_program_id and t.active and t.verified_until>now() and (p_need is null or p_need=any(t.needs))
      and t.id<>'pa-snap-pa600fs-sg-2019-preview';
$$;

create or replace function parent_private.parent_get_form_artifact(p_job_id uuid,p_lease_token uuid,p_program_id text,p_need text,p_template_id text,p_template_version text,p_form_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  return (select to_jsonb(f) from public.parent_form_artifacts f join parent_private.form_templates t on t.id=f.template_id and t.version=f.template_version
    where f.request_id=v_job.request_id and f.request_version=v_job.request_version and f.need=p_need and f.program_id=p_program_id and f.template_id=p_template_id and f.template_version=p_template_version and f.form_input_digest=encode(sha256(convert_to(p_form_input::text,'UTF8')),'hex') and f.snap_snapshot_id is null and f.status='stored' and f.expires_at>now() and t.active and t.verified_until>now() and t.content_sha256=f.template_hash order by f.created_at desc limit 1);
end $$;

create or replace function parent_private.validate_form_artifact(p_request_id uuid,p_version integer,p_need text,p_program text,p_action text,p_packet jsonb,p_artifact uuid) returns void
language plpgsql set search_path='' as $$
declare v_artifact public.parent_form_artifacts; v_requires boolean;
begin
  select requires_form into v_requires from parent_private.provider_capabilities where program_id=p_program and action=p_action;
  if p_artifact is null then
    if v_requires then raise exception 'a verified form artifact is required' using errcode='42501'; end if;
    return;
  end if;
  select * into v_artifact from public.parent_form_artifacts where id=p_artifact;
  if v_artifact.snap_snapshot_id is not null then
    if p_action<>'prepare' then raise exception 'an unsigned SNAP preview cannot be dispatched' using errcode='42501'; end if;
    perform parent_private.validate_snap_preview_artifact(v_artifact);
  end if;
  if p_action not in ('research','prepare') and (v_artifact.preparation_only or exists(
    select 1 from parent_private.form_templates t where t.id=v_artifact.template_id
      and t.version=v_artifact.template_version and t.preparation_only
  )) then raise exception 'an incomplete preparation draft cannot be sent' using errcode='42501'; end if;
  if exists(select 1 from parent_private.form_templates t join parent_private.provider_capabilities c on c.program_id=p_program and c.action=p_action where t.id=v_artifact.template_id and t.version=v_artifact.template_version and not t.required_acts<@c.required_acts) then raise exception 'form personal requirements do not match the verified execution contract' using errcode='42501'; end if;
  if not found or v_artifact.request_id<>p_request_id or v_artifact.request_version<>p_version or v_artifact.need<>p_need or v_artifact.program_id<>p_program or v_artifact.status<>'stored' or v_artifact.expires_at<=now()
    or v_artifact.form_input_digest<>encode(sha256(convert_to(p_packet::text,'UTF8')),'hex')
    or not exists(select 1 from parent_private.form_templates t where t.id=v_artifact.template_id and t.version=v_artifact.template_version and t.content_sha256=v_artifact.template_hash and t.active and t.verified_until>now()) then raise exception 'form artifact no longer matches the exact operation' using errcode='42501'; end if;
end $$;

create or replace function parent_private.parent_authorize_storage(p_job_id uuid,p_lease_token uuid,p_bucket text,p_object_path text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_document public.parent_documents; v_form public.parent_form_artifacts; v_template parent_private.form_templates;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_mode is null or p_mode not in ('download','upload') or p_object_path is null or length(p_object_path) not between 1 and 300 then raise exception 'invalid storage purpose' using errcode='42501'; end if;
  if p_bucket='parent-documents' and p_mode='download' then
    select * into v_document from public.parent_documents where request_id=v_job.request_id and upload_confirmed_at is not null and object_path=p_object_path and status in ('uploaded','processing','validated') and expires_at>now() and consent_version='2026-10-25'
      and exists(select 1 from public.parent_requests r where r.id=v_job.request_id and r.mandate->'allowedData' ? 'documents' and r.mandate->'allowedActions' ?| array['research','prepare']);
    if not found then raise exception 'document purpose unavailable' using errcode='42501'; end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType',v_document.media_type,'maxBytes',v_document.size_bytes);
  elsif p_bucket='parent-form-artifacts' then
    select * into v_form from public.parent_form_artifacts where request_id=v_job.request_id and request_version=v_job.request_version and object_path=p_object_path and status in ('registered','stored') and expires_at>now();
    if not found or (p_mode='upload' and v_form.status<>'registered') then raise exception 'form purpose unavailable' using errcode='42501'; end if;
    if v_form.snap_snapshot_id is not null then perform parent_private.validate_snap_preview_artifact(v_form); end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType','application/pdf','maxBytes',10485760,'expectedSha256',v_form.content_sha256);
  elsif p_bucket='parent-known-forms' and p_mode='download' then
    select t.* into v_template from parent_private.form_templates t join public.parent_requests r on r.id=v_job.request_id
      where t.object_path=p_object_path and t.active and t.verified_until>now() and r.mandate->'recipientIds' ? t.program_id;
    if not found then raise exception 'verified template purpose unavailable' using errcode='42501'; end if;
    return jsonb_build_object('bucket',p_bucket,'objectPath',p_object_path,'mediaType','application/pdf','maxBytes',10485760,'expectedSha256',v_template.content_sha256);
  end if;
  raise exception 'unsupported storage purpose' using errcode='42501';
end $$;

revoke execute on function parent_private.snap_snapshot_provenance_current(jsonb),parent_private.snap_application_binding(uuid,integer,uuid,text),parent_private.validate_snap_preview_artifact(public.parent_form_artifacts),parent_private.bind_snap_preview_artifact(),parent_private.bind_snap_preview_operation() from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker;
revoke execute on function parent_private.parent_get_snap_application_preparation(uuid,uuid,integer),parent_private.parent_register_snap_application_preview(uuid,uuid,integer,uuid,text,text) from public,anon,authenticated,service_role,parent_storage_broker,parent_retention_worker;
grant execute on function parent_private.parent_get_snap_application_preparation(uuid,uuid,integer),parent_private.parent_register_snap_application_preview(uuid,uuid,integer,uuid,text,text) to parent_worker;

-- A parent may answer an actually stale fact again without changing its value or renewing siblings.
create function parent_private.save_snap_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_confirmed_paths text[]) returns uuid
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
  if p_idempotency_key is null or p_expected_version is null or p_confirmed_paths is null or cardinality(p_confirmed_paths)>2000 or exists(select 1 from unnest(p_confirmed_paths) x where x is null or length(x) not between 1 and 200) or cardinality(p_confirmed_paths)<>(select count(distinct x) from unnest(p_confirmed_paths) x) then raise exception 'invalid application save' using errcode='23514'; end if;
  select * into v_latest from public.parent_snap_application_details where request_id=p_request_id order by revision desc limit 1;
  select * into v_retry from public.parent_snap_application_details where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_retry.id is distinct from v_latest.id or v_retry.request_version<>v_request.version or v_retry.base_version<>p_expected_version
      or v_retry.confirmed_paths is distinct from p_confirmed_paths or v_retry.details is distinct from p_details or v_retry.notice_version is distinct from p_notice_version then raise exception 'application changed; reload' using errcode='40001'; end if;
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
  foreach v_field in array p_confirmed_paths loop
    if not(v_leaves ? v_field) or not(v_old_leaves ? v_field) or jsonb_typeof(v_leaves->v_field)='object' or v_field='householdSize'
      or v_field=('household.'||(p_details#>>'{household,0,id}')||'.relationship')
      or v_field like 'household.%.id' or v_field like 'income.entries.%.id' then raise exception 'invalid current-fact answer' using errcode='23514'; end if;
    v_metadata:=v_latest.provenance->v_field;
    v_confirmed:=parent_private.fixed_source_timestamp(v_metadata->>'confirmedAt');
    if v_metadata->>'source' is distinct from 'parent' or v_confirmed is null or v_confirmed>now() or v_confirmed>v_latest.created_at
      or parent_private.fixed_source_timestamp(v_metadata->>'asOf') is null
      or parent_private.fixed_source_timestamp(v_metadata->>'asOf')>v_confirmed
      or not(v_confirmed<now()-interval '45 days' or parent_private.fixed_source_timestamp(v_metadata->>'asOf')<now()-interval '45 days')
      then raise exception 'invalid current-fact answer' using errcode='23514'; end if;
    if v_field like 'income.%' and p_details#>>'{income,month}' is distinct from left(v_today,7) then raise exception 'invalid application dates' using errcode='23514'; end if;
  end loop;
  v_changed:=v_leaves<>v_old_leaves or cardinality(p_confirmed_paths)>0;
  v_income_changed:=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(v_leaves) where key like 'income.%') is distinct from
    (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(v_old_leaves) where key like 'income.%');
  v_income_changed:=v_income_changed or exists(select 1 from unnest(p_confirmed_paths) x where x like 'income.%');
  if v_income_changed and ((p_details#>>'{income,month}' is not null and p_details#>>'{income,month}'<>left(v_today,7)) or exists(
    select 1 from jsonb_array_elements(coalesce(p_details#>'{income,entries}','[]')) e where e ? 'date' and
    (left(e->>'date',7)<>left(v_today,7) or (e->>'status'='received' and e->>'date'>v_today) or (e->>'status'='expected' and e->>'date'<v_today)))) then raise exception 'invalid application dates' using errcode='23514'; end if;
  for v_leaf in select key path,value from jsonb_each(v_leaves) loop
    if jsonb_typeof(v_leaf.value)='object' or v_leaf.path like 'household.%.id' or v_leaf.path like 'income.entries.%.id' then continue; end if;
    if (v_old_leaves->v_leaf.path is distinct from v_leaf.value or v_leaf.path=any(p_confirmed_paths)) and
      (v_leaf.path like 'household.%.dateOfBirth' or v_leaf.path in ('history.fleeingOrProbation.date','history.welfareFraud.date')) and v_leaf.value#>>'{}'>v_today then raise exception 'invalid application dates' using errcode='23514'; end if;
    if v_old_leaves->v_leaf.path=v_leaf.value and v_latest.provenance ? v_leaf.path
      and not(v_leaf.path=any(p_confirmed_paths))
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
  insert into public.parent_snap_application_details(request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key,confirmed_paths)
    values(p_request_id,coalesce(v_latest.revision,0)+1,p_expected_version,v_new_version,p_details,v_provenance,
      '{"templateId":"pa-snap-pa600fs-sg-2019","templateVersion":"2019-09-reviewed-2026-11-03","templateSha256":"21df1916ca4e05b72ebe4075d9005246cea35f755dd44a61c48772d20f0f57e0","inventoryId":"pa-snap-pa600fs-sg-2019-field-inventory","inventoryVersion":"2026-11-03.v1","inventorySha256":"5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee"}',p_notice_version,p_idempotency_key,p_confirmed_paths) returning id into v_id;
  return v_id;
end $$;

create or replace function public.parent_save_snap_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid) returns uuid
language sql security definer set search_path='' as $$
  select parent_private.save_snap_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,array[]::text[]);
$$;
create function public.parent_reaffirm_snap_application_details(p_request_id uuid,p_expected_version integer,p_details jsonb,p_notice_version text,p_idempotency_key uuid,p_confirmed_paths text[]) returns uuid
language sql security definer set search_path='' as $$
  select parent_private.save_snap_application_details(p_request_id,p_expected_version,p_details,p_notice_version,p_idempotency_key,p_confirmed_paths);
$$;
revoke execute on function parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[]) from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker;
revoke execute on function public.parent_reaffirm_snap_application_details(uuid,integer,jsonb,text,uuid,text[]) from public,anon,service_role,parent_worker,parent_storage_broker,parent_retention_worker;
grant execute on function public.parent_reaffirm_snap_application_details(uuid,integer,jsonb,text,uuid,text[]) to authenticated;

-- Only this exact private preview may freeze an empty ordinary packet; generic validation is unchanged.
create function parent_private.parent_prepare_snap_application_preview(p_job uuid,p_token uuid,p_version integer,p_artifact uuid,p_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_artifact public.parent_form_artifacts; v_binding jsonb; v_categories text[]; v_operation public.parent_operations;
begin
  v_job:=parent_private.require_lease(p_job,p_token,p_version);
  select * into v_artifact from public.parent_form_artifacts where id=p_artifact;
  if not found or v_artifact.request_id<>v_job.request_id or v_artifact.request_version<>p_version or p_key is null or length(p_key) not between 1 and 200 then raise exception 'SNAP preparation unavailable' using errcode='42501'; end if;
  perform parent_private.validate_form_artifact(v_job.request_id,p_version,'snap_new','snap-pa','prepare','{}',p_artifact);
  if v_artifact.snap_snapshot_id is null then raise exception 'private SNAP preview required' using errcode='42501'; end if;
  v_binding:=parent_private.snap_application_binding(v_job.request_id,p_version,v_artifact.snap_snapshot_id,v_artifact.snap_snapshot_hash);
  v_categories:=array(select jsonb_array_elements_text(v_binding->'dataCategories'));
  if not parent_private.operation_allowed(v_job.request_id,p_version,'snap-pa','prepare',v_categories,array[]::uuid[],'{}','snap_new') then raise exception 'SNAP preparation unavailable' using errcode='42501'; end if;
  select * into v_operation from public.parent_operations where request_id=v_job.request_id and idempotency_key=p_key;
  if found then
    if v_operation.artifact_id is distinct from p_artifact or v_operation.request_version<>p_version or v_operation.packet<>'{}'::jsonb
      or v_operation.program_id<>'snap-pa' or v_operation.need<>'snap_new' or v_operation.action<>'prepare' or v_operation.data_categories<>v_categories then raise exception 'preparation key already used' using errcode='23514'; end if;
    return v_operation.id;
  end if;
  insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,artifact_id)
    values(v_job.request_id,p_version,'snap_new','snap-pa','prepare','{}',encode(sha256(convert_to('{}'::jsonb::text,'UTF8')),'hex'),v_categories,array[]::uuid[],p_key,p_artifact) returning id into v_operation.id;
  return v_operation.id;
end $$;
revoke execute on function parent_private.parent_prepare_snap_application_preview(uuid,uuid,integer,uuid,text) from public,anon,authenticated,service_role,parent_storage_broker,parent_retention_worker;
grant execute on function parent_private.parent_prepare_snap_application_preview(uuid,uuid,integer,uuid,text) to parent_worker;
