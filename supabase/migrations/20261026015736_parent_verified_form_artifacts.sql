-- Known form contracts are operator verified; generated artifacts remain immutable and private.
create table parent_private.form_templates (
  id text not null check(id~'^[a-z0-9-]{1,80}$'),
  version text not null check(length(version) between 1 and 80),
  program_id text not null,
  needs text[] not null,
  content_sha256 text not null check(content_sha256~'^[a-f0-9]{64}$'),
  object_path text not null check(length(object_path) between 1 and 300 and object_path!~'(^/|\.\.)'),
  field_map jsonb not null check(jsonb_typeof(field_map)='object'),
  required_acts text[] not null,
  source_url text not null check(source_url~'^https://'),
  verified_until timestamptz not null,
  active boolean not null default false,
  primary key(id,version)
);
alter table parent_private.form_templates enable row level security;
revoke all on parent_private.form_templates from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
create table public.parent_form_artifacts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  request_version integer not null,
  need text not null,
  program_id text not null,
  template_id text not null,
  template_version text not null,
  template_hash text not null,
  form_input_digest text not null,
  content_sha256 text not null check(content_sha256~'^[a-f0-9]{64}$'),
  object_path text not null unique,
  status text not null default 'registered' check(status in ('registered','stored','deleted')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(template_id,template_version) references parent_private.form_templates(id,version)
);
alter table public.parent_form_artifacts enable row level security;
revoke all on public.parent_form_artifacts from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
grant select on public.parent_form_artifacts to authenticated;
create policy parent_form_artifact_read on public.parent_form_artifacts for select to authenticated using(parent_private.owns_request(request_id));
alter table public.parent_operations add column artifact_id uuid references public.parent_form_artifacts(id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('parent-form-artifacts','parent-form-artifacts',false,10485760,array['application/pdf']) on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('parent-known-forms','parent-known-forms',false,10485760,array['application/pdf']) on conflict(id) do nothing;
create policy parent_form_storage_read on storage.objects for select to authenticated using(bucket_id='parent-form-artifacts' and exists(select 1 from public.parent_form_artifacts a where a.object_path=name and a.status='stored' and parent_private.owns_request(a.request_id)));

create function parent_private.parent_get_form_template(p_program_id text,p_need text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when count(*)=1 then (jsonb_agg(to_jsonb(t)))->0 else null end from parent_private.form_templates t
    where t.program_id=p_program_id and t.active and t.verified_until>now() and (p_need is null or p_need=any(t.needs));
$$;
create function parent_private.parent_register_form_artifact(p_job_id uuid,p_lease_token uuid,p_program_id text,p_template_id text,p_template_version text,p_form_input jsonb,p_content_sha256 text,p_need text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_template parent_private.form_templates; v_id uuid:=gen_random_uuid(); v_artifact public.parent_form_artifacts; v_need text; v_compatible text[];
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select * into v_template from parent_private.form_templates where id=p_template_id and version=p_template_version and program_id=p_program_id and active and verified_until>now();
  if not found or p_content_sha256 is null or p_content_sha256!~'^[a-f0-9]{64}$' or p_form_input is null or jsonb_typeof(p_form_input)<>'object' or pg_column_size(p_form_input)>50000 then raise exception 'verified form and input required' using errcode='42501'; end if;
  select array_agg(n) into v_compatible from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n where r.id=v_job.request_id and n=any(v_template.needs) and parent_private.program_supports_need(p_program_id,n);
  v_need:=coalesce(p_need,case when cardinality(v_compatible)=1 then v_compatible[1] else null end);
  if v_need is null or not v_need=any(v_compatible) or exists(select 1 from jsonb_object_keys(p_form_input) k where not exists(select 1 from jsonb_each_text(v_template.field_map) m(field,input_key) where m.input_key=k)) then raise exception 'form input does not match its verified purpose and mapping' using errcode='42501'; end if;
  perform parent_private.validate_packet(p_form_input,(select array_agg(v) from public.parent_requests r cross join lateral jsonb_array_elements_text(r.mandate->'allowedData') v where r.id=v_job.request_id),array(select v::uuid from jsonb_array_elements_text(coalesce(p_form_input->'documentIds','[]')) v),'prepare');
  insert into public.parent_form_artifacts(id,request_id,request_version,need,program_id,template_id,template_version,template_hash,form_input_digest,content_sha256,object_path,expires_at)
    values(v_id,v_job.request_id,v_job.request_version,v_need,p_program_id,p_template_id,p_template_version,v_template.content_sha256,encode(sha256(convert_to(p_form_input::text,'UTF8')),'hex'),p_content_sha256,v_job.request_id::text||'/'||v_id::text||'.pdf',least(v_template.verified_until,now()+interval '30 days')) returning * into v_artifact;
  return to_jsonb(v_artifact);
end $$;
create function parent_private.parent_confirm_form_artifact(p_job_id uuid,p_lease_token uuid,p_artifact_id uuid,p_actual_sha256 text) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_artifact public.parent_form_artifacts;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select * into v_artifact from public.parent_form_artifacts where id=p_artifact_id for update;
  if v_artifact.request_id is distinct from v_job.request_id or v_artifact.request_version<>v_job.request_version or v_artifact.status<>'registered'
    or v_artifact.expires_at<=now() or v_artifact.content_sha256 is distinct from p_actual_sha256
    or not exists(select 1 from storage.objects where bucket_id='parent-form-artifacts' and name=v_artifact.object_path) then raise exception 'stored form bytes do not match the registered artifact' using errcode='42501'; end if;
  update public.parent_form_artifacts set status='stored' where id=p_artifact_id;
end $$;
create function parent_private.validate_form_artifact(p_request_id uuid,p_version integer,p_need text,p_program text,p_action text,p_packet jsonb,p_artifact uuid) returns void
language plpgsql set search_path='' as $$
declare v_artifact public.parent_form_artifacts; v_requires boolean;
begin
  select requires_form into v_requires from parent_private.provider_capabilities where program_id=p_program and action=p_action;
  if p_artifact is null then
    if v_requires then raise exception 'a verified form artifact is required' using errcode='42501'; end if;
    return;
  end if;
  select * into v_artifact from public.parent_form_artifacts where id=p_artifact;
  if exists(select 1 from parent_private.form_templates t join parent_private.provider_capabilities c on c.program_id=p_program and c.action=p_action where t.id=v_artifact.template_id and t.version=v_artifact.template_version and not t.required_acts<@c.required_acts) then raise exception 'form personal requirements do not match the verified execution contract' using errcode='42501'; end if;
  if not found or v_artifact.request_id<>p_request_id or v_artifact.request_version<>p_version or v_artifact.need<>p_need or v_artifact.program_id<>p_program or v_artifact.status<>'stored' or v_artifact.expires_at<=now()
    or v_artifact.form_input_digest<>encode(sha256(convert_to(p_packet::text,'UTF8')),'hex')
    or not exists(select 1 from parent_private.form_templates t where t.id=v_artifact.template_id and t.version=v_artifact.template_version and t.content_sha256=v_artifact.template_hash and t.active and t.verified_until>now()) then raise exception 'form artifact no longer matches the exact operation' using errcode='42501'; end if;
end $$;
create function parent_private.immutable_form_artifact() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.request_id,new.request_version,new.need,new.program_id,new.template_id,new.template_version,new.template_hash,new.form_input_digest,new.content_sha256,new.object_path,new.expires_at,new.created_at)
    is distinct from (old.id,old.request_id,old.request_version,old.need,old.program_id,old.template_id,old.template_version,old.template_hash,old.form_input_digest,old.content_sha256,old.object_path,old.expires_at,old.created_at) then raise exception 'form artifacts are immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger parent_form_immutable before update on public.parent_form_artifacts for each row execute function parent_private.immutable_form_artifact();

drop function parent_private.parent_prepare_operation(uuid,uuid,integer,text,text,jsonb,text[],uuid[],text,text);
create function parent_private.parent_prepare_operation(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_program_id text,p_action text,p_packet jsonb,p_data_categories text[],p_document_ids uuid[],p_idempotency_key text,p_need text default null,p_artifact_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations; v_hash text; v_permission text; v_need text; v_compatible text[];
begin
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,p_expected_version);
  select array_agg(n) into v_compatible from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n where r.id=v_job.request_id and parent_private.program_supports_need(p_program_id,n);
  v_need:=coalesce(p_need,case when cardinality(v_compatible)=1 then v_compatible[1] else null end);
  if v_need is null or not v_need=any(v_compatible) then raise exception 'one exact requested need must be bound to the operation' using errcode='23514'; end if;
  perform parent_private.validate_form_artifact(v_job.request_id,p_expected_version,v_need,p_program_id,p_action,p_packet,p_artifact_id);
  perform parent_private.validate_packet(p_packet,p_data_categories,p_document_ids,p_action);
  if p_packet ? 'statusReference' and not exists(select 1 from public.parent_operations o where o.request_id=v_job.request_id and o.program_id=p_program_id and o.need=v_need and o.state in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received') and o.evidence->>'reference'=p_packet->>'statusReference' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) then raise exception 'status reference is not a verified receipt for this request and program' using errcode='42501'; end if;
  if jsonb_typeof(p_packet)<>'object' or pg_column_size(p_packet)>100000 or p_data_categories is null or p_document_ids is null or not parent_private.operation_allowed(v_job.request_id,p_expected_version,p_program_id,p_action,p_data_categories,p_document_ids,p_packet,v_need) then raise exception 'operation outside current authority' using errcode='42501'; end if;
  v_hash:=encode(sha256(convert_to(p_packet::text,'UTF8')),'hex');
  select * into v_operation from public.parent_operations where request_id=v_job.request_id and idempotency_key=p_idempotency_key;
  if found then
    if v_operation.artifact_id is distinct from p_artifact_id or v_operation.packet_hash<>v_hash or v_operation.need<>v_need or v_operation.program_id<>p_program_id or v_operation.action<>p_action or v_operation.request_version<>p_expected_version or v_operation.data_categories<>p_data_categories or v_operation.document_ids<>p_document_ids then raise exception 'idempotency key already binds another operation' using errcode='23514'; end if;
    return v_operation.id;
  end if;
  select permission_version into v_permission from parent_private.provider_capabilities where program_id=p_program_id and action=p_action;
  insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,permission_version,artifact_id)
    values(v_job.request_id,p_expected_version,v_need,p_program_id,p_action,p_packet,v_hash,p_data_categories,p_document_ids,p_idempotency_key,v_permission,p_artifact_id) returning id into v_operation.id;
  return v_operation.id;
end $$;

create or replace function parent_private.parent_begin_operation(p_operation_id uuid,p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations; v_request public.parent_requests; v_permission text;
begin
  select * into v_operation from public.parent_operations where id=p_operation_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_operation.request_version);
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  select * into v_request from public.parent_requests where id=v_job.request_id for update;
  if v_operation.request_id<>v_job.request_id or v_operation.state<>'prepared' or not parent_private.operation_allowed(v_job.request_id,v_operation.request_version,v_operation.program_id,v_operation.action,v_operation.data_categories,v_operation.document_ids,v_operation.packet,v_operation.need) then raise exception 'operation no longer executable' using errcode='42501'; end if;
  perform parent_private.validate_form_artifact(v_operation.request_id,v_operation.request_version,v_operation.need,v_operation.program_id,v_operation.action,v_operation.packet,v_operation.artifact_id);
  if v_operation.action not in ('research','prepare') then
    select permission_version into v_permission from parent_private.provider_capabilities where program_id=v_operation.program_id and action=v_operation.action;
    if v_permission is distinct from v_operation.permission_version then raise exception 'provider permission changed' using errcode='42501'; end if;
    if exists(select 1 from parent_private.provider_capabilities c cross join lateral unnest(c.required_acts) act where c.program_id=v_operation.program_id and c.action=v_operation.action and not exists(select 1 from parent_private.personal_act_evidence e where e.operation_id=v_operation.id and e.act=act and e.packet_hash=v_operation.packet_hash and e.expires_at>now())) then raise exception 'required personal act has not been verified for this packet' using errcode='42501'; end if;
    if (select count(*) from public.parent_operations where request_id=v_job.request_id and action not in ('research','prepare') and executed_at is not null)>=(v_request.mandate->>'maxAttempts')::integer then raise exception 'service attempt limit reached' using errcode='23514'; end if;
    if exists(select 1 from public.parent_operations where request_id=v_job.request_id and need=v_operation.need and action not in ('research','prepare') and state='delivery_unknown') then raise exception 'unknown delivery requires reconciliation' using errcode='23514'; end if;
  end if;
  update public.parent_operations set state='executing',executed_at=now(),updated_at=now() where id=p_operation_id;
  insert into parent_private.receipt_authority(operation_id,job_id,lease_token,packet_hash,valid_until) values(p_operation_id,p_job_id,p_lease_token,v_operation.packet_hash,now()+interval '10 minutes');
  return jsonb_build_object('operationId',v_operation.id,'packet',v_operation.packet,'packetHash',v_operation.packet_hash,'idempotencyKey',v_operation.idempotency_key,'programId',v_operation.program_id,'need',v_operation.need,'action',v_operation.action,'permissionVersion',v_permission,'artifact',(select to_jsonb(a) from public.parent_form_artifacts a where a.id=v_operation.artifact_id));
end $$;

create or replace function parent_private.immutable_operation_packet() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.request_id,new.request_version,new.need,new.artifact_id,new.program_id,new.action,new.packet,new.packet_hash,new.data_categories,new.document_ids,new.idempotency_key,new.permission_version,new.created_at)
    is distinct from (old.request_id,old.request_version,old.need,old.artifact_id,old.program_id,old.action,old.packet,old.packet_hash,old.data_categories,old.document_ids,old.idempotency_key,old.permission_version,old.created_at) then raise exception 'attempted packet is immutable' using errcode='23514'; end if;
  return new;
end $$;

revoke execute on function parent_private.parent_get_form_template(text,text),parent_private.parent_register_form_artifact(uuid,uuid,text,text,text,jsonb,text,text),parent_private.parent_confirm_form_artifact(uuid,uuid,uuid,text),parent_private.validate_form_artifact(uuid,integer,text,text,text,jsonb,uuid),parent_private.immutable_form_artifact(),parent_private.parent_prepare_operation(uuid,uuid,integer,text,text,jsonb,text[],uuid[],text,text,uuid) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
grant execute on function parent_private.parent_get_form_template(text,text),parent_private.parent_register_form_artifact(uuid,uuid,text,text,text,jsonb,text,text),parent_private.parent_confirm_form_artifact(uuid,uuid,uuid,text),parent_private.parent_prepare_operation(uuid,uuid,integer,text,text,jsonb,text[],uuid[],text,text,uuid) to parent_worker;

alter table parent_private.cleanup_batches add column artifact_ids uuid[] not null default '{}';
create or replace function parent_private.parent_claim_cleanup(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_artifacts uuid[]; v_docs uuid[]; v_accounts uuid[]; v_requests uuid[]; v_batch parent_private.cleanup_batches; v_request uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid cleanup batch limit' using errcode='23514'; end if;
  -- Reapply deletion intent after a restore before any worker can obtain a current grant.
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id
    join parent_private.deletion_tombstones t on t.subject_hash=encode(sha256(convert_to('parent-account:'||h.owner_id::text,'UTF8')),'hex')
    where r.status<>'cancelled' order by r.id for update of r skip locked limit 100 loop
    perform parent_private.invalidate_work(v_request,'A prior account deletion was reapplied after restore.');
    update public.parent_requests set status='cancelled',mandate_revoked_at=now(),version=version+1,updated_at=now() where id=v_request;
  end loop;
  update public.parent_accounts a set status='deletion_requested',updated_at=now()
    where a.status<>'deletion_requested' and exists(select 1 from parent_private.deletion_tombstones t where t.subject_hash=encode(sha256(convert_to('parent-account:'||a.id::text,'UTF8')),'hex'));
  select coalesce(array_agg(id),'{}') into v_docs from (
    select d.id from public.parent_documents d join public.parent_requests r on r.id=d.request_id join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id
    where ((d.status not in ('deleted','raw_deleted') and (d.status='deletion_pending' or d.expires_at<=now())) or (a.status='deletion_requested' and d.status not in ('deleted','raw_deleted')))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and d.id=any(b.document_ids))
    order by d.expires_at for update of d skip locked limit p_limit
  ) expired;
  select coalesce(array_agg(id),'{}') into v_artifacts from (
    select f.id from public.parent_form_artifacts f join public.parent_requests r on r.id=f.request_id join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id
    where f.status<>'deleted' and (a.status='deletion_requested' or (r.status in ('closed','cancelled') and r.updated_at<now()-interval '90 days') or (f.status='registered' and f.created_at<now()-interval '1 day'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and f.id=any(b.artifact_ids))
    order by f.created_at for update of f skip locked limit p_limit
  ) expired;
  select coalesce(array_agg(id),'{}') into v_accounts from (
    select a.id from public.parent_accounts a where a.status='deletion_requested'
      and not exists(select 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id join public.parent_documents d on d.request_id=r.id where h.owner_id=a.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and a.id=any(b.account_ids))
      and not exists(select 1 from public.parent_households h join public.parent_requests r on r.household_id=h.id join public.parent_form_artifacts f on f.request_id=r.id where h.owner_id=a.id and f.status<>'deleted')
    order by a.updated_at limit p_limit
  ) eligible;
  select coalesce(array_agg(id),'{}') into v_requests from (
    select r.id from public.parent_requests r where r.status in ('closed','cancelled') and r.updated_at<now()-interval '90 days'
      and not exists(select 1 from public.parent_documents d where d.request_id=r.id and d.status not in ('deleted','raw_deleted'))
      and not exists(select 1 from parent_private.cleanup_batches b where b.completed_at is null and b.expires_at>now() and r.id=any(b.request_ids))
      and not exists(select 1 from public.parent_form_artifacts f where f.request_id=r.id and f.status<>'deleted')
    order by r.updated_at limit p_limit
  ) eligible;
  delete from parent_private.cleanup_batches where expires_at<now()-interval '1 day';
  delete from parent_private.retained_evidence where expires_at<now();
  delete from parent_private.deletion_tombstones where expires_at<now();
  if cardinality(v_docs)+cardinality(v_accounts)+cardinality(v_requests)+cardinality(v_artifacts)=0 then return null; end if;
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=any(v_accounts) order by r.id for update of r loop
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'mandate',encode(sha256(convert_to(mandate::text,'UTF8')),'hex'),created_at from public.parent_requests where id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'operation.'||state,packet_hash,coalesce(executed_at,created_at) from public.parent_operations where request_id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at) select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'form',content_sha256,created_at from public.parent_form_artifacts where request_id=v_request on conflict do nothing;
  end loop;
  insert into parent_private.cleanup_batches(document_ids,account_ids,request_ids,artifact_ids) values(v_docs,v_accounts,v_requests,v_artifacts) returning * into v_batch;
  return jsonb_build_object('batchId',v_batch.id,'leaseToken',v_batch.lease_token,
    'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'objectPath',d.object_path)),'[]') from public.parent_documents d where d.id=any(v_docs)),
    'artifacts',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'objectPath',f.object_path)),'[]') from public.parent_form_artifacts f where f.id=any(v_artifacts)),
    'accountIds',v_accounts,'requestIds',v_requests);
end $$;

drop function parent_private.parent_finish_cleanup(uuid,uuid,uuid[],uuid[]);
create function parent_private.parent_finish_cleanup(p_batch_id uuid,p_lease_token uuid,p_deleted_documents uuid[],p_deleted_accounts uuid[],p_deleted_artifacts uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare v_batch parent_private.cleanup_batches; v_request uuid;
begin
  select * into v_batch from parent_private.cleanup_batches where id=p_batch_id for update;
  if not found or v_batch.lease_token is distinct from p_lease_token or v_batch.expires_at<=now() or v_batch.completed_at is not null
    or p_deleted_artifacts is null or not p_deleted_artifacts<@v_batch.artifact_ids or p_deleted_documents is null or p_deleted_accounts is null or not p_deleted_documents<@v_batch.document_ids or not p_deleted_accounts<@v_batch.account_ids then raise exception 'cleanup lease or exact targets unavailable' using errcode='42501'; end if;
  perform 1 from public.parent_requests r where r.id in(select d.request_id from public.parent_documents d where d.id=any(p_deleted_documents) union select f.request_id from public.parent_form_artifacts f where f.id=any(p_deleted_artifacts)) order by r.id for update;
  update public.parent_documents d set status=case when d.status='deletion_pending' or exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id where r.id=d.request_id and a.status='deletion_requested') then 'deleted' else 'raw_deleted' end,
    facts=case when d.status='deletion_pending' or exists(select 1 from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id where r.id=d.request_id and a.status='deletion_requested') then '[]'::jsonb else d.facts end where d.id=any(p_deleted_documents);
  update public.parent_form_artifacts set status='deleted' where id=any(p_deleted_artifacts);
  -- Minimize retained evidence before account cascades remove private request content.
  for v_request in select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id
    where r.id=any(v_batch.request_ids) or h.owner_id=any(p_deleted_accounts) order by r.id for update of r loop
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'mandate',encode(sha256(convert_to(mandate::text,'UTF8')),'hex'),created_at from public.parent_requests where id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at)
      select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'operation.'||state,packet_hash,coalesce(executed_at,created_at) from public.parent_operations where request_id=v_request on conflict do nothing;
    insert into parent_private.retained_evidence(request_hash,kind,evidence_hash,event_at) select encode(sha256(convert_to('parent-request:'||v_request::text,'UTF8')),'hex'),'form',content_sha256,created_at from public.parent_form_artifacts where request_id=v_request on conflict do nothing;
    delete from public.parent_requests where id=v_request;
  end loop;
  update parent_private.deletion_tombstones set completed_at=now() where subject_hash in(select encode(sha256(convert_to('parent-account:'||id::text,'UTF8')),'hex') from unnest(p_deleted_accounts) id);
  delete from public.parent_accounts where id=any(p_deleted_accounts) and status='deletion_requested';
  update parent_private.cleanup_batches set completed_at=now() where id=p_batch_id;
end $$;


revoke execute on function parent_private.parent_finish_cleanup(uuid,uuid,uuid[],uuid[],uuid[]) from public,anon,authenticated,service_role,parent_worker;
grant execute on function parent_private.parent_finish_cleanup(uuid,uuid,uuid[],uuid[],uuid[]) to parent_retention_worker;
