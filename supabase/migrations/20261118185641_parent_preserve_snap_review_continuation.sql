-- Preserve the existing installed pre-Submit review continuation in both candidate and locked-row checks.
-- A claim prepares the required parent review; every dispatch still needs current personal acts and exact Submit.
do $migration$
declare definition text;
  old_predicate constant text := 'and parent_private.personal_acts_complete(o) and parent_private.snap_submission_authorized(o.id)';
  new_predicate constant text := 'and (not parent_private.snap_submission_authorized(o.id) or parent_private.personal_acts_complete(o))';
begin
  definition:=pg_get_functiondef('parent_private.parent_claim_job(integer,boolean,boolean,boolean)'::regprocedure);
  if (length(definition)-length(replace(definition,old_predicate,'')))/length(old_predicate)<>2 then
    raise exception 'SNAP review continuation definition changed';
  end if;
  execute replace(definition,old_predicate,new_predicate);
end $migration$;
