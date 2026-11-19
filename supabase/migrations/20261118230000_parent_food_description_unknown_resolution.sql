-- Resolve recorded uncertainty from current validated assertions without rewriting its source record.
do $$
declare patch record; definition text; original_owner oid; original_acl aclitem[];
begin
  for patch in select * from (values
    ('parent_private.food_description_values(parent_private.food_description_drafts)'::regprocedure,
      'if not(v_values ? item.key) then',
      'if not(v_values ? item.key) or v_values->>item.key=''not_sure'' then'),
    -- Supported needs come from validated answers; raw model nominations cannot narrow that set.
    ('public.parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)'::regprocedure,
      ' or not((p_intake->''needs'')<@(d.selection->''needIds''))', '')
  ) changes(target, old_text, new_text) loop
    select proowner, proacl into original_owner, original_acl from pg_proc where oid=patch.target;
    definition:=pg_get_functiondef(patch.target);
    if length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text)
      then raise exception 'description unknown-resolution target changed'; end if;
    execute replace(definition,patch.old_text,patch.new_text);
    if exists(select 1 from pg_proc where oid=patch.target and (proowner is distinct from original_owner or proacl is distinct from original_acl))
      then raise exception 'description unknown-resolution privileges changed'; end if;
  end loop;
end $$;
