import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { SHARE_FOOD_ACCESS_PROGRAM } from "./food-access";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("post-selection durable job claim checks", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, definition: string;
  const owner = randomUUID(), session = randomUUID();
  const anchor = "select * into v_job from public.parent_jobs where request_id=v_request_id for update;";
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic claim race',approved_until=now()+interval '1 day'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 day')", [session, owner]);
    await asParent("select public.parent_ensure_account()", []);
    definition = (await fixture.admin.query("select pg_get_functiondef('parent_private.parent_claim_job(integer,boolean,boolean,boolean)'::regprocedure) source")).rows[0].source;
    expect(definition.split(anchor)).toHaveLength(2);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function asParent(sql: string, values: unknown[]) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role: "authenticated", session_id: session, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function start() {
    await fixture.admin.query("update public.parent_jobs set state='cancelled',lease_token=null,lease_until=null");
    return (await asParent("select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: ["food_now"], zip: "19129", householdSize: null, incomeAmount: null, utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: [SHARE_FOOD_ACCESS_PROGRAM], allowedActions: ["research", "prepare"], allowedData: ["household"], expiresAt: new Date(Date.now() + 86400000).toISOString() })), randomUUID(),
    ])).rows[0].id;
  }
  it.each([
    "state='leased',lease_token='11111111-1111-4111-8111-111111111111',lease_until=now()+interval '2 minutes'",
    "state='waiting',run_at=now()+interval '1 hour'",
    "state='waiting',run_at='infinity'",
    "state='done'", "state='cancelled'", "state='failed'", "attempts=48",
  ])("does not overwrite a job changed after candidate selection: %s", async change => {
    const id = await start();
    // Force the state a concurrent commit can expose between the joined candidate scan and locked job read.
    const injected = definition.replace(anchor, `update public.parent_jobs set ${change} where request_id=v_request_id; ${anchor}`);
    await fixture.admin.query(injected);
    try {
      await fixture.admin.query("set role parent_worker");
      const claimed = await fixture.admin.query("select parent_private.parent_claim_job(15,true,false,false) job");
      expect(claimed.rows[0].job).toBeNull();
    } finally {
      await fixture.admin.query("reset role");
      await fixture.admin.query(definition);
    }
    const job = (await fixture.admin.query("select state,attempts,lease_token,lease_until,run_at from public.parent_jobs where request_id=$1", [id])).rows[0];
    if (change.startsWith("state='leased'")) expect(job.lease_token).toBe("11111111-1111-4111-8111-111111111111");
    else if (change === "attempts=48") expect(job).toMatchObject({ state: "queued", attempts: 48 });
    else expect(job.state).toBe(change.match(/state='([^']+)'/)![1]);
  });
  it("continues to reclaim an expired lease with a fresh token", async () => {
    const id = await start();
    await fixture.admin.query("update public.parent_jobs set state='leased',lease_token=$2,lease_until=now()-interval '1 second' where request_id=$1", [id, "11111111-1111-4111-8111-111111111111"]);
    await fixture.admin.query("set role parent_worker");
    try {
      const claim = (await fixture.admin.query("select parent_private.parent_claim_job(15,true,false,false) job")).rows[0].job;
      expect(claim.request.id).toBe(id); expect(claim.leaseToken).not.toBe("11111111-1111-4111-8111-111111111111");
    } finally { await fixture.admin.query("reset role"); }
  });
});
