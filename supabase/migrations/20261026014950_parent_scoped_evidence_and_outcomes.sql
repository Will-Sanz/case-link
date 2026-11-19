-- Trusted evidence access is an explicit referral grant, never a school/admin inheritance.
create table parent_private.trusted_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  operation_id uuid not null references public.parent_operations(id) on delete cascade,
  program_id text not null,
  role text not null check(role in ('partner','operator')),
  allowed_fields text[] not null,
  can_record_status boolean not null default false,
  can_verify_personal_acts boolean not null default false,
  active boolean not null default true,
  purpose text not null check(length(purpose) between 1 and 200),
  permission_reference text not null check(length(permission_reference) between 1 and 200),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(user_id,operation_id)
);
alter table parent_private.trusted_memberships enable row level security;
revoke all on parent_private.trusted_memberships from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
create table public.parent_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  operation_id uuid not null references public.parent_operations(id) on delete cascade,
  state text not null check(state in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved')),
  attribution text not null check(attribution in ('partner_reported','operator_confirmed')),
  evidence jsonb not null,
  evidence_hash text not null,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(operation_id,evidence_hash)
);
alter table public.parent_receipts enable row level security;
revoke all on public.parent_receipts from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
grant select on public.parent_receipts to authenticated;
create policy parent_receipt_read on public.parent_receipts for select to authenticated using(parent_private.owns_request(request_id));

create function parent_private.trusted_identity() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<now()) and s.id=(select nullif(auth.jwt()->>'session_id','')::uuid)
      and (s.not_after is null or s.not_after>now()));
$$;
create function parent_private.referral_membership(p_operation uuid,p_record boolean) returns parent_private.trusted_memberships
language plpgsql security definer set search_path='' as $$
declare v_membership parent_private.trusted_memberships;
begin
  if not parent_private.trusted_identity() then raise exception 'verified session required' using errcode='42501'; end if;
  select m.* into v_membership from parent_private.trusted_memberships m join public.parent_operations o on o.id=m.operation_id
    where m.operation_id=p_operation and m.user_id=auth.uid() and m.active and m.expires_at>now()
      and m.request_id=o.request_id and m.program_id=o.program_id and (not p_record or m.can_record_status);
  if not found then raise exception 'referral access unavailable' using errcode='42501'; end if;
  return v_membership;
end $$;
create function public.parent_read_referral_packet(p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_membership parent_private.trusted_memberships; v_operation public.parent_operations; v_packet jsonb;
begin
  v_membership:=parent_private.referral_membership(p_operation_id,false);
  select * into v_operation from public.parent_operations where id=p_operation_id;
  if v_operation.state not in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received')
    or not parent_private.current_grant(v_operation.request_id,v_operation.request_version) then raise exception 'referral permission changed' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into v_packet from jsonb_each(v_operation.packet) where key=any(v_membership.allowed_fields);
  return jsonb_build_object('operationId',v_operation.id,'programId',v_operation.program_id,'action',v_operation.action,'packet',v_packet,'packetHash',v_operation.packet_hash,'createdAt',v_operation.created_at);
end $$;
create function public.parent_record_referral_status(p_operation_id uuid,p_state text,p_evidence jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_membership parent_private.trusted_memberships; v_operation public.parent_operations; v_evidence jsonb; v_hash text; v_id uuid; v_rank integer; v_current_rank integer;
begin
  v_membership:=parent_private.referral_membership(p_operation_id,true);
  select * into v_operation from public.parent_operations where id=p_operation_id;
  perform 1 from public.parent_requests where id=v_operation.request_id for update;
  perform 1 from public.parent_jobs where request_id=v_operation.request_id for update;
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  if v_operation.executed_at is null or v_operation.state in ('prepared','invalidated','failed') then raise exception 'no dispatched operation exists' using errcode='23514'; end if;
  if p_state is null or p_state not in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received','declined','unresolved')
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object' or pg_column_size(p_evidence)>2000
    or jsonb_typeof(p_evidence->'reference') is distinct from 'string' or jsonb_typeof(p_evidence->'observedAt') is distinct from 'string'
    or length(coalesce(p_evidence->>'reference','')) not between 1 and 200
    or not(p_evidence ?& array['reference','observedAt'])
    or exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('reference','observedAt','reason'))
    or (p_evidence->>'observedAt')::timestamptz>now()+interval '5 minutes'
    or (p_evidence->>'observedAt')::timestamptz<v_operation.created_at-interval '1 day'
    or (p_evidence ? 'reason' and coalesce(p_evidence->>'reason','') not in ('provider_declined','out_of_area','all_permitted_routes_exhausted')) then raise exception 'attributed referral evidence required' using errcode='23514'; end if;
  v_evidence:=p_evidence||jsonb_build_object('source',case when v_membership.role='partner' then 'authenticated_partner' else 'operator_confirmed' end,'attribution',case when v_membership.role='partner' then 'partner_reported' else 'operator_confirmed' end,'packetHash',v_operation.packet_hash);
  v_hash:=encode(sha256(convert_to(jsonb_build_object('state',p_state,'evidence',v_evidence)::text,'UTF8')),'hex');
  select id into v_id from public.parent_receipts where operation_id=p_operation_id and evidence_hash=v_hash;
  if found then return v_id; end if;
  v_rank:=case p_state when 'sent' then 1 when 'partner_received' then 2 when 'partner_accepted' then 3 when 'agency_submitted' then 4 when 'assistance_approved' then 5 when 'support_received' then 6 else 7 end;
  v_current_rank:=case v_operation.state when 'sent' then 1 when 'partner_received' then 2 when 'partner_accepted' then 3 when 'agency_submitted' then 4 when 'assistance_approved' then 5 when 'support_received' then 6 when 'declined' then 7 when 'unresolved' then 7 else 0 end;
  if v_current_rank>v_rank or (v_operation.state in ('support_received','declined','unresolved') and p_state<>v_operation.state) or (v_operation.state='assistance_approved' and p_state in ('declined','unresolved')) then raise exception 'definitive outcome cannot be silently replaced' using errcode='23514'; end if;
  insert into public.parent_receipts(request_id,operation_id,state,attribution,evidence,evidence_hash,recorded_by)
    values(v_operation.request_id,p_operation_id,p_state,v_evidence->>'attribution',v_evidence,v_hash,auth.uid()) returning id into v_id;
  update public.parent_operations set state=p_state,evidence=v_evidence,updated_at=now() where id=p_operation_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_operation.request_id,'referral.'||p_state,v_membership.role,'A scoped service contact reported: '||replace(p_state,'_',' ')||'.',v_evidence||jsonb_build_object('operationId',p_operation_id));
  return v_id;
end $$;
create function public.parent_record_personal_act(p_operation_id uuid,p_act text,p_reference text,p_observed_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare v_membership parent_private.trusted_memberships; v_operation public.parent_operations;
begin
  v_membership:=parent_private.referral_membership(p_operation_id,false);
  select * into v_operation from public.parent_operations where id=p_operation_id;
  perform 1 from public.parent_requests where id=v_operation.request_id for update;
  perform 1 from public.parent_jobs where request_id=v_operation.request_id for update;
  select * into v_operation from public.parent_operations where id=p_operation_id for update;
  if not v_membership.can_verify_personal_acts or not parent_private.current_grant(v_operation.request_id,v_operation.request_version)
    or p_act is null or not exists(select 1 from parent_private.provider_capabilities c where c.program_id=v_operation.program_id and c.action=v_operation.action and p_act=any(c.required_acts))
    or length(coalesce(p_reference,'')) not between 1 and 200 or p_observed_at is null or p_observed_at>now()+interval '5 minutes' or p_observed_at<v_operation.created_at then raise exception 'verified personal-act authority unavailable' using errcode='42501'; end if;
  insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_by,verified_at,expires_at)
    values(p_operation_id,p_act,v_operation.packet_hash,p_reference,auth.uid(),p_observed_at,least(v_membership.expires_at,now()+interval '24 hours')) on conflict do nothing;
  update public.parent_jobs set state='queued',run_at=now(),updated_at=now() where request_id=v_operation.request_id and state='waiting' and parent_private.current_grant(request_id,request_version);
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_operation.request_id,'personal_act.verified',v_membership.role,'A required personal step was verified for the prepared packet.',jsonb_build_object('operationId',p_operation_id,'act',p_act,'attribution',v_membership.role||'_confirmed'));
end $$;
create function public.parent_report_outcome(p_request_id uuid,p_need text,p_outcome text,p_reference text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  if p_need is null or not exists(select 1 from public.parent_requests where id=p_request_id and intake->'needs' ? p_need)
    or p_outcome is null or p_outcome not in ('agency_submitted','assistance_approved','support_received','declined','unresolved','withdrawn')
    or length(btrim(coalesce(p_reference,''))) not between 1 and 500 then raise exception 'invalid parent outcome report' using errcode='23514'; end if;
  insert into public.parent_events(request_id,kind,actor,summary,evidence)
    values(p_request_id,'parent.outcome_reported','parent','You reported an outcome for '||replace(p_need,'_',' ')||'.',jsonb_build_object('need',p_need,'outcome',p_outcome,'reference',p_reference,'attribution','parent_reported')) returning id into v_id;
  return v_id;
end $$;

create function parent_private.parent_get_capability(p_program_id text,p_action text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('programId',p_program_id,'permissionVersion',c.permission_version,'enabled',coalesce(c.enabled and c.transport_verified and c.requires_form is not null and c.verified_until>now() and c.required_acts is not null,false),
    'actions',case when c.enabled and c.transport_verified and c.requires_form is not null and c.verified_until>now() and c.required_acts is not null then jsonb_build_array(p_action) else '[]'::jsonb end,
    'permissionReference',c.permission_reference,'permissionExpiresAt',c.verified_until,'dataCategories',coalesce((select jsonb_agg(distinct v) from jsonb_each_text(c.field_categories) f(k,v)),'[]'::jsonb),
    'requiresForm',c.requires_form,'allowedFields',coalesce(to_jsonb(c.allowed_fields),'[]'::jsonb),'requiredActs',to_jsonb(c.required_acts),'personalActsComplete',coalesce(cardinality(c.required_acts)=0,false))
    from (select 1) seed left join parent_private.provider_capabilities c on c.program_id=p_program_id and c.action=p_action;
$$;
create function public.parent_capability_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_parent_session() then raise exception 'parent session required' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('programId',p.program_id,'actions',p.actions,'enabled',jsonb_array_length(p.actions)>0)),'[]') from (
    select program_id,coalesce(jsonb_agg(action) filter(where enabled and transport_verified and requires_form is not null and required_acts is not null and verified_until>now()),'[]') actions from parent_private.provider_capabilities group by program_id
  ) p);
end $$;
revoke execute on function public.parent_capability_summary() from public,anon,service_role,parent_worker,parent_retention_worker;
grant execute on function public.parent_capability_summary() to authenticated;

create function parent_private.parent_get_operations(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('personalActsComplete',case when o.action in ('research','prepare') then true else exists(select 1 from parent_private.provider_capabilities c where c.program_id=o.program_id and c.action=o.action and c.required_acts is not null and not exists(select 1 from unnest(c.required_acts) act where not exists(select 1 from parent_private.personal_act_evidence e where e.operation_id=o.id and e.act=act and e.packet_hash=o.packet_hash and e.expires_at>now()))) end) order by o.created_at),'[]') from public.parent_operations o where o.request_id=v_job.request_id);
end $$;

create function parent_private.close_request(p_request_id uuid,p_reason text,p_detail text,p_next_owner text,p_reentry text,p_actor text) returns void
language plpgsql set search_path='' as $$
declare v_request public.parent_requests; v_need text; v_program text; v_received boolean; v_all_received boolean:=true;
begin
  select * into v_request from public.parent_requests where id=p_request_id for update;
  if not found or v_request.status not in ('active','paused') or p_reason is null or p_reason not in ('completed','parent_choice','all_permitted_routes_exhausted','provider_declined','out_of_area')
    or length(btrim(coalesce(p_detail,''))) not between 1 and 500 or p_next_owner is null or p_next_owner not in ('parent','partner','service_operator')
    or length(btrim(coalesce(p_reentry,''))) not between 1 and 500 then raise exception 'closure needs a reason, owner and re-entry path' using errcode='23514'; end if;
  if p_reason<>'parent_choice' then
    for v_need in select jsonb_array_elements_text(v_request.intake->'needs') loop
      select exists(select 1 from public.parent_operations o where o.request_id=p_request_id and o.need=v_need and o.state='support_received' and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed'))
        or exists(select 1 from public.parent_events e where e.request_id=p_request_id and e.kind='parent.outcome_reported' and e.actor='parent' and e.evidence->>'attribution'='parent_reported' and e.evidence->>'need'=v_need and e.evidence->>'outcome'='support_received') into v_received;
      if v_received then continue; end if;
      v_all_received:=false;
      if p_reason='completed' then raise exception 'every need requires attributed support received evidence' using errcode='23514'; end if;
      -- Missing connectors, unattempted needs and silence never count as exhausted routes.
      for v_program in select jsonb_array_elements_text(v_request.mandate->'recipientIds') loop
        if parent_private.program_supports_need(v_program,v_need) and not exists(select 1 from public.parent_operations o where o.request_id=p_request_id and o.need=v_need and o.program_id=v_program and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed') and (p_reason<>'out_of_area' or o.evidence->>'reason'='out_of_area')) then raise exception 'permitted routes are not evidenced as exhausted for this need' using errcode='23514'; end if;
      end loop;
      if not exists(select 1 from public.parent_operations o where o.request_id=p_request_id and o.need=v_need and o.state in ('declined','unresolved') and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')) then raise exception 'every unresolved need requires an attributed outcome' using errcode='23514'; end if;
    end loop;
    if v_all_received and p_reason<>'completed' then raise exception 'successful needs require completed closure' using errcode='23514'; end if;
  end if;
  perform parent_private.invalidate_work(p_request_id,'This request was closed with a recorded reason and re-entry path.');
  update public.parent_requests set status='closed',mandate_revoked_at=now(),version=version+1,next_actor=p_next_owner,next_trigger='parent_reentry',next_run_at=null,updated_at=now() where id=p_request_id;
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(p_request_id,'request.closed',p_actor,'This request is closed. You can return for support.',jsonb_build_object('reason',p_reason,'detail',p_detail,'nextOwner',p_next_owner,'reentry',p_reentry));
end $$;
create function public.parent_close_request(p_request_id uuid,p_reason text,p_detail text,p_next_owner text,p_reentry text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  perform parent_private.close_request(p_request_id,p_reason,p_detail,p_next_owner,p_reentry,'parent');
end $$;
create function parent_private.parent_close_job(p_job_id uuid,p_lease_token uuid,p_reason text,p_detail text,p_next_owner text,p_reentry text) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_reason is null or p_reason='parent_choice' then raise exception 'AI cannot choose a parent withdrawal' using errcode='42501'; end if;
  perform parent_private.close_request(v_job.request_id,p_reason,p_detail,p_next_owner,p_reentry,'caselink');
end $$;

revoke execute on function parent_private.trusted_identity(),parent_private.referral_membership(uuid,boolean),parent_private.close_request(uuid,text,text,text,text,text) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker;
revoke execute on function public.parent_read_referral_packet(uuid),public.parent_record_referral_status(uuid,text,jsonb),public.parent_record_personal_act(uuid,text,text,timestamptz),public.parent_report_outcome(uuid,text,text,text),public.parent_close_request(uuid,text,text,text,text) from public,anon,service_role;
grant execute on function public.parent_read_referral_packet(uuid),public.parent_record_referral_status(uuid,text,jsonb),public.parent_record_personal_act(uuid,text,text,timestamptz),public.parent_report_outcome(uuid,text,text,text),public.parent_close_request(uuid,text,text,text,text) to authenticated;
revoke execute on function parent_private.parent_get_capability(text,text),parent_private.parent_get_operations(uuid,uuid),parent_private.parent_close_job(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role,parent_retention_worker;
grant execute on function parent_private.parent_get_capability(text,text),parent_private.parent_get_operations(uuid,uuid),parent_private.parent_close_job(uuid,uuid,text,text,text,text) to parent_worker;
