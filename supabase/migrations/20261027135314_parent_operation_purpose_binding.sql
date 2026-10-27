-- Bind preparation and execution to an exact requested program purpose.
-- Existing signatures and privileges are preserved; this enables no new service.

create or replace function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.current_grant(p_request,p_version) and exists(select 1 from public.parent_requests r
    where r.id=p_request and r.mandate->'recipientIds' ? p_program and r.mandate->'allowedActions' ? p_action
    and p_need is not null and r.intake->'needs' ? p_need and parent_private.program_supports_need(p_program,p_need)
    and p_data<@array(select jsonb_array_elements_text(r.mandate->'allowedData'))
    and (cardinality(p_documents)=0 or ('documents'=any(p_data) and not exists(select 1 from unnest(p_documents) d_id where not exists(select 1 from public.parent_documents d where d.id=d_id and d.request_id=r.id and d.status='validated' and d.expires_at>now()))))
    and (p_action in ('research','prepare') or (r.mandate->>'mode'='full' and exists(select 1 from parent_private.provider_capabilities c where c.program_id=p_program and c.action=p_action and c.enabled and c.transport_verified and c.requires_form is not null and c.verified_until>now() and c.required_acts is not null
      and not exists(select 1 from jsonb_each(p_packet) f where not f.key=any(c.allowed_fields) or c.field_categories->>f.key is null or not(c.field_categories->>f.key=any(p_data))))))
    and (p_action in ('research','prepare') or not('utility'=any(p_data)) or (p_need is not null and coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority') in ('self','authorized_caregiver') and (not(p_packet ? 'accountAuthority') or p_packet->>'accountAuthority'=coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority'))))
    and (p_action in ('research','prepare') or p_need not in ('electricity','gas','water') or (parent_private.effective_utility_provider(r.intake,r.facts,p_need) in ('unknown',case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end) and coalesce(p_packet->>'utilityProvider',case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end)=case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end))
    and (p_action<>'schedule' or r.mandate->>'bookingPreference'<>'ask_me'));
$$;

create or replace function parent_private.parent_prepare_operation(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_program_id text,p_action text,p_packet jsonb,p_data_categories text[],p_document_ids uuid[],p_idempotency_key text,p_need text default null,p_artifact_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_operation public.parent_operations; v_hash text; v_permission text; v_need text; v_compatible text[];
begin
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,p_expected_version);
  select coalesce(array_agg(n),'{}'::text[]) into v_compatible from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n where r.id=v_job.request_id and parent_private.program_supports_need(p_program_id,n);
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

create or replace function parent_private.parent_register_form_artifact(p_job_id uuid,p_lease_token uuid,p_program_id text,p_template_id text,p_template_version text,p_form_input jsonb,p_content_sha256 text,p_need text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs; v_template parent_private.form_templates; v_id uuid:=gen_random_uuid(); v_artifact public.parent_form_artifacts; v_need text; v_compatible text[];
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  select * into v_template from parent_private.form_templates where id=p_template_id and version=p_template_version and program_id=p_program_id and active and verified_until>now();
  if not found or p_content_sha256 is null or p_content_sha256!~'^[a-f0-9]{64}$' or p_form_input is null or jsonb_typeof(p_form_input)<>'object' or pg_column_size(p_form_input)>50000 then raise exception 'verified form and input required' using errcode='42501'; end if;
  select coalesce(array_agg(n),'{}'::text[]) into v_compatible from public.parent_requests r cross join lateral jsonb_array_elements_text(r.intake->'needs') n where r.id=v_job.request_id and r.mandate->'recipientIds' ? p_program_id and r.mandate->'allowedActions' ? 'prepare' and n=any(v_template.needs) and parent_private.program_supports_need(p_program_id,n);
  v_need:=coalesce(p_need,case when cardinality(v_compatible)=1 then v_compatible[1] else null end);
  if v_need is null or not v_need=any(v_compatible) or exists(select 1 from jsonb_object_keys(p_form_input) k where not exists(select 1 from jsonb_each_text(v_template.field_map) m(field,input_key) where m.input_key=k)) then raise exception 'form input does not match its verified purpose and mapping' using errcode='42501'; end if;
  perform parent_private.validate_packet(p_form_input,(select array_agg(v) from public.parent_requests r cross join lateral jsonb_array_elements_text(r.mandate->'allowedData') v where r.id=v_job.request_id),array(select v::uuid from jsonb_array_elements_text(coalesce(p_form_input->'documentIds','[]')) v),'prepare');
  insert into public.parent_form_artifacts(id,request_id,request_version,need,program_id,template_id,template_version,template_hash,form_input_digest,content_sha256,object_path,expires_at)
    values(v_id,v_job.request_id,v_job.request_version,v_need,p_program_id,p_template_id,p_template_version,v_template.content_sha256,encode(sha256(convert_to(p_form_input::text,'UTF8')),'hex'),p_content_sha256,v_job.request_id::text||'/'||v_id::text||'.pdf',least(v_template.verified_until,now()+interval '30 days')) returning * into v_artifact;
  return to_jsonb(v_artifact);
end $$;
