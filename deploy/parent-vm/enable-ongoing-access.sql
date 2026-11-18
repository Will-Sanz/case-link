-- Original CaseLink project only: zpfypkizsapvsxeykmdq.
-- Owner authorized ongoing access on November 17, 2026. Preserve the existing account cohort and all program controls.
do $ongoing_access$
declare c parent_private.processing_controls;
begin
  select * into strict c from parent_private.processing_controls where singleton for update;
  if not c.existing_accounts_enabled or c.existing_identity_created_before is null
    or coalesce(cardinality(c.pilot_account_ids),0)<>1 then
    raise exception 'Expected the existing owner-scoped CaseLink deployment; no access changed';
  end if;
  update parent_private.processing_controls set enabled=true,
    approval_reference='Owner authorized ongoing CaseLink access on 2026-11-17; existing cohort and program permissions preserved',
    approved_until='infinity'::timestamptz,updated_at=clock_timestamp()
    where singleton;
  if not parent_private.processing_enabled() then raise exception 'Ongoing access verification failed'; end if;
end
$ongoing_access$;
