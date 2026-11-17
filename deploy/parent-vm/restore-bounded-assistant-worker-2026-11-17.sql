-- Two-hour assistant restoration only; other logins and SNAP approvals stay unchanged.
do $restore$
declare r record;
begin
  select * into strict r from pg_roles where rolname='caselink_parent_pilot_worker_20261026';
  if not r.rolcanlogin or r.rolinherit or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolvaliduntil is distinct from '2026-11-11T05:00:00Z'::timestamptz
    or exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.roleid where m.member=r.oid and p.rolname<>'parent_worker')
    or not exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.roleid where m.member=r.oid and p.rolname='parent_worker')
    or not exists(select 1 from parent_private.processing_controls where singleton and enabled and cardinality(pilot_account_ids)=1 and model_call_limit=28 and approved_until='infinity'::timestamptz)
    or '2026-11-17T21:07:45Z'::timestamptz not between clock_timestamp() and clock_timestamp()+interval '2 hours'
  then raise exception 'Unexpected bounded assistant-worker settings; no change'; end if;
  alter role caselink_parent_pilot_worker_20261026 valid until '2026-11-17T21:07:45Z';
end $restore$;
