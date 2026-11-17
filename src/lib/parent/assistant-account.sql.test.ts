import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
it.skipIf(!modulePath)("claims only current preferences for the selected request owner and preserves account isolation", async () => {
  const { admin } = await createParentSqlFixture(modulePath!);
  const owner = randomUUID(), other = randomUUID(), household = randomUUID(), otherHousehold = randomUUID(), request = randomUUID(), otherRequest = randomUUID(), session = randomUUID();
  try {
    await admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic assistant account context',approved_until=now()+interval '1 day'");
    await admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.invalid',now()),($2,'other@example.invalid',now())", [owner, other]);
    await admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [session, owner]);
    await admin.query("insert into public.parent_accounts(id) values($1),($2)", [owner, other]);
    await admin.query("insert into public.parent_households(id,owner_id) values($1,$2),($3,$4)", [household, owner, otherHousehold, other]);
    await admin.query("insert into public.parent_requests(id,household_id,intake,mandate) values($1,$2,$3,$4),($5,$6,$3,$4)", [request, household, JSON.stringify(fixtureIntake()), JSON.stringify(fixtureMandate()), otherRequest, otherHousehold]);
    await admin.query("set role parent_worker");
    await admin.query("select parent_private.parent_record_worker_health(false,true)");
    await admin.query("reset role");
    await admin.query("set role authenticated");
    await admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, amr: [{ method: "password" }] })]);
    await expect(admin.query("select public.parent_ask_assistant($1,'Which updates did I choose?',$2,true)", [otherRequest, randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await admin.query("select public.parent_ask_assistant($1,'Which updates did I choose?',$2,true)", [request, randomUUID()]);
    await admin.query("reset role");
    const preferences = { contactPreference: "in_app", language: "es", quietHoursStart: 20, quietHoursEnd: 8, secret: "never-send-this" };
    await admin.query("update public.parent_accounts set preferences=$1,updated_at=now() where id=$2", [JSON.stringify(preferences), owner]);
    await admin.query("set role parent_worker");
    const claim = (await admin.query("select parent_private.parent_claim_assistant() value")).rows[0].value;
    expect(claim.request.id).toBe(request);
    expect(claim.account).toMatchObject({ contactPreference: "in_app", language: "es", quietHoursStart: 20, quietHoursEnd: 8 });
    expect(Object.keys(claim.account).sort()).toEqual(["contactPreference", "language", "quietHoursEnd", "quietHoursStart", "updatedAt"]);
    expect(JSON.stringify(claim.account)).not.toMatch(/owner@example|other@example|never-send|secret/);
    await expect(admin.query("select preferences from public.parent_accounts")).rejects.toMatchObject({ code: "42501" });
  } finally { await admin.query("reset role"); await admin.end(); }
});
