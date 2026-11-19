-- Each selected route needs its own facts; an unsupported topic never silently selects a SNAP journey.
do $$declare target record; definition text;
begin
  for target in select * from (values
    ('parent_private.food_description_carry_facts(parent_private.food_description_drafts)'::regprocedure,
      '(''never'',''applied'',''receiving'',''not_sure'')', '(''never'',''applied'',''denied'',''receiving'',''not_sure'')'),
    ('public.parent_queue_food_description(uuid,uuid,integer,uuid,jsonb)'::regprocedure,
      '(''never'',''applied'',''receiving'',''not_sure'')', '(''never'',''applied'',''denied'',''receiving'',''not_sure'')'),
    ('public.parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid)'::regprocedure,
      '(''never'',''applied'',''receiving'',''not_sure'')', '(''never'',''applied'',''denied'',''receiving'',''not_sure'')'),
    ('parent_private.food_description_needs(jsonb)'::regprocedure,
      'when ''applied'' then ''snap_pending''', 'when ''applied'' then ''snap_pending'' when ''denied'' then ''snap_problem'''),
    ('public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)'::regprocedure,
      'if jsonb_typeof(p_intake->''needs'')',
      'if d.selection->>''outOfScope''=''outside_pa''
        or (d.selection->>''outOfScope'' is not null and p_intake->''needs'' ? ''food_now'' and not(d.selection->''needIds'' ? ''food_now'') and v_values->>''foodForTwoDays'' is distinct from ''no'')
        or (d.selection->>''outOfScope'' is not null and p_intake->''needs'' ?| array[''snap_new'',''snap_pending'',''snap_renewal'',''snap_problem''] and not(d.selection->''needIds'' ?| array[''snap_new'',''snap_pending'',''snap_renewal'',''snap_problem'']) and not exists(select 1 from jsonb_array_elements(d.selection->''assertions'') a where a->>''questionId'' in (''benefitHistory'',''existingIssue'')))
        or jsonb_typeof(p_intake->''needs'')'),
    ('public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)'::regprocedure,
      '(not(v_values ? ''foodForTwoDays'') and not exists',
      '(p_intake->''needs'' ? ''food_now'' and not(v_values ? ''foodForTwoDays'') and not exists'),
    ('public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)'::regprocedure,
      '(not(v_values ? ''benefitHistory'') and exists(select 1 from unnest(array[''snap_new'',''snap_pending'',''snap_renewal'',''snap_problem'']) need where not exists(select 1 from jsonb_array_elements(d.selection->''exclusions'') e where e->>''need''=need)))',
      '(p_intake->''needs'' ?| array[''snap_new'',''snap_pending'',''snap_renewal'',''snap_problem''] and not(v_values ? ''benefitHistory''))'),
    ('public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)'::regprocedure,
      '(v_values->>''benefitHistory''=''receiving'' and not(v_values ? ''existingIssue''))',
      '(p_intake->''needs'' ?| array[''snap_new'',''snap_pending'',''snap_renewal'',''snap_problem''] and v_values->>''benefitHistory''=''receiving'' and not(v_values ? ''existingIssue''))')
  ) patches(signature,before,after) loop
    definition:=pg_get_functiondef(target.signature);
    if (length(definition)-length(replace(definition,target.before,'')))/length(target.before)<>1 then raise exception 'description routing target changed: %',target.signature; end if;
    execute replace(definition,target.before,target.after);
  end loop;
end $$;
