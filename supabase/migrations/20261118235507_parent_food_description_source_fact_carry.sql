-- Same-draft ordinary answers retain their immutable source attempt, never a new parent confirmation or retention period.
create function parent_private.food_description_carry_facts(d parent_private.food_description_drafts) returns jsonb
language plpgsql stable set search_path='' as $$
declare facts jsonb:=parent_private.food_description_current_routing_facts(d); item record; origin record; assertion jsonb; quote text; at integer; previous jsonb;
begin
  if d.content_expires_at<=clock_timestamp() or d.state in ('cancelled','expired') then return '{}'; end if;
  -- A retained description fact must still have its exact immutable, owner-bound source attempt.
  for item in select key,value from jsonb_each(facts) where value->>'source'='parent_description' loop
    if not exists(select 1 from parent_private.food_description_calls c cross join lateral jsonb_array_elements(coalesce(c.result_selection->'assertions','[]')) a
      where c.draft_id=d.id and c.owner_id=d.owner_id and c.revision::text=item.value->>'sourceRevision'
        and c.created_at=parent_private.fixed_source_timestamp(item.value->>'sourceAttemptCreatedAt')
        and c.created_at<=clock_timestamp() and c.model_projection is not null
        and a->>'questionId'=item.key and a->'value'=item.value->'value'
        and (c.model_projection#>>array['routingFacts',item.key,'source']='parent_description'
          or c.model_projection#>>array['routingFacts',item.key,'value']='not_sure' or not(c.model_projection->'routingFacts' ? item.key))
        and parent_private.fixed_source_timestamp(item.value->>'expiresAt')=least(d.content_expires_at,c.created_at+interval '24 hours')) then facts:=facts-item.key; end if;
  end loop;
  for assertion in select value from jsonb_array_elements(coalesce(d.selection->'assertions','[]')) loop
    if (case assertion->>'questionId' when 'foodForTwoDays' then assertion->>'value' in ('yes','no','not_sure')
      when 'benefitHistory' then assertion->>'value' in ('never','applied','receiving','not_sure')
      when 'existingIssue' then assertion->>'value' in ('renewal','stopped','card','none','not_sure') else false end) is not true then continue; end if;
    -- Deterministic clarification may advance the draft revision without another model attempt.
    select c.* into origin from parent_private.food_description_calls c where c.draft_id=d.id and c.owner_id=d.owner_id
      and c.created_at<=clock_timestamp() and c.created_at+interval '24 hours'>clock_timestamp()
      and c.model_projection->>'description'=d.input->>'description' and c.result_selection->'assertions' @> jsonb_build_array(assertion)
      and (c.model_projection#>>array['routingFacts',assertion->>'questionId','source']='parent_description'
        or c.model_projection#>>array['routingFacts',assertion->>'questionId','value']='not_sure' or not(c.model_projection->'routingFacts' ? (assertion->>'questionId')))
      order by c.revision desc limit 1;
    if not found then continue; end if;
    -- The immutable selection already passed native JS UTF16 span validation; independently retain its unique exact quote without reinterpreting offsets as PostgreSQL characters.
    quote:=assertion#>>'{span,text}'; at:=strpos(origin.model_projection->>'description',quote);
    if quote is null or quote='' or at=0 or strpos(substr(origin.model_projection->>'description',at+1),quote)>0 then continue; end if;
    previous:=facts->(assertion->>'questionId');
    if previous is not null and (previous->>'source'<>'parent_description' and previous->>'value'<>'not_sure' or previous->'value'=assertion->'value') then continue; end if;
    facts:=facts||jsonb_build_object(assertion->>'questionId',jsonb_build_object('value',assertion->'value','source','parent_description','sourceRevision',origin.revision,
      'sourceAttemptCreatedAt',origin.created_at,'expiresAt',least(d.content_expires_at,origin.created_at+interval '24 hours')));
  end loop;
  if facts#>>'{benefitHistory,value}' is distinct from 'receiving' then facts:=facts-'existingIssue'; end if;
  return facts;
end $$;
revoke execute on function parent_private.food_description_carry_facts(parent_private.food_description_drafts) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;

-- Guard every installed function target. CREATE OR REPLACE retains its existing owner, ACL and security attributes.
do $$declare target record; definition text;
begin
  for target in select * from (values
    ('parent_private.food_description_current_routing_facts(parent_private.food_description_drafts)'::regprocedure,
      'parent_private.fixed_source_timestamp(value->>''confirmedAt'')<=clock_timestamp()',
      'parent_private.fixed_source_timestamp(case when value->>''source''=''parent_description'' then value->>''sourceAttemptCreatedAt'' else value->>''confirmedAt'' end)<=clock_timestamp()'),
    ('parent_private.food_description_repeated_input(parent_private.food_description_drafts,text,jsonb)'::regprocedure,
      'charged->''routingFacts''=p_facts',
      '(select coalesce(jsonb_object_agg(key,value),''{}'') from jsonb_each(charged->''routingFacts'') where value->>''source''<>''parent_description'')=(select coalesce(jsonb_object_agg(key,value),''{}'') from jsonb_each(p_facts) where value->>''source''<>''parent_description'')'),
    ('parent_private.food_description_values(parent_private.food_description_drafts)'::regprocedure,
      'if not(v_values ? item.key) or v_values->>item.key=''not_sure'' then',
      'if not(v_values ? item.key) or v_values->>item.key=''not_sure'' or d.routing_facts#>>array[item.key,''source'']=''parent_description'' then'),
    ('public.parent_queue_food_description(uuid,uuid,integer,uuid,jsonb)'::regprocedure,
      'not(v_facts ? item.key) or v_facts#>array[item.key,''value''] is distinct from item.value->''value''',
      'not(v_facts ? item.key) or v_facts#>array[item.key,''value''] is distinct from item.value->''value'' or v_facts#>>array[item.key,''source'']=''parent_description'' or (v_facts#>>array[item.key,''value'']=''not_sure'' and parent_private.fixed_source_timestamp(v_facts#>>array[item.key,''confirmedAt'']) is distinct from confirmed and parent_private.food_description_values(d)->item.key is distinct from item.value->''value'')'),
    ('public.parent_queue_food_description(uuid,uuid,integer,uuid,jsonb)'::regprocedure,
      'if confirmed+interval ''24 hours''>clock_timestamp()',
      'if exists(select 1 from parent_private.food_description_calls c where c.draft_id=d.id and c.owner_id=d.owner_id and c.model_projection#>>array[''routingFacts'',item.key,''source'']=''parent_typed'' and c.model_projection#>array[''routingFacts'',item.key,''value'']=item.value->''value'' and parent_private.fixed_source_timestamp(c.model_projection#>>array[''routingFacts'',item.key,''confirmedAt''])=confirmed) then continue; end if; if confirmed+interval ''24 hours''>clock_timestamp()'),
    ('public.parent_queue_food_description(uuid,uuid,integer,uuid,jsonb)'::regprocedure,
      'update parent_private.food_description_drafts set revision=revision+1,state=''queued''',
      'v_facts:=parent_private.food_description_carry_facts(d)||(select coalesce(jsonb_object_agg(key,value),''{}'') from jsonb_each(v_facts) where value->>''source''<>''parent_description'' and value is distinct from (d.routing_facts->key)); if v_facts#>>''{benefitHistory,value}'' is distinct from ''receiving'' then v_facts:=v_facts-''existingIssue''; end if; update parent_private.food_description_drafts set revision=revision+1,state=''queued'''),
    ('public.parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid)'::regprocedure,
      'p_answers->field is distinct from v_values->field or not(v_facts ? field)',
      'p_answers->field is distinct from v_values->field or not(v_facts ? field) or v_facts#>>array[field,''source'']=''parent_description'''),
    ('public.parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid)'::regprocedure,
      'if v_facts=d.routing_facts then',
      'if v_facts=d.routing_facts and p_answers=original_answers then'),
    ('public.parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid)'::regprocedure,
      'v_needs:=parent_private.food_description_needs(p_answers);',
      'v_facts:=parent_private.food_description_carry_facts(d)||(select coalesce(jsonb_object_agg(key,value),''{}'') from jsonb_each(v_facts) where value->>''source''<>''parent_description'' and (value is distinct from (d.routing_facts->key) or key=any(p_changed_fields))); if v_facts#>>''{benefitHistory,value}'' is distinct from ''receiving'' then v_facts:=v_facts-''existingIssue''; end if; v_needs:=parent_private.food_description_needs(p_answers);')
  ) patches(signature,before,after) loop
    definition:=pg_get_functiondef(target.signature);
    if (length(definition)-length(replace(definition,target.before,'')))/length(target.before)<>1 then raise exception 'description carry target changed: %',target.signature; end if;
    execute replace(definition,target.before,target.after);
  end loop;
end $$;
