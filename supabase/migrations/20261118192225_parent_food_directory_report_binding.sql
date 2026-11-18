-- Directory observations cannot overwrite a newer family report or use stale household routing.
-- Keep the existing receipt-wake branch first so a report received during the lease queues a fresh turn.
do $migration$
declare definition text; anchor constant text := $anchor$  v_actor:=case when p_next_actor='operator'$anchor$;
  guard constant text := $guard$  if exists(select 1 from jsonb_array_elements(p_plan->'routes') route
    where route ? 'foodAccessAlternatives' and (
      route->>'need' is distinct from 'food_now' or route->>'programId' is distinct from 'share-community-fridge-19129'
      or route#>>'{foodAccessAlternatives,kind}' is distinct from 'public_food_directory_observation'
      or route#>>'{foodAccessAlternatives,version}' is distinct from '1'
      or route#>>'{foodAccessAlternatives,requestId}' is distinct from v_job.request_id::text
      or route#>>'{foodAccessAlternatives,requestVersion}' is distinct from p_expected_version::text
      or route#>>'{foodAccessAlternatives,sourceUrl}' is distinct from 'https://www.phila.gov/food/'
      or route#>'{foodAccessAlternatives,sourceReport}' is distinct from parent_private.current_food_access_report(v_job.request_id)
      or route#>>'{foodAccessAlternatives,sourceReport,outcome}' is distinct from 'unresolved'
      or route#>>'{foodAccessAlternatives,queriedZip}' is distinct from parent_private.current_intake_fields(v_job.request_id,'food_now')->>'zip')) then
    raise exception 'food directory observation changed; reload' using errcode='PT409';
  end if;
$guard$;
begin
  definition:=pg_get_functiondef('parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,text,text)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
    or strpos(definition,'food directory observation changed; reload')<>0
    or strpos(definition,'if v_job.receipt_wake_lease_token=p_lease_token then')=0
    or strpos(definition,'if v_job.receipt_wake_lease_token=p_lease_token then')>=strpos(definition,anchor) then
    raise exception 'food directory finish guard target changed';
  end if;
  execute replace(definition,anchor,guard||anchor);
end $migration$;
