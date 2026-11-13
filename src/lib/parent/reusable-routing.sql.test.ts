import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { intakeSchema, storedIntakeSchema } from "./domain";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("cross-request routing reuse against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  let owner: string, session: string;
  const intake = () => fixtureIntake({ needs: ["food_now"], incomeAmount: null, incomeFrequency: "unknown" });
  const mandate = () => fixtureMandate({ recipientIds: ["philly-food"], allowedData: ["household"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic reuse test',approved_until=now()+interval '1 day'");
  });
  afterAll(async () => { await fixture?.admin.end(); });
  beforeEach(async () => {
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
  });
  async function parent(sql: string, values: unknown[] = []) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function start(zip = "19104") {
    return (await parent("select public.parent_start_request($1,$2,$3) id", [JSON.stringify({ ...intake(), zip }), JSON.stringify(mandate()), randomUUID()])).rows[0].id as string;
  }
  async function candidate() {
    return (await parent("select public.parent_reusable_zip() value")).rows[0].value as { sourceRequestId: string; sourceVersion: number; value: string; confirmedAt: string; expiresAt: string } | null;
  }
  async function reuse(saved: NonNullable<Awaited<ReturnType<typeof candidate>>>, key = randomUUID()) {
    return (await parent("select public.parent_start_request_with_reused_zip($1,$2,$3,$4,$5) id", [JSON.stringify({ ...intake(), zip: saved.value }), JSON.stringify(mandate()), key, saved.sourceRequestId, saved.sourceVersion])).rows[0].id as string;
  }
  async function row(id: string) {
    return (await fixture.admin.query("select *,parent_private.current_intake_fields(id,'food_now') current from public.parent_requests where id=$1", [id])).rows[0];
  }
  it("reuses only the owned ordinary ZIP and keeps its original source date and expiry", async () => {
    const source = await start();
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',to_jsonb(now()-interval '2 days')) where id=$1", [source]);
    const saved = (await candidate())!;
    expect(Object.keys(saved).sort()).toEqual(["confirmedAt", "expiresAt", "sourceRequestId", "sourceVersion", "value"]);
    const target = await row(await reuse(saved));
    expect(target.intake.zip).toBe("19104");
    expect(target.intake_confirmed_at.zip).toBe(saved.confirmedAt);
    expect(target.intake_reuse.zip).toMatchObject({ sourceRequestId: source, confirmedAt: saved.confirmedAt, expiresAt: saved.expiresAt });
    expect(new Date(target.created_at).getTime()).toBeGreaterThan(Date.parse(saved.confirmedAt));
    expect(target.current).toMatchObject({ zip: "19104" });
    expect((await candidate())?.sourceRequestId).toBe(source);
  });
  it("does not guess between conflicting ZIPs or widen exact-need or expired source facts", async () => {
    const source = await start();
    const conflict = await start("19103");
    expect(await candidate()).toBeNull();
    await parent("select public.parent_control_request($1,'cancel')", [conflict]);
    expect((await candidate())?.sourceRequestId).toBe(source);
    await parent("select public.parent_answer_fact($1,'food_now','zip','\"19105\"',1)", [source]);
    expect(await candidate()).toBeNull();
    const fresh = await start();
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',to_jsonb(now()-interval '46 days')) where id=$1", [fresh]);
    expect(await candidate()).toBeNull();
  });
  it("stops pending copied routing when a new original request conflicts, and resumes when resolved", async () => {
    await start(); const target = await reuse((await candidate())!);
    const conflicting = await start("19103");
    expect(await candidate()).toBeNull();
    expect((await row(target)).intake.zip).toBeNull();
    expect((await row(target)).current.zip).toBeUndefined();
    await parent("select public.parent_control_request($1,'cancel')", [conflicting]);
    expect((await row(target)).current.zip).toBe("19104");
    expect((await row(target)).intake.zip).toBe("19104");
  });
  it("rejects another household, a changed source version, an altered ZIP and client metadata writes", async () => {
    const source = await start(); const saved = (await candidate())!;
    await expect(reuse({ ...saved, sourceVersion: saved.sourceVersion + 1 })).rejects.toMatchObject({ code: "P0001" });
    await expect(reuse({ ...saved, value: "19103" })).rejects.toMatchObject({ code: "P0001" });
    const other = randomUUID(), otherSession = randomUUID();
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [other, `${other}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [otherSession, other]);
    owner = other; session = otherSession;
    await start();
    await expect(reuse(saved)).rejects.toMatchObject({ code: "P0001" });
    expect((await parent("select id from public.parent_requests where id=$1", [source])).rows).toEqual([]);
    await expect(parent("update public.parent_requests set intake_reuse='{}' where id=$1", [source])).rejects.toMatchObject({ code: "42501" });
  });
  it("automatically propagates a known unrestricted correction and keeps exact start retries idempotent", async () => {
    const source = await start(); const saved = (await candidate())!; const key = randomUUID();
    const permission = mandate();
    const parameters = [JSON.stringify(intake()), JSON.stringify(permission), key, saved.sourceRequestId, saved.sourceVersion];
    const target = (await parent("select public.parent_start_request_with_reused_zip($1,$2,$3,$4,$5) id", parameters)).rows[0].id as string;
    const before = await row(target);
    await parent("select public.parent_correct_request($1,$2,1)", [source, JSON.stringify({ ...intake(), zip: "19103" })]);
    const changed = await row(target);
    expect(changed.intake.zip).toBe("19103");
    expect(changed.intake_confirmed_at.zip).toBe((await row(source)).intake_confirmed_at.zip);
    expect(changed.version).toBe(Number(before.version) + 1);
    expect(changed.current.zip).toBe("19103");
    expect((await parent("select public.parent_start_request_with_reused_zip($1,$2,$3,$4,$5) id", parameters)).rows[0].id).toBe(target);
    expect((await fixture.admin.query("select count(*)::int count from public.parent_requests where household_id=$1", [before.household_id])).rows[0].count).toBe(2);
  });
  it("does not refresh or requeue borrowed ZIPs on unrelated corrections or mandate renewal", async () => {
    const source = await start(); const target = await reuse((await candidate())!); const before = await row(target);
    await parent("select public.parent_correct_request($1,$2,1)", [source, JSON.stringify({ ...intake(), language: "es" })]);
    expect((await row(target)).version).toBe(before.version);
    await parent("select public.parent_replace_mandate($1,$2,2)", [source, JSON.stringify({ ...mandate(), expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() })]);
    const after = await row(target);
    expect(after.version).toBe(before.version);
    expect(after.intake_confirmed_at.zip).toBe(before.intake_confirmed_at.zip);
    expect(after.intake_reuse.zip.expiresAt).toBe(before.intake_reuse.zip.expiresAt);
    expect(after.current.zip).toBe("19104");
  });
  it("redacts withdrawn sources without laundering freshness and accepts a genuine replacement", async () => {
    const source = await start(); const target = await reuse((await candidate())!); const before = await row(target);
    await parent("select public.parent_control_request($1,'cancel')", [source]);
    const invalid = await row(target);
    expect(invalid.intake.zip).toBeNull(); expect(invalid.current.zip).toBeUndefined();
    expect(invalid.intake_reuse.zip.invalidated).toBe(true);
    expect(invalid.intake_confirmed_at.zip).toBe(before.intake_confirmed_at.zip);
    expect(storedIntakeSchema.safeParse(invalid.intake).success).toBe(true);
    expect(intakeSchema.safeParse(invalid.intake).success).toBe(false);
    await parent("select public.parent_correct_request($1,$2,$3)", [target, JSON.stringify({ ...intake(), zip: "19105" }), invalid.version]);
    const replacement = await row(target);
    expect(replacement.intake_reuse).toEqual({}); expect(replacement.current.zip).toBe("19105");
  });
  it("reuses a completed request's fresh fact under the new mandate after the old execution permission ends", async () => {
    const source = await start(); const target = await reuse((await candidate())!); const before = await row(target);
    await parent("select public.parent_report_outcome($1,'food_now','support_received','Fictional collection report')", [source]);
    await parent("select public.parent_close_request($1,'completed','Fictional completed support','parent','Return for support when needed')", [source]);
    await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb(now()-interval '1 second')) where id=$1", [source]);
    const after = await row(target);
    expect(after.current.zip).toBe("19104");
    expect(after.intake_confirmed_at.zip).toBe(before.intake_confirmed_at.zip);
    expect(after.intake_reuse.zip.expiresAt).toBe(before.intake_reuse.zip.expiresAt);
    expect(after.version).toBe(before.version);
    expect((await row(await reuse((await candidate())!))).current.zip).toBe("19104");
  });
  it("treats a parent's chosen closure as withdrawal, not successful reusable completion", async () => {
    const source = await start(); const target = await reuse((await candidate())!);
    await parent("select public.parent_close_request($1,'parent_choice','No further use from this request','parent','Start again only if chosen')", [source]);
    expect(await candidate()).toBeNull();
    expect((await row(target)).intake.zip).toBeNull();
  });
  it("redacts deleted source copies and preserves the closure retention clock", async () => {
    const source = await start(); const target = await reuse((await candidate())!);
    await fixture.admin.query("update public.parent_requests set status='closed',updated_at=now()-interval '5 days' where id=$1", [target]);
    const before = await row(target);
    await fixture.admin.query("delete from public.parent_requests where id=$1", [source]);
    const after = await row(target);
    expect(after.intake.zip).toBeNull(); expect(after.intake_reuse.zip.invalidated).toBe(true);
    expect(after.updated_at).toEqual(before.updated_at); expect(after.version).toBe(before.version);
  });
  it("blocks expired use before cleanup and independently scrubs the copied value", async () => {
    await start(); const target = await reuse((await candidate())!);
    await fixture.admin.query("update public.parent_requests set intake_reuse=jsonb_set(intake_reuse,'{zip,expiresAt}',to_jsonb(now()-interval '1 second')) where id=$1", [target]);
    expect((await row(target)).current.zip).toBeUndefined();
    await fixture.admin.query("set role parent_retention_worker");
    try { await fixture.admin.query("select parent_private.parent_claim_cleanup(100)"); }
    finally { await fixture.admin.query("reset role"); }
    expect((await row(target)).intake.zip).toBeNull();
  });
  it("accepts a fresh same-value exact-need answer after borrowed routing expires, without widening it", async () => {
    await start(); const target = await reuse((await candidate())!);
    await fixture.admin.query("update public.parent_requests set intake_reuse=jsonb_set(intake_reuse,'{zip,expiresAt}',to_jsonb(now()-interval '1 second')) where id=$1", [target]);
    await parent("select public.parent_answer_fact($1,'food_now','zip','\"19104\"',1)", [target]);
    expect((await row(target)).current.zip).toBe("19104");
    expect((await row(target)).intake_reuse.zip).toHaveProperty("expiresAt");
  });
  it("fails closed when processing is closed and never grants ordinary workers the source reader", async () => {
    await start();
    await fixture.admin.query("set role parent_worker");
    try { await expect(fixture.admin.query("select public.parent_reusable_zip()")).rejects.toMatchObject({ code: "42501" }); }
    finally { await fixture.admin.query("reset role"); }
    await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    try { await expect(candidate()).rejects.toMatchObject({ code: "42501" }); }
    finally { await fixture.admin.query("update parent_private.processing_controls set enabled=true"); }
  });
});
