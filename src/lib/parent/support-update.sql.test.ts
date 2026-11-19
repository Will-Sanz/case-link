import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("owned exact support-update receipts, without native concurrency claims", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), other = randomUUID(), sessions = new Map([owner, other].map(id => [id, randomUUID()]));
  async function query(sql: string, values: unknown[] = [], user = owner, role = "authenticated") {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: sessions.get(user), role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic support-update proof',approved_until=now()+interval '1 day'");
    for (const id of [owner, other]) {
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [sessions.get(id), id]);
    }
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function start() {
    const rows = await query("select id from public.parent_requests where status in ('active','paused')");
    for (const row of rows.rows) await query("select public.parent_control_request($1,'cancel')", [row.id]);
    return (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["food_now", "electricity"] })), JSON.stringify(fixtureMandate({ recipientIds: ["philly-food", "peco-cap"], expiresAt: new Date(Date.now() + 86400000).toISOString() })), randomUUID()])).rows[0].id as string;
  }
  async function snapshot(id: string) {
    return (await fixture.admin.query("select to_jsonb(r) request,(select to_jsonb(j) from public.parent_jobs j where j.request_id=r.id) job,(select jsonb_agg(to_jsonb(e) order by e.id) from public.parent_events e where e.request_id=r.id) events from public.parent_requests r where r.id=$1", [id])).rows[0];
  }
  const apply = async (id: string, key: string, update: unknown, user = owner) => (await query("select public.parent_apply_support_update($1,$2,$3) receipt", [id, key, JSON.stringify(update)], user)).rows[0].receipt as { id: string; key: string; requestId: string; action: string; baseVersion: number; resultVersion: number };
  const fact = (version = 1) => ({ action: "answer_fact", version, need: "food_now", field: "zip", value: "19129" });

  it("commits once and exactly acknowledges the original fact after a lost response", async () => {
    const id = await start(), key = randomUUID(), update = fact();
    const receipt = await apply(id, key, update), after = await snapshot(id);
    expect(receipt).toMatchObject({ key, requestId: id, action: "answer_fact", baseVersion: 1, resultVersion: 2 });
    expect(await apply(id, key, update)).toEqual(receipt); expect(await snapshot(id)).toEqual(after);
    expect((await query("select count(*)::int count from public.parent_support_update_receipts where request_id=$1", [id])).rows[0].count).toBe(1);
  });
  it("keeps bundle result versions and all-or-nothing validation without raw receipt payloads", async () => {
    const id = await start(), key = randomUUID(), answers = [{ need: "food_now", field: "zip", value: "19129" }, { need: "food_now", field: "householdSize", value: 4 }, { need: "food_now", field: "income", value: { amount: 0, frequency: "weekly" } }];
    const receipt = await apply(id, key, { action: "answer_facts", version: 1, answers }); expect(receipt.resultVersion).toBe(4);
    const before = await snapshot(id);
    await expect(apply(id, randomUUID(), { action: "answer_facts", version: 4, answers: [answers[0], { ...answers[1], value: -1 }] })).rejects.toThrow();
    expect(await snapshot(id)).toEqual(before);
    const stored = (await query("select to_jsonb(r) value from public.parent_support_update_receipts r where request_id=$1", [id])).rows[0].value as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["id", "request_id", "idempotency_key", "action", "base_version", "result_version", "payload_hash", "created_at"].sort());
    expect(stored.payload_hash).toMatch(/^[a-f0-9]{64}$/); expect(stored).not.toHaveProperty("answers");
  });
  it("records an identical mandate even when its immutable mandate snapshot is omitted", async () => {
    const id = await start(), key = randomUUID(), before = await snapshot(id), mandate = (before.request as Record<string, unknown>).mandate;
    const count = (await query("select count(*)::int count from public.parent_mandates where request_id=$1", [id])).rows[0].count;
    const receipt = await apply(id, key, { action: "replace_mandate", version: 1, mandate }); expect(receipt.resultVersion).toBe(2);
    expect((await query("select count(*)::int count from public.parent_mandates where request_id=$1", [id])).rows[0].count).toBe(count);
    await query("select public.parent_control_request($1,'cancel')", [id]); const cancelled = await snapshot(id);
    expect(await apply(id, key, { action: "replace_mandate", version: 1, mandate })).toEqual(receipt); expect(await snapshot(id)).toEqual(cancelled);
  });
  it("keeps an earlier exact receipt after later corrections and rejects a changed body or competing key", async () => {
    const id = await start(), key = randomUUID(), receipt = await apply(id, key, fact());
    await apply(id, randomUUID(), { ...fact(2), value: "19104" }); const changed = await snapshot(id);
    expect(await apply(id, key, fact())).toEqual(receipt);
    await expect(apply(id, key, { ...fact(), value: "19103" })).rejects.toMatchObject({ code: "PT409" });
    await expect(apply(id, randomUUID(), fact())).rejects.toMatchObject({ code: "PT409" }); expect(await snapshot(id)).toEqual(changed);
  });
  it("pairs booking changes with one immutable receipt and never repeats them", async () => {
    const id = await start(), key = randomUUID(), body = { action: "booking_preference", version: 1, preference: "weekday_afternoon" };
    const receipt = await apply(id, key, body), after = await snapshot(id); expect(receipt.resultVersion).toBe(2);
    expect(await apply(id, key, body)).toEqual(receipt); expect(await snapshot(id)).toEqual(after);
  });
  it("canonicalizes object keys while binding array order, exact action and each request", async () => {
    const id = await start(), key = randomUUID(), body = { action: "answer_facts", version: 1, answers: [
      { need: "food_now", field: "zip", value: "19129" }, { need: "food_now", field: "householdSize", value: 4 },
    ] };
    const receipt = await apply(id, key, body), after = await snapshot(id);
    expect(await apply(id, key, { answers: body.answers.map(answer => ({ value: answer.value, field: answer.field, need: answer.need })), version: 1, action: "answer_facts" })).toEqual(receipt);
    await expect(apply(id, key, { ...body, answers: [...body.answers].reverse() })).rejects.toMatchObject({ code: "PT409" });
    await expect(apply(id, randomUUID(), { action: "cancel", version: 3 })).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot(id)).toEqual(after);
    const next = await start(); expect((await apply(next, key, fact())).requestId).toBe(next);
  });
  it("acknowledges an old receipt after permission expiry without renewing or reapplying it", async () => {
    const id = await start(), key = randomUUID(), before = await snapshot(id), mandate = (before.request as Record<string, unknown>).mandate;
    const receipt = await apply(id, key, { action: "replace_mandate", version: 1, mandate });
    await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1", [id]);
    const expired = await snapshot(id);
    expect(await apply(id, key, { action: "replace_mandate", version: 1, mandate })).toEqual(receipt);
    await expect(apply(id, randomUUID(), { action: "replace_mandate", version: 2, mandate: (expired.request as Record<string, unknown>).mandate })).rejects.toMatchObject({ code: "23514" });
    await expect(apply(id, randomUUID(), { action: "booking_preference", version: 2, preference: "any_weekday" })).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot(id)).toEqual(expired);
  });
  it("denies historical receipt access after the parent account or actual session is no longer current", async () => {
    const id = await start(), key = randomUUID(); await apply(id, key, fact());
    await fixture.admin.query("update public.parent_accounts set status='security_hold' where id=$1", [owner]);
    expect((await query("select * from public.parent_support_update_receipts where request_id=$1", [id])).rows).toEqual([]);
    await expect(apply(id, key, fact())).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update public.parent_accounts set status='active' where id=$1", [owner]);
    await fixture.admin.query("delete from auth.sessions where id=$1", [sessions.get(owner)]);
    await expect(apply(id, key, fact())).rejects.toMatchObject({ code: "42501" });
    expect((await query("select * from public.parent_support_update_receipts where request_id=$1", [id])).rows).toEqual([]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [sessions.get(owner), owner]);
  });
  it("keeps receipts owned, read-only and request-cascaded", async () => {
    const id = await start(), key = randomUUID(); await apply(id, key, fact());
    expect((await query("select * from public.parent_support_update_receipts where request_id=$1", [id], other)).rows).toEqual([]);
    await expect(apply(id, key, fact(), other)).rejects.toMatchObject({ code: "42501" });
    await expect(query("delete from public.parent_support_update_receipts where request_id=$1", [id])).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon", "service_role", "parent_worker", "parent_retention_worker"]) {
      await expect(query("select public.parent_apply_support_update($1,$2,$3)", [id, key, JSON.stringify(fact())], owner, role)).rejects.toMatchObject({ code: "42501" });
    }
    await fixture.admin.query("delete from public.parent_requests where id=$1", [id]);
    expect((await fixture.admin.query("select count(*)::int count from public.parent_support_update_receipts where request_id=$1", [id])).rows[0].count).toBe(0);
  });
});
