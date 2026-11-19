import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "./parent-sql-fixture";
import { assertSyntheticParentAuthTargets, beginParentTestApproval } from "./parent-test-approval";

const local = { API_URL: "http://127.0.0.1:55321", DB_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres", MAILPIT_URL: "http://127.0.0.1:55324" };
it("accepts only the exact isolated Auth app, API, inbox and database", () => {
  expect(() => assertSyntheticParentAuthTargets("http://127.0.0.1:3200", local)).not.toThrow();
  for (const [key, value] of [
    ["API_URL", "https://127.0.0.1:55321"], ["API_URL", "http://localhost:55321"], ["API_URL", "http://127.0.0.1:55321/path"],
    ["MAILPIT_URL", "http://127.0.0.1:54324"], ["DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"],
    ["DB_URL", "postgresql://postgres:postgres@db.example.invalid:55322/postgres"], ["DB_URL", "https://127.0.0.1:55322/postgres"],
    ["DB_URL", "postgresql://postgres:postgres@127.0.0.1:55322/other"], ["DB_URL", `${local.DB_URL}?host=remote.invalid`],
  ]) expect(() => assertSyntheticParentAuthTargets("http://127.0.0.1:3200", { ...local, [key]: value })).toThrow();
  expect(() => assertSyntheticParentAuthTargets("http://localhost:3200", local)).toThrow();
});

it("refuses another fixture's lock without changing or releasing it", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ acquired: false }] });
  await expect(beginParentTestApproval({ query }, true)).rejects.toThrow("Another browser test");
  expect(query).toHaveBeenCalledTimes(1);
});

describe.skipIf(!process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE)("bounded local fixture control restoration in PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const read = async () => (await fixture.admin.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value;
  beforeAll(async () => { fixture = await createParentSqlFixture(process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE!); });
  afterAll(async () => { await fixture?.admin.end(); });
  it("opens only a bounded empty closed fixture and restores every column after failure", async () => {
    await fixture.admin.query("alter table parent_private.processing_controls add column future_test_control text default 'preserved'");
    const original = await read();
    const start = Date.now(), approval = await beginParentTestApproval(fixture.admin, true), during = await read();
    expect(during).toMatchObject({ enabled: true, future_test_control: "preserved", pilot_account_ids: null, existing_identity_created_before: null });
    expect(Date.parse(approval.approvedUntil)).toBeGreaterThanOrEqual(start);
    expect(Date.parse(approval.approvedUntil)).toBeLessThanOrEqual(Date.now() + 20 * 60 * 1000);
    try { await fixture.admin.query("update parent_private.processing_controls set wic_details_enabled=true,future_test_control='changed' where singleton"); throw new Error("synthetic body failure"); }
    catch { /* Exercise the caller's unconditional cleanup path. */ }
    finally { await approval.restore(); }
    expect(await read()).toEqual(original);
  });
  it("restores controls when the approval commits but its acknowledgement is lost", async () => {
    const original = await read();
    const db = { async query(sql: string, values?: unknown[]) {
      const result = await fixture.admin.query(sql, values);
      if (sql.includes("returning approved_until")) throw new Error("synthetic lost acknowledgement");
      return result;
    } };
    await expect(beginParentTestApproval(db, true)).rejects.toThrow("synthetic lost acknowledgement");
    expect(await read()).toEqual(original);
  });
  it("refuses an existing cohort, open controls, users and active workers before approval writes", async () => {
    const original = await read();
    for (const sql of [
      "update parent_private.processing_controls set pilot_account_ids='{}' where singleton",
      "update parent_private.processing_controls set enabled=true where singleton",
      "update parent_private.processing_controls set family_profile_enabled=true where singleton",
      "update parent_private.processing_controls set existing_identity_created_before=now() where singleton",
    ]) {
      await fixture.admin.query(sql); const before = await read();
      await expect(beginParentTestApproval(fixture.admin, true)).rejects.toThrow(); expect(await read()).toEqual(before);
      await fixture.admin.query("update parent_private.processing_controls set enabled=false,pilot_account_ids=null,family_profile_enabled=false,existing_identity_created_before=null where singleton");
    }
    await fixture.admin.query("insert into auth.users(id,email) values(gen_random_uuid(),'occupied@example.invalid')");
    await expect(beginParentTestApproval(fixture.admin, true)).rejects.toThrow("empty stack");
    await fixture.admin.query("delete from auth.users where email='occupied@example.invalid'");
    await fixture.admin.query("insert into parent_private.provider_capabilities(program_id,action,enabled,permission_version,permission_reference,verified_until) values('philly-food','share',true,'synthetic-approval-test','synthetic only',now()+interval '1 minute')");
    await expect(beginParentTestApproval(fixture.admin, true)).rejects.toThrow("empty stack");
    await fixture.admin.query("delete from parent_private.provider_capabilities where permission_version='synthetic-approval-test'");
    await fixture.admin.query("insert into parent_private.worker_health(singleton,heartbeat_at,expires_at) values(true,now(),now()+interval '1 minute')");
    await expect(beginParentTestApproval(fixture.admin, true)).rejects.toThrow("empty stack");
    await fixture.admin.query("delete from parent_private.worker_health"); expect(await read()).toEqual(original);
  });
  it("preserves the existing explicit browser-fixture approval behavior and exact restoration", async () => {
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='prior isolated approval',approved_until=now()+interval '5 minutes' where singleton");
    const original = await read(), approval = await beginParentTestApproval(fixture.admin);
    await approval.restore(); expect(await read()).toEqual(original);
  });
});
