import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("ongoing parent availability against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  let owner: string, session: string;
  beforeAll(async () => { fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); });
  beforeEach(async () => {
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='owner-approved ongoing service',approved_until='infinity'::timestamptz,existing_accounts_enabled=true,pilot_account_ids=null,existing_identity_created_before=null");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [session, owner]);
  });
  async function parent(sql: string, values: unknown[] = []) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "password" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  const ensure = () => parent("select public.parent_ensure_account() household");
  const enabled = async () => (await fixture.admin.query("select parent_private.processing_enabled() enabled")).rows[0].enabled;
  it("permits ongoing sign-in, owned reads and a bounded family mandate without a demo deadline", async () => {
    expect(await enabled()).toBe(true);
    expect((await fixture.admin.query("select approved_until>now()+interval '100 years' ongoing from parent_private.processing_controls")).rows[0].ongoing).toBe(true);
    const household = (await ensure()).rows[0].household;
    expect((await parent("select id from public.parent_households")).rows).toContainEqual({ id: household });
    const window = (await parent("select public.parent_authorization_window() value")).rows[0].value;
    expect(Date.parse(window.expiresAt) - Date.parse(window.issuedAt)).toBe(30 * 86400000);
    const request = (await parent("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["food_now"], incomeAmount: null, incomeFrequency: "unknown" })),
      JSON.stringify(fixtureMandate({ recipientIds: ["philly-food"], allowedData: ["household"], expiresAt: new Date(Date.now() + 86400000).toISOString() })), randomUUID()])).rows[0].id;
    expect((await fixture.admin.query("select parent_private.current_grant($1,1) allowed", [request])).rows[0].allowed).toBe(true);
    await parent("select public.parent_control_request($1,'cancel')", [request]);
    expect((await fixture.admin.query("select parent_private.current_grant($1,1) allowed", [request])).rows[0].allowed).toBe(false);
    expect((await ensure()).rows[0].household).toBe(household);
  });
  it.each(["enabled=false", "approval_reference=null", "approved_until=null", "approved_until=now()-interval '1 second'"])("keeps explicit closure and finite expiry effective: %s", async assignment => {
    await fixture.admin.query(`update parent_private.processing_controls set ${assignment}`);
    expect(await enabled()).toBe(false);
    await expect(ensure()).rejects.toMatchObject({ code: "42501" });
  });
  it("preserves cohort restrictions, current sessions and owner-only configuration", async () => {
    await ensure();
    await expect(parent("update parent_private.processing_controls set enabled=true")).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update parent_private.processing_controls set pilot_account_ids='{}'");
    await expect(ensure()).rejects.toMatchObject({ code: "42501" });
    expect((await parent("select id from public.parent_households")).rows).toEqual([]);
    await fixture.admin.query("update parent_private.processing_controls set pilot_account_ids=null");
    await fixture.admin.query("delete from auth.sessions where id=$1", [session]);
    await expect(ensure()).rejects.toMatchObject({ code: "42501" });
  });
  it("applies the actual live activation transaction without widening the cohort or changing program controls", async () => {
    await fixture.admin.query("update parent_private.processing_controls set approved_until=now()-interval '1 day',existing_identity_created_before=now()+interval '1 hour',pilot_account_ids=array[$1::uuid]", [owner]);
    const before = (await fixture.admin.query("select to_jsonb(c)-array['enabled','approval_reference','approved_until','updated_at'] value from parent_private.processing_controls c")).rows[0].value;
    await expect(ensure()).rejects.toMatchObject({ code: "42501" });
    const script = readFileSync("deploy/parent-vm/enable-ongoing-access.sql", "utf8");
    await fixture.admin.query(script);
    const household = (await ensure()).rows[0].household;
    await fixture.admin.query(script);
    expect((await ensure()).rows[0].household).toBe(household);
    expect((await fixture.admin.query("select to_jsonb(c)-array['enabled','approval_reference','approved_until','updated_at'] value from parent_private.processing_controls c")).rows[0].value).toEqual(before);
  });
  it("refuses live activation against an unexpected or unrestricted cohort", async () => {
    await fixture.admin.query("update parent_private.processing_controls set approved_until=now()-interval '1 day'");
    await expect(fixture.admin.query(readFileSync("deploy/parent-vm/enable-ongoing-access.sql", "utf8"))).rejects.toThrow("Expected the existing owner-scoped");
    expect(await enabled()).toBe(false);
  });
});
