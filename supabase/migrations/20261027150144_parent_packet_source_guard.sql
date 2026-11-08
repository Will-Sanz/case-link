-- Fixed evidence dates cannot use dynamic aliases such as 'now'.
create function parent_private.fixed_source_timestamp(p_value text) returns timestamptz
language plpgsql stable set search_path='' as $$
declare v_iso text:=case when length(p_value)=10 then p_value||'T00:00:00Z' else p_value end;
begin
  if p_value is null or p_value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2}))?$'
    or not pg_catalog.pg_input_is_valid(v_iso,'timestamp with time zone') then return null; end if;
  return v_iso::timestamptz;
end $$;

create function parent_private.current_intake_fields(p_request_id uuid,p_need text) returns jsonb
language plpgsql stable set search_path='' as $$
declare
  v_request public.parent_requests; v_result jsonb:='{}'; v_field text; v_category text;
  v_value jsonb; v_packet jsonb; v_fact jsonb; v_at timestamptz; v_as_of timestamptz;
  v_cutoff timestamptz:=now()-interval '1080 hours';
begin
  select * into v_request from public.parent_requests where id=p_request_id;
  if not found or p_need is null or not(v_request.intake->'needs' ? p_need) then return v_result; end if;
  foreach v_field in array array['zip','householdSize','incomeAmount','incomeFrequency'] loop
    v_category:=case when v_field in ('zip','householdSize') then 'household' else 'income' end;
    if not(v_request.mandate->'allowedData' ? v_category) or v_request.intake_need_scoped_fields is null
      or v_field=any(v_request.intake_need_scoped_fields) then continue; end if;
    if v_request.intake_confirmed_at ? v_field then
      v_at:=parent_private.fixed_source_timestamp(v_request.intake_confirmed_at->>v_field);
    else v_at:=v_request.created_at;
    end if;
    if v_at is null or v_at<v_cutoff or v_at>now() then continue; end if;
    v_value:=v_request.intake->v_field;
    if v_field='incomeFrequency' and jsonb_typeof(v_value) is distinct from 'string' then continue; end if;
    begin
      perform parent_private.validate_packet(jsonb_build_object(v_field,v_value),array[v_category],array[]::uuid[],'prepare');
    exception when data_exception or check_violation or insufficient_privilege then continue;
    end;
    v_result:=v_result||jsonb_build_object(v_field,v_value);
  end loop;
  if not(v_result ?& array['incomeAmount','incomeFrequency']) then v_result:=v_result-'incomeAmount'-'incomeFrequency'; end if;

  for v_fact in select f from jsonb_array_elements(v_request.facts) with ordinality entry(f,ordinal)
    order by parent_private.fixed_source_timestamp(f->>'confirmedAt'),ordinal loop
    if jsonb_typeof(v_fact) is distinct from 'object' or v_fact->>'need' is distinct from p_need
      or v_fact->>'source' is distinct from 'parent' then continue; end if;
    v_field:=v_fact->>'field';
    if v_field is null or v_field not in ('zip','householdSize','income','incomeAmount','incomeFrequency') then continue; end if;
    v_category:=case when v_field in ('zip','householdSize') then 'household' else 'income' end;
    if not(v_request.mandate->'allowedData' ? v_category) then continue; end if;
    v_at:=parent_private.fixed_source_timestamp(v_fact->>'confirmedAt');
    v_as_of:=parent_private.fixed_source_timestamp(v_fact->>'asOf');
    if v_at is null or v_as_of is null or v_at<v_cutoff or v_at>now()
      or v_as_of<v_cutoff or v_as_of>v_at then continue; end if;
    v_value:=v_fact->'value';
    if v_field='income' then
      if jsonb_typeof(v_value) is distinct from 'object' then continue; end if;
      if not(v_value ?& array['amount','frequency']) or (select count(*) from jsonb_object_keys(v_value))<>2
        or jsonb_typeof(v_value->'frequency') is distinct from 'string' then continue; end if;
      v_packet:=jsonb_build_object('incomeAmount',v_value->'amount','incomeFrequency',v_value->'frequency');
    else
      if v_field='incomeFrequency' and jsonb_typeof(v_value) is distinct from 'string' then continue; end if;
      v_packet:=jsonb_build_object(v_field,v_value);
    end if;
    begin
      perform parent_private.validate_packet(v_packet,array[v_category],array[]::uuid[],'prepare');
    exception when data_exception or check_violation or insufficient_privilege then continue;
    end;
    if v_field in ('incomeAmount','incomeFrequency') then
      if v_result->v_field is distinct from v_value then v_result:=v_result-'incomeAmount'-'incomeFrequency'; end if;
    else v_result:=v_result||v_packet;
    end if;
  end loop;
  return v_result;
end $$;
revoke execute on function parent_private.fixed_source_timestamp(text),parent_private.current_intake_fields(uuid,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

create or replace function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.current_grant(p_request,p_version) and exists(select 1 from public.parent_requests r
    where r.id=p_request and r.mandate->'recipientIds' ? p_program and r.mandate->'allowedActions' ? p_action
    and p_need is not null and r.intake->'needs' ? p_need and parent_private.program_supports_need(p_program,p_need)
    and parent_private.current_intake_fields(r.id,p_need) @> coalesce((
      select jsonb_object_agg(k,v) from jsonb_each(p_packet) entry(k,v)
      where k in ('zip','householdSize','incomeAmount','incomeFrequency')
    ),'{}'::jsonb)
    and p_data<@array(select jsonb_array_elements_text(r.mandate->'allowedData'))
    and (cardinality(p_documents)=0 or ('documents'=any(p_data) and not exists(select 1 from unnest(p_documents) d_id where not exists(select 1 from public.parent_documents d where d.id=d_id and d.request_id=r.id and d.status='validated' and d.expires_at>now()))))
    and (p_action in ('research','prepare') or (r.mandate->>'mode'='full' and exists(select 1 from parent_private.provider_capabilities c where c.program_id=p_program and c.action=p_action and c.enabled and c.transport_verified and c.requires_form is not null and c.verified_until>now() and c.required_acts is not null
      and not exists(select 1 from jsonb_each(p_packet) f where not f.key=any(c.allowed_fields) or c.field_categories->>f.key is null or not(c.field_categories->>f.key=any(p_data))))))
    and (p_action in ('research','prepare') or not('utility'=any(p_data)) or (p_need is not null and coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority') in ('self','authorized_caregiver') and (not(p_packet ? 'accountAuthority') or p_packet->>'accountAuthority'=coalesce((select f->>'value' from jsonb_array_elements(r.facts) f where f->>'need'=p_need and f->>'field'='accountAuthority' and f->>'source'='parent' and (f->>'confirmedAt')::timestamptz>now()-interval '45 days' order by (f->>'confirmedAt')::timestamptz desc limit 1),r.intake->>'accountAuthority'))))
    and (p_action in ('research','prepare') or p_need not in ('electricity','gas','water') or (parent_private.effective_utility_provider(r.intake,r.facts,p_need) in ('unknown',case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end) and coalesce(p_packet->>'utilityProvider',case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end)=case p_need when 'electricity' then 'peco' when 'gas' then 'pgw' when 'water' then 'pwd' end))
    and (p_action<>'schedule' or r.mandate->>'bookingPreference'<>'ask_me'));
$$;

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
  if not(parent_private.current_intake_fields(v_job.request_id,v_need) @> coalesce((
    select jsonb_object_agg(k,v) from jsonb_each(p_form_input) entry(k,v)
    where k in ('zip','householdSize','incomeAmount','incomeFrequency')
  ),'{}'::jsonb)) then raise exception 'form source is not current for this need' using errcode='42501'; end if;
  insert into public.parent_form_artifacts(id,request_id,request_version,need,program_id,template_id,template_version,template_hash,form_input_digest,content_sha256,object_path,expires_at)
    values(v_id,v_job.request_id,v_job.request_version,v_need,p_program_id,p_template_id,p_template_version,v_template.content_sha256,encode(sha256(convert_to(p_form_input::text,'UTF8')),'hex'),p_content_sha256,v_job.request_id::text||'/'||v_id::text||'.pdf',least(v_template.verified_until,now()+interval '30 days')) returning * into v_artifact;
  return to_jsonb(v_artifact);
end $$;
