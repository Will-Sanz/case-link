-- Owner approved removing the listed operating expiries on November 17, 2026.
-- Existing six service logins and enabled SNAP purposes only; sender remains disabled.
-- Preserve passwords, memberships, cohort, provider flags and model ledger.
do $ongoing$
declare c parent_private.processing_controls; r record; n integer := 0;
begin
  select * into strict c from parent_private.processing_controls where singleton for update;
  if not c.enabled or c.approved_until <> 'infinity'::timestamptz
    or cardinality(c.pilot_account_ids) is distinct from 1 or not c.existing_accounts_enabled
    or c.existing_identity_created_before is null
    or not c.snap_details_enabled or not c.snap_protected_enabled
    or c.snap_details_approved_until is distinct from '2026-11-11T05:00:00Z'::timestamptz
    or c.snap_protected_approved_until is distinct from '2026-11-11T04:00:00Z'::timestamptz
  then raise exception 'Expected existing owner-scoped operating settings; no change'; end if;
  for r in select * from pg_roles where rolname in (
    'caselink_parent_pilot_worker_20261026', 'caselink_parent_pilot_broker_20261026',
    'caselink_parent_pilot_retention_20261026', 'caselink_parent_pilot_finalizer_20261109',
    'caselink_parent_pilot_ordinary_retention_20261109', 'caselink_parent_pilot_sender_20261109')
  loop
    if not r.rolcanlogin or r.rolinherit or r.rolsuper or r.rolbypassrls or r.rolcreaterole
      or r.rolcreatedb or r.rolreplication
      or r.rolvaliduntil is distinct from (case when r.rolname='caselink_parent_pilot_worker_20261026'
        then '2026-11-17T21:07:45Z'::timestamptz else '2026-11-11T05:00:00Z'::timestamptz end)
      or (select array_agg(p.rolname::text order by p.rolname) from pg_auth_members m join pg_roles p on p.oid=m.roleid where m.member=r.oid)
        is distinct from array[case r.rolname
          when 'caselink_parent_pilot_worker_20261026' then 'parent_worker'
          when 'caselink_parent_pilot_broker_20261026' then 'parent_storage_broker'
          when 'caselink_parent_pilot_finalizer_20261109' then 'parent_snap_finalizer'
          when 'caselink_parent_pilot_sender_20261109' then 'parent_snap_sender'
          else 'parent_retention_worker' end]
    then raise exception 'Unexpected existing service role; no change'; end if;
    execute format('alter role %I valid until %L', r.rolname, 'infinity');
    n := n + 1;
  end loop;
  if n <> 6 then raise exception 'Expected six existing service logins'; end if;
  update parent_private.processing_controls set
    snap_details_approved_until='infinity'::timestamptz,
    snap_details_approval_reference='Owner explicitly approved ongoing existing SNAP details processing on 2026-11-17; existing purpose, notice, cohort and retention preserved',
    snap_protected_approved_until='infinity'::timestamptz,
    snap_protected_approval_reference='Owner explicitly approved ongoing existing protected SNAP processing on 2026-11-17; existing policy, retention and provider controls preserved',
    updated_at=clock_timestamp()
  where singleton;
end $ongoing$;
