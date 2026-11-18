-- A joined candidate scan can see an older job row after another worker has committed its lease.
do $migration$
declare definition text; predicate text; first_position integer; last_position integer;
  anchor text:='select * into v_job from public.parent_jobs where request_id=v_request_id for update;';
begin
  select pg_get_functiondef('parent_private.parent_claim_job(integer,boolean,boolean,boolean)'::regprocedure) into definition;
  first_position:=strpos(definition,'    where ((j.state');
  last_position:=strpos(definition,'    order by j.run_at for update of r skip locked limit 1;');
  if first_position=0 or last_position<=first_position
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
    then raise exception 'job claim recheck anchor changed'; end if;
  -- Reuse the exact eligibility predicate, including bounded attempts and parked mixed-work prerequisites.
  predicate:=substr(definition,first_position+length('    where '),last_position-first_position-length('    where '));
  execute replace(definition,anchor,anchor||E'\n  if not exists(select 1 from public.parent_requests r where r.id=v_request_id and ('
    ||replace(predicate,'j.','v_job.')||E')) then return null; end if;');
end $migration$;
