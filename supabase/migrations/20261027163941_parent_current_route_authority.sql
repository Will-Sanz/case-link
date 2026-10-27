-- New service work requires current owned Philadelphia routing; linked case maintenance does not.

create or replace function parent_private.operation_allowed(p_request uuid,p_version integer,p_program text,p_action text,p_data text[],p_documents uuid[],p_packet jsonb,p_need text default null) returns boolean
language sql stable security definer set search_path='' as $$
  select parent_private.current_grant(p_request,p_version) and exists(select 1 from public.parent_requests r
    where r.id=p_request and r.mandate->'recipientIds' ? p_program and r.mandate->'allowedActions' ? p_action
    and p_need is not null and r.intake->'needs' ? p_need and parent_private.program_supports_need(p_program,p_need)
    and (not(p_packet ? 'statusReference') or (p_action='follow_up' and exists(
      select 1 from public.parent_operations o where o.request_id=r.id and o.program_id=p_program and o.need=p_need
        and o.state in ('sent','partner_received','partner_accepted','agency_submitted','assistance_approved','support_received')
        and o.evidence->>'reference'=p_packet->>'statusReference'
        and o.evidence->>'source' in ('provider_api','authenticated_partner','agency_receipt','operator_confirmed')
    )))
    and (p_action in ('research','prepare') or (p_action='follow_up' and p_packet ? 'statusReference')
      or coalesce(parent_private.current_intake_fields(r.id,p_need)->>'zip' ~ '^191[0-9]{2}$',false))
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
