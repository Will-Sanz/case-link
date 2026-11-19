-- Expose the existing lifetime counter to bounded public-food scheduling; do not change claim authority.
do $migration$
declare definition text;
  anchor constant text := $anchor$'jobId',v_job.id,'leaseToken',v_token,'request',v_request,$anchor$;
  replacement constant text := $replacement$'jobId',v_job.id,'leaseToken',v_token,'attempts',v_job.attempts+1,'request',v_request,$replacement$;
begin
  definition:=pg_get_functiondef('parent_private.parent_claim_job(integer,boolean,boolean,boolean)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
    or strpos(definition,replacement)<>0 then raise exception 'food directory claim counter target changed'; end if;
  execute replace(definition,anchor,replacement);
end $migration$;
