import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { APIRequestContext } from "@playwright/test";
import { fixtureIntake, fixtureMandate } from "../src/lib/parent/test-fixtures";
import { supportUpdateReceiptSchema, type SupportUpdate } from "../src/lib/parent/support-update";

/** Called only by the existing loopback Auth rehearsal, after its first real sign-in. */
export async function verifyNativeSupportUpdates({ origin, databaseUrl, api, token, ownerId, admin, check }: {
  origin: string; databaseUrl: string; api: APIRequestContext; token: string; ownerId: string; admin: Client;
  check: (condition: unknown, label: string) => void;
}) {
  const site = new URL(origin), database = new URL(databaseUrl);
  assert.ok(site.protocol === "http:" && ["127.0.0.1", "localhost"].includes(site.hostname) && site.origin === origin);
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && database.port === "55322");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.ok(claims.sub === ownerId && claims.role === "authenticated" && typeof claims.session_id === "string");
  const clients = [0, 1].map(() => new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 5000 }));
  let id: string | undefined;
  try {
    await Promise.all(clients.map(client => client.connect()));
    const timing = await api.get(`${origin}/api/parent/authorization-window`);
    check(timing.status() === 200, "Native support edits use the existing real server authorization window.");
    const expiresAt = (await timing.json()).authorization.expiresAt as string;
    const created = await api.post(`${origin}/api/parent/requests`, { headers: { origin, "Idempotency-Key": randomUUID() }, data: {
      intake: fixtureIntake({ needs: ["food_now"], zip: "19104" }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["philly-food"], allowedActions: ["research", "prepare"], allowedData: ["household"], maxRecipients: 1, expiresAt }),
    } });
    check(created.status() === 201, "The support-edit proof creates a separate temporary actual owned request.");
    const request = (await created.json()).request; id = request.id;
    assert.ok(typeof id === "string");
    const url = `${origin}/api/parent/requests/${id}`;
    const post = (key: string, value: SupportUpdate) => api.post(url, { headers: { origin, "Idempotency-Key": key }, data: value });
    const snapshot = async () => (await admin.query(`select to_jsonb(r) request,
      (select to_jsonb(j) from public.parent_jobs j where j.request_id=r.id) job,
      (select jsonb_agg(to_jsonb(e) order by e.id) from public.parent_events e where e.request_id=r.id) events,
      (select jsonb_agg(to_jsonb(m) order by m.id) from public.parent_mandates m where m.request_id=r.id) mandates
      from public.parent_requests r where r.id=$1`, [id])).rows[0];
    const bodies: SupportUpdate[] = [
      { action: "answer_fact", version: 1, need: "food_now", field: "householdSize", value: 4 },
      { action: "answer_facts", version: 2, answers: [{ need: "food_now", field: "zip", value: "19104" }, { need: "food_now", field: "householdSize", value: 5 }] },
      { action: "replace_mandate", version: 4, mandate: request.mandate },
      { action: "booking_preference", version: 5, preference: "weekday_morning" },
    ];
    const keys = bodies.map(() => randomUUID());
    for (const [index, body] of bodies.entries()) {
      const first = await post(keys[index], body);
      check(first.status() === 200, `Actual ${body.action} commits through the keyed HTTP route.`);
      // Deliberately discard the first HTTP acknowledgement. The next request
      // must prove that exact body, not infer it from current values.
      await first.dispose();
      const saved = await snapshot();
      const read = await api.get(`${url}?updateKey=${keys[index]}`);
      check(read.status() === 200 && read.headers()["cache-control"] === "private, no-store", "Actual owned recovery reads are uncached.");
      const context = (await read.json()).update;
      check(context.ownerId === ownerId && context.receipt?.key === keys[index] && context.expiresAt === null,
        "A recorded support edit has an owned receipt and does not quote renewed permission.");
      const repeated = await post(keys[index], body);
      check(repeated.status() === 200, "The original accepted bytes/key acknowledge a deliberately discarded HTTP response.");
      assert.deepEqual((await repeated.json()).update.receipt, context.receipt);
      assert.deepEqual(await snapshot(), saved);
      check(true, "Exact native acknowledgement leaves facts, job, events and mandate history unchanged.");
    }
    const nativeApply = async (client: Client, key: string, body: SupportUpdate) => {
      await client.query("begin");
      try {
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
        const result = await client.query("select public.parent_apply_support_update($1,$2,$3) receipt", [id, key, JSON.stringify(body)]);
        await client.query("commit"); return supportUpdateReceiptSchema.parse(result.rows[0].receipt);
      } catch (cause) { await client.query("rollback"); throw cause; }
    };
    const sharedKey = randomUUID(), same: SupportUpdate = { action: "answer_fact", version: 6, need: "food_now", field: "householdSize", value: 6 };
    const sameReceipts = await Promise.all(clients.map(client => nativeApply(client, sharedKey, same)));
    assert.deepEqual(sameReceipts[0], sameReceipts[1]);
    check((await snapshot()).request.version === 7, "Two actual SQL connections with one key create one receipt and one mutation.");
    const beforeRace = await snapshot();
    const competing = await Promise.allSettled(clients.map((client, index) => nativeApply(client, randomUUID(), { ...same, version: 7, value: index + 7 })));
    check(competing.filter(value => value.status === "fulfilled").length === 1 && competing.filter(value => value.status === "rejected" && value.reason.code === "PT409").length === 1,
      "Two actual SQL connections with different keys and one base version admit one write and one genuine HTTP-mapped conflict.");
    check((await snapshot()).request.version === beforeRace.request.version + 1, "A competing support edit never repeats or overwrites the winning version.");
    const beforeInvalid = await snapshot();
    const rejectedPermission = await post(randomUUID(), { action: "replace_mandate", version: 8, mandate: { ...request.mandate, expiresAt: "2020-01-01T00:00:00Z" } });
    check(rejectedPermission.status() === 400 && (await rejectedPermission.json()).supportUpdateRejected === true,
      "Only an actual rolled-back keyed validation failure explicitly marks the edit as rejected.");
    assert.deepEqual(await snapshot(), beforeInvalid);
    await assert.rejects(() => nativeApply(clients[0], randomUUID(), { action: "answer_facts", version: 8, answers: [
      { need: "food_now", field: "zip", value: "19104" }, { need: "food_now", field: "householdSize", value: 0 },
    ] }), (error: unknown) => (error as { code?: string }).code === "23514");
    assert.deepEqual(await snapshot(), beforeInvalid);
    check(true, "A native invalid second factual answer rolls back the first answer, job changes and receipt atomically.");
    const mismatch = await post(keys[0], { ...bodies[0], value: 9 } as SupportUpdate);
    check(mismatch.status() === 409, "The actual HTTP route rejects changed payload under a committed support-update key.");
    const cancelled = await api.post(url, { headers: { origin }, data: { action: "cancel" } });
    check(cancelled.status() === 200, "The existing current-permission withdrawal remains available during recovery.");
    const withdrawn = await snapshot();
    check((await post(keys[2], bodies[2])).status() === 200, "A historical permission receipt is readable after withdrawal without making a new grant.");
    assert.deepEqual(await snapshot(), withdrawn);
    await admin.query("begin");
    try {
      await admin.query("update public.parent_accounts set status='security_hold' where id=$1", [ownerId]);
      await admin.query("set local role authenticated");
      await admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
      check((await admin.query("select count(*)::int n from public.parent_support_update_receipts where request_id=$1", [id])).rows[0].n === 0,
        "A current account hold removes native receipt read access.");
      await assert.rejects(() => admin.query("select public.parent_apply_support_update($1,$2,$3)", [id, keys[0], JSON.stringify(bodies[0])]),
        (error: unknown) => (error as { code?: string }).code === "42501");
      check(true, "A current account hold rejects even a known receipt before historical acknowledgement.");
    } finally { await admin.query("rollback"); }
    assert.deepEqual(await snapshot(), withdrawn);
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
    if (id) {
      await admin.query("delete from public.parent_requests where id=$1 and household_id in (select id from public.parent_households where owner_id=$2)", [id, ownerId]);
      check((await admin.query("select count(*)::int n from public.parent_support_update_receipts where request_id=$1", [id])).rows[0].n === 0,
        "Ordinary request deletion cascades support-edit metadata; the native proof leaves no reusable ZIP fixture behind.");
    }
  }
}
