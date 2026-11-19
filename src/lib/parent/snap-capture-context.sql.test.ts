import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
type Scope = { owner: string; request: string; snapshot: string; version: number; subjects: string[] };
type Context = { requestVersion: number; snapshotId: string; snapshotHash: string; source: Record<string, string>; applyingSubjectIds: string[] };

describe.skipIf(!modulePath)("owned current SNAP preparation context SQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();
  beforeAll(async () => { fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); });
  async function asRole(role: string, user: string, sql: string, values: unknown[] = []) {
    await fixture.admin.query("begin");
    try {
      await fixture.admin.query(`set local role ${role}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, sub: user, session_id: sessions.get(user), amr: [{ method: "otp" }] })]);
      const result = await fixture.admin.query(sql, values); await fixture.admin.query("commit"); return result;
    } catch (error) { await fixture.admin.query("rollback"); throw error; }
  }
  const parent = (owner: string, sql: string, values: unknown[] = []) => asRole("authenticated", owner, sql, values);
  async function setup(prepareOnly = false): Promise<Scope> {
    const owner = randomUUID(), session = randomUUID(); sessions.set(owner, session);
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic context SQL only',approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic preparation only',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1,
      snap_protected_enabled=false,snap_protected_policy_version=null,snap_protected_retention_policy_version=null`, [SNAP_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    const mandate = fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: new Date(Date.now() + 86400000).toISOString(), ...(prepareOnly ? { mode: "prepare_only", allowedActions: ["research", "prepare"] } : {}) });
    const request = (await parent(owner, "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })), JSON.stringify(mandate), randomUUID()])).rows[0].id as string;
    const details = fixtureSnapApplication(new Date());
    const snapshot = (await parent(owner, "select public.parent_save_snap_application_details($1,1,$2,$3,$4) id", [request, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()])).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [request])).rows[0].version as number;
    return { owner, request, snapshot, version, subjects: details.household!.filter(person => person.requestingSnap).map(person => person.id).sort() };
  }
  async function context(scope: Scope, owner = scope.owner, version: number | null = scope.version): Promise<Context> {
    return (await parent(owner, "select public.parent_get_snap_capture_context($1,$2) value", [scope.request, version])).rows[0].value as Context;
  }
  async function cloneLatest(scope: Scope, field: "source" | "provenance") {
    const expression = field === "source" ? "'{}'::jsonb" : "(select jsonb_object_agg(key,value||jsonb_build_object('confirmedAt',now()-interval '46 days','asOf',to_char(now()-interval '46 days','YYYY-MM-DD'))) from jsonb_each(s.provenance))";
    await fixture.admin.query(`insert into public.parent_snap_application_details(request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key,confirmed_paths)
      select request_id,revision+1,base_version,request_version,details,${field === "provenance" ? expression : "provenance"},${field === "source" ? expression : "source"},notice_version,$2,confirmed_paths
      from public.parent_snap_application_details s where id=$1`, [scope.snapshot, randomUUID()]);
  }
  it("returns only exact current owned snapshot/source/subject metadata while protected capture stays closed", async () => {
    const scope = await setup(), result = await context(scope);
    const binding = (await fixture.admin.query("select parent_private.snap_application_binding($1,$2) value", [scope.request, scope.version])).rows[0].value as { snapshotHash: string; snapshot: { source: Record<string, string> } };
    expect(result).toEqual({ requestVersion: scope.version, snapshotId: scope.snapshot, snapshotHash: binding.snapshotHash, source: binding.snapshot.source, applyingSubjectIds: scope.subjects });
    expect(Object.keys(result).sort()).toEqual(["requestVersion", "snapshotId", "snapshotHash", "source", "applyingSubjectIds"].sort());
    expect(JSON.stringify(result)).not.toMatch(/Private Canary|Fixture|Synthetic Street|dateOfBirth|income|details|provenance/);
    expect((await fixture.admin.query("select snap_protected_enabled,snap_protected_policy_version,snap_protected_retention_policy_version from parent_private.processing_controls")).rows[0]).toEqual({ snap_protected_enabled: false, snap_protected_policy_version: null, snap_protected_retention_policy_version: null });
  });
  it("supports ordinary preparation-only permission without protected acquisition or submission permission", async () => {
    const scope = await setup(true); expect(await context(scope)).toMatchObject({ requestVersion: scope.version, snapshotId: scope.snapshot });
  });
  it("denies an expired pinned source review without changing the protected capture gate", async () => {
    const scope = await setup();
    const definition = (await fixture.admin.query("select pg_get_functiondef('public.parent_get_snap_capture_context(uuid,integer)'::regprocedure) source")).rows[0].source as string;
    expect(definition).toContain("2026-12-03T05:00:00Z");
    try {
      await fixture.admin.query(definition.replace("2026-12-03T05:00:00Z", "2000-01-01T00:00:00Z"));
      await expect(context(scope)).rejects.toMatchObject({ code: "42501" });
    } finally { await fixture.admin.query(definition); }
    expect(await context(scope)).toMatchObject({ snapshotId: scope.snapshot });
  });
  it("selects the latest application revision and denies the prior request version", async () => {
    const scope = await setup(), before = await context(scope), details = fixtureSnapApplication(new Date()); details.phone = "215-555-0101";
    const latest = (await parent(scope.owner, "select public.parent_save_snap_application_details($1,$2,$3,$4,$5) id", [scope.request, scope.version, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()])).rows[0].id;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [scope.request])).rows[0].version as number;
    expect(version).toBeGreaterThan(scope.version); await expect(context(scope)).rejects.toMatchObject({ code: "42501" });
    const after = await context(scope, scope.owner, version); expect(after.snapshotId).toBe(latest); expect(after.snapshotHash).not.toBe(before.snapshotHash);
  });
  it("does not create or select a capture intent, operation, personal act or Submit", async () => {
    const scope = await setup();
    const counts = async () => (await fixture.admin.query(`select (select count(*) from parent_private.snap_final_packet_authorizations) capture,
      (select count(*) from public.parent_operations) operations,(select count(*) from parent_private.personal_act_evidence) acts,
      (select count(*) from parent_private.snap_submission_authorizations) submits,(select count(*) from public.parent_events) events`)).rows[0];
    const before = await counts(); await context(scope); await context(scope); expect(await counts()).toEqual(before);
  });
  it.each(["wrong_owner", "no_session", "account_closed", "cancelled", "grant_expired", "wrong_version", "null_version", "zero_version", "processing_closed", "details_closed", "source", "provenance"])("denies %s at the database boundary", async kind => {
    const scope = await setup(); let owner = scope.owner, version: number | null = scope.version;
    if (kind === "wrong_owner") owner = (await setup()).owner;
    if (kind === "no_session") await fixture.admin.query("delete from auth.sessions where id=$1", [sessions.get(scope.owner)]);
    if (kind === "account_closed") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [scope.owner]);
    if (kind === "cancelled") await parent(scope.owner, "select public.parent_control_request($1,'cancel')", [scope.request]);
    if (kind === "grant_expired") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1", [scope.request]);
    if (kind === "wrong_version") version++;
    if (kind === "null_version") version = null;
    if (kind === "zero_version") version = 0;
    if (kind === "processing_closed") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (kind === "details_closed") await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    if (kind === "source" || kind === "provenance") await cloneLatest(scope, kind);
    await expect(context(scope, owner, version)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])("does not grant context access to %s", async role => {
    const scope = await setup(); await expect(asRole(role, scope.owner, "select public.parent_get_snap_capture_context($1,$2)", [scope.request, scope.version])).rejects.toMatchObject({ code: "42501" });
  });
});
