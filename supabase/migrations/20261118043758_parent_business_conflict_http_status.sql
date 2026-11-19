-- Manual optimistic/replay conflicts must not trigger PostgREST 14 transaction retries.
-- Keep PostgreSQL serialization failures and all school functions unchanged.
do $migration$
declare
  target record;
  definition text;
  conflict_pattern constant text := $pattern$errcode\s*=\s*'40001'$pattern$;
begin
  for target in select * from (values
    ('public.parent_answer_fact(uuid,text,text,jsonb,integer)', 1),
    ('public.parent_answer_facts(uuid,jsonb,integer)', 1),
    ('public.parent_authorize_snap_direct_packet(uuid,integer,uuid,text,uuid,text,integer,uuid)', 1),
    ('public.parent_authorize_utility_identifier_replacement(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean,uuid)', 4),
    ('public.parent_authorize_utility_protected_input(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean)', 1),
    ('public.parent_clear_family_profile(uuid,integer,uuid)', 2),
    ('public.parent_correct_request(uuid,jsonb,integer)', 1),
    ('parent_private.authorize_utility_protected_input_base(uuid,integer,text,uuid,integer,text,uuid,text,jsonb,text,integer,text,boolean,boolean,boolean)', 1),
    ('parent_private.family_profile_source(integer)', 1),
    ('parent_private.parent_begin_utility_prepared_artifact(uuid,uuid,jsonb)', 1),
    ('parent_private.parent_begin_utility_protected_rebind(uuid,uuid,integer,uuid,integer,text)', 1),
    ('parent_private.parent_bind_utility_account(uuid,uuid,text)', 2),
    ('parent_private.parent_record_utility_protected_validation(uuid,text,jsonb,timestamp with time zone)', 1),
    ('parent_private.save_snap_application_details(uuid,integer,jsonb,text,uuid,text[])', 2),
    ('parent_private.save_wic_application_details(uuid,integer,jsonb,text,uuid,boolean,text[])', 2),
    ('parent_private.seal_utility_identifier_replacement()', 3),
    ('public.parent_replace_mandate(uuid,jsonb,integer)', 1),
    ('public.parent_replace_snap_personal_pages(uuid,integer,uuid)', 1),
    ('public.parent_save_application_with_family_profile(text,uuid,integer,jsonb,text,uuid,jsonb,boolean,boolean,text[])', 4),
    ('public.parent_save_family_profile(uuid,integer,jsonb,text,boolean,boolean,text[],uuid)', 2),
    ('public.parent_save_peco_application_details(uuid,integer,jsonb,text,uuid,boolean,boolean)', 2),
    ('public.parent_save_pgw_application_details(uuid,integer,jsonb,text,uuid,boolean,boolean)', 2),
    ('public.parent_save_water_application_details(uuid,integer,jsonb,text,uuid,boolean,boolean)', 2),
    ('public.parent_start_application_with_family_profile(text,jsonb,jsonb,jsonb,text,uuid,jsonb,boolean,boolean,uuid,integer)', 2),
    ('public.parent_start_peco_application(jsonb,jsonb,jsonb,text,uuid,boolean,boolean,uuid,integer)', 2),
    ('public.parent_start_pgw_application(jsonb,jsonb,jsonb,text,uuid,boolean,boolean,uuid,integer)', 2),
    ('public.parent_start_request_with_reused_zip(jsonb,jsonb,uuid,uuid,integer)', 1),
    ('public.parent_start_snap_application(jsonb,jsonb,jsonb,text,uuid)', 1),
    ('public.parent_start_water_application(jsonb,jsonb,jsonb,text,uuid,boolean,boolean,uuid,integer)', 2),
    ('public.parent_start_wic_application(jsonb,jsonb,jsonb,text,uuid,boolean,uuid,integer)', 2),
    ('public.parent_update_booking_preference(uuid,text,integer)', 1)
  ) as reviewed(signature, expected_count)
  loop
    definition := pg_get_functiondef(to_regprocedure(target.signature));
    if definition is null or regexp_count(definition, conflict_pattern, 1, 'i') <> target.expected_count then
      raise exception 'parent conflict definition changed: %', target.signature;
    end if;
    execute regexp_replace(definition, conflict_pattern, $replacement$errcode='PT409'$replacement$, 'gi');
  end loop;
  -- Preserve the existing source-changed response and isolated profile rebuild recovery.
  for target in select signature from (values
    ('parent_private.verify_family_profile_application(text,jsonb,jsonb,jsonb)'),
    ('parent_private.refresh_food_profile_applications()')
  ) as reviewed(signature)
  loop
    definition := pg_get_functiondef(to_regprocedure(target.signature));
    if definition is null or regexp_count(definition, 'serialization_failure', 1, 'i') <> 1 then
      raise exception 'parent conflict handler changed: %', target.signature;
    end if;
    execute regexp_replace(definition, 'serialization_failure', $replacement$serialization_failure or sqlstate 'PT409'$replacement$, 'i');
  end loop;
end
$migration$;
