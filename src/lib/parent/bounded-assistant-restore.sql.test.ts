import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
it.skipIf(!modulePath)("restores only the restricted assistant login within two hours and rejects broader roles", async () => {
  const { admin } = await createParentSqlFixture(modulePath!);
  const deadline = new Date(Date.now() + 3600_000).toISOString();
  // The dated operational transaction is replayed with a future synthetic deadline.
  const sql = readFileSync("deploy/parent-vm/restore-bounded-assistant-worker-2026-11-17.sql", "utf8").replaceAll("2026-11-17T21:07:45Z", deadline);
  try {
    await admin.query("create role caselink_parent_pilot_worker_20261026 login noinherit valid until '2026-11-11T05:00:00Z'");
    await admin.query("grant parent_worker to caselink_parent_pilot_worker_20261026");
    await admin.query("create role synthetic_unrelated login valid until '2026-11-11T05:00:00Z'");
    await admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic bounded assistant test',approved_until='infinity',pilot_account_ids=array[$1::uuid],model_call_limit=28,model_budget_started_at=now()", [randomUUID()]);
    const before = (await admin.query("select to_jsonb(c) value from parent_private.processing_controls c")).rows[0].value;
    await admin.query(sql);
    expect((await admin.query("select rolvaliduntil=$1::timestamptz valid from pg_roles where rolname='caselink_parent_pilot_worker_20261026'", [deadline])).rows[0].valid).toBe(true);
    expect((await admin.query("select rolvaliduntil='2026-11-11T05:00:00Z'::timestamptz unchanged from pg_roles where rolname='synthetic_unrelated'")).rows[0].unchanged).toBe(true);
    expect((await admin.query("select to_jsonb(c) value from parent_private.processing_controls c")).rows[0].value).toEqual(before);
    await admin.query("alter role caselink_parent_pilot_worker_20261026 valid until '2026-11-11T05:00:00Z'");
    await admin.query("grant synthetic_unrelated to caselink_parent_pilot_worker_20261026");
    await expect(admin.query(sql)).rejects.toThrow("Unexpected bounded assistant-worker settings");
    await admin.query("revoke synthetic_unrelated from caselink_parent_pilot_worker_20261026");
    await expect(admin.query(sql.replaceAll(deadline, new Date(Date.now() + 3 * 3600_000).toISOString()))).rejects.toThrow("Unexpected bounded assistant-worker settings");
  } finally { await admin.end(); }
});

it.skipIf(!modulePath)("keeps the unapplied permanent transaction compatible with the bounded worker and refuses an unrestricted cohort", async () => {
  const { admin } = await createParentSqlFixture(modulePath!);
  const sql = readFileSync("deploy/parent-vm/enable-ongoing-existing-services.sql", "utf8");
  try {
    await admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic permanent candidate only',approved_until='infinity',existing_accounts_enabled=true,existing_identity_created_before=now(),pilot_account_ids=null,snap_details_enabled=true,snap_details_approved_until='2026-11-11T05:00:00Z',snap_protected_enabled=true,snap_protected_approved_until='2026-11-11T04:00:00Z'");
    await expect(admin.query(sql)).rejects.toThrow("Expected existing owner-scoped operating settings");
    await admin.query("update parent_private.processing_controls set pilot_account_ids=array[$1::uuid]", [randomUUID()]);
    const roles = ["caselink_parent_pilot_worker_20261026", "caselink_parent_pilot_broker_20261026", "caselink_parent_pilot_retention_20261026", "caselink_parent_pilot_finalizer_20261109", "caselink_parent_pilot_ordinary_retention_20261109"];
    for (const role of roles) await admin.query(`create role ${role} login noinherit valid until '${role === roles[0] ? "2026-11-17T21:07:45Z" : "2026-11-11T05:00:00Z"}'`);
    const before = (await admin.query("select to_jsonb(c)-array['snap_details_approved_until','snap_details_approval_reference','snap_protected_approved_until','snap_protected_approval_reference','updated_at'] value from parent_private.processing_controls c")).rows[0].value;
    await admin.query(sql);
    expect((await admin.query("select count(*)::int total from pg_roles where rolname=any($1::text[]) and rolvaliduntil='infinity'::timestamptz and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication", [roles])).rows[0].total).toBe(5);
    expect((await admin.query("select to_jsonb(c)-array['snap_details_approved_until','snap_details_approval_reference','snap_protected_approved_until','snap_protected_approval_reference','updated_at'] value from parent_private.processing_controls c")).rows[0].value).toEqual(before);
  } finally { await admin.end(); }
});
