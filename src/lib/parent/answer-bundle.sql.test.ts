import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { buildAssistantFacts } from "./assistant";
import { currentIntakeFields } from "./current-intake-fields";
import { NEEDS, type SupportIntake, type SupportNeed, type SupportRequest } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const zip = { need: "food_now", field: "zip", value: "19103" };
const size = { need: "food_now", field: "householdSize", value: 4 };

describe.skipIf(!modulePath)("atomic parent factual-answer bundles", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), otherOwner = randomUUID();
  const sessions = new Map([owner, otherOwner].map((id) => [id, randomUUID()]));

  async function query(role: "authenticated" | "parent_worker", sql: string, values: unknown[] = [], user = owner) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify(role === "authenticated"
          ? { sub: user, session_id: sessions.get(user), role, amr: [{ method: "otp" }] }
          : { role }),
      ]);
      return await fixture.admin.query(sql, values);
    } finally {
      await fixture.admin.query("reset role");
    }
  }

  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic answer-bundle test',approved_until=now()+interval '1 day'");
    for (const user of [owner, otherOwner]) {
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [user, `${user}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [sessions.get(user), user]);
    }
  });
  afterAll(async () => { await fixture?.admin.end(); });

  async function start(details: Partial<SupportIntake> = {}) {
    const active = await query("authenticated", "select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows)
      await query("authenticated", "select public.parent_control_request($1,'cancel')", [row.id]);
    return (await query("authenticated", "select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: ["food_now", "electricity", "gas"], utilityProviders: ["peco", "pgw"], ...details })),
      JSON.stringify(fixtureMandate({ recipientIds: ["philly-food", "peco-cap", "pgw-crp"], expiresAt: new Date(Date.now() + 86400000).toISOString() })),
      randomUUID(),
    ])).rows[0].id as string;
  }

  async function read(id: string): Promise<SupportRequest> {
    return (await fixture.admin.query("select to_jsonb(r) request from public.parent_requests r where id=$1", [id])).rows[0].request;
  }

  async function snapshot(id: string) {
    return {
      request: await read(id),
      job: (await fixture.admin.query("select to_jsonb(j) job from public.parent_jobs j where request_id=$1", [id])).rows[0].job,
      events: (await fixture.admin.query("select to_jsonb(e) event from public.parent_events e where request_id=$1 order by created_at,id", [id])).rows,
    };
  }

  function save(id: string, answers: unknown, version = 1, user = owner) {
    return query("authenticated", "select public.parent_answer_facts($1,$2,$3)", [
      id, answers === undefined ? null : JSON.stringify(answers), version,
    ], user);
  }

  async function answer(id: string, need: SupportNeed, field: string, value: unknown) {
    await query("authenticated", "select public.parent_answer_fact($1,$2,$3,$4,$5)", [id, need, field, JSON.stringify(value), (await read(id)).version]);
  }

  async function projection(id: string, need: SupportNeed) {
    const row = (await fixture.admin.query("select parent_private.current_intake_fields($1,$2) fields,now()::text at", [id, need])).rows[0];
    expect(currentIntakeFields(await read(id), new Date(row.at), need)).toEqual(row.fields);
    return row.fields as ReturnType<typeof currentIntakeFields>;
  }

  it("saves two known questions from one original version and queues their combined current work", async () => {
    const id = await start();
    await save(id, [zip, size]);
    const after = await snapshot(id);
    expect(after.request.facts).toHaveLength(2);
    expect(await projection(id, "food_now")).toMatchObject({ zip: "19103", householdSize: 4 });
    expect(after.request.version).toBeGreaterThan(1);
    expect(after.job).toMatchObject({ state: "queued", request_version: after.request.version });
  });

  it("supports the persisted thirty-question ceiling without dropping any distinct answer", async () => {
    const id = await start({ needs: [...NEEDS] });
    const answers: { need: SupportNeed; field: string; value: unknown }[] = NEEDS
      .filter((need) => !["electricity", "gas", "water"].includes(need))
      .flatMap((need) => [
        { need, field: "zip", value: "19104" },
        { need, field: "householdSize", value: 3 },
        { need, field: "income", value: { amount: 0, frequency: "monthly" } },
      ]);
    for (const [field, value] of Object.entries({
      zip: "19104", householdSize: 3, income: { amount: 0, frequency: "monthly" },
      utilityProvider: "peco", accountAuthority: "self", amountDue: 0,
      totalBalance: 0, dueDate: "2026-11-10", shutoffDate: "2026-11-12",
    })) answers.push({ need: "electricity", field, value });
    expect(answers).toHaveLength(30);
    await save(id, answers);
    expect((await read(id)).facts).toHaveLength(30);
  });

  it.each([
    { label: "invalid amount", answer: { ...size, value: -1 }, code: "23514" },
    { label: "unsupported need", answer: { ...size, need: "career" }, code: "23514" },
    { label: "need absent from request", answer: { ...size, need: "snap_new" }, code: "23514" },
    { label: "invalid date", answer: { need: "electricity", field: "dueDate", value: "2026-02-30" }, code: "22008" },
    { label: "non-utility account fact", answer: { need: "food_now", field: "amountDue", value: 0 }, code: "23514" },
    { label: "null account authority", answer: { need: "electricity", field: "accountAuthority", value: null }, code: "23514" },
    { label: "null provider", answer: { need: "electricity", field: "utilityProvider", value: null }, code: "23514" },
    { label: "unknown provider", answer: { need: "electricity", field: "utilityProvider", value: "unknown" }, code: "23514" },
    { label: "null income frequency", answer: { need: "food_now", field: "income", value: { amount: 0, frequency: null } }, code: "23514" },
  ])("rolls back the entire bundle after a later $label", async ({ answer: invalid, code }) => {
    const id = await start();
    const before = await snapshot(id);
    await expect(save(id, [zip, invalid])).rejects.toMatchObject({ code });
    expect(await snapshot(id)).toEqual(before);
  });

  it.each([
    { field: "accountAuthority", value: null },
    { field: "utilityProvider", value: null },
    { field: "utilityProvider", value: "unknown" },
    { field: "income", value: { amount: 0, frequency: null } },
  ])("also rejects invalid single-answer $field=$value without changing saved work", async ({ field, value }) => {
    const id = await start();
    const before = await snapshot(id);
    await expect(answer(id, "electricity", field, value)).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot(id)).toEqual(before);
  });

  it.each([
    { label: "SQL null", answers: undefined },
    { label: "JSON null", answers: null },
    { label: "empty", answers: [] },
    { label: "object", answers: zip },
    { label: "thirty-one answers", answers: Array.from({ length: 31 }, () => zip) },
    { label: "null entry", answers: [zip, null] },
    { label: "scalar entry", answers: [zip, 2] },
    { label: "missing value", answers: [zip, { need: "food_now", field: "householdSize" }] },
    { label: "unknown property", answers: [zip, { ...size, purpose: "expanded" }] },
    { label: "entry version", answers: [{ ...zip, version: 1 }] },
    { label: "signature", answers: [{ need: "electricity", field: "signature", value: "signed" }] },
    { label: "permission", answers: [{ need: "electricity", field: "allowedData", value: ["income"] }] },
    { label: "booking choice", answers: [{ need: "electricity", field: "bookingPreference", value: "any_weekday" }] },
  ])("rejects $label input without changing saved work", async ({ answers }) => {
    const id = await start();
    const before = await snapshot(id);
    await expect(save(id, answers)).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot(id)).toEqual(before);
  });

  it.each([
    [zip, { ...zip, value: "19102" }],
    [{ need: "food_now", field: "income", value: { amount: 100, frequency: "monthly" } }, { need: "food_now", field: "income", value: { amount: 200, frequency: "weekly" } }],
    [{ need: "food_now", field: "incomeAmount", value: 100 }],
    [{ need: "food_now", field: "incomeFrequency", value: "monthly" }],
    [{ need: "food_now", field: "income", value: { amount: 100, frequency: "monthly" } }, { need: "food_now", field: "incomeAmount", value: 100 }],
  ])("rejects duplicate or partial-income entries: %j", async (...answers) => {
    const id = await start();
    const before = await snapshot(id);
    await expect(save(id, answers)).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot(id)).toEqual(before);
  });

  it("preserves distinct needs' source dates and does not refresh an untouched old field", async () => {
    const id = await start();
    await answer(id, "food_now", "income", { amount: 1000, frequency: "monthly" });
    const original = (await read(id)).facts![0];
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{householdSize}','\"2026-01-01T12:00:00Z\"') where id=$1", [id]);
    await save(id, [
      { need: "electricity", field: "income", value: { amount: 400, frequency: "weekly" } },
      { need: "electricity", field: "zip", value: "19102" },
    ], (await read(id)).version);
    const after = await read(id);
    expect(after.facts).toContainEqual(original);
    expect(after.intake_confirmed_at?.householdSize).toBe("2026-01-01T12:00:00Z");
    expect(await projection(id, "food_now")).toMatchObject({ incomeAmount: 1000, incomeFrequency: "monthly" });
    expect(await projection(id, "electricity")).toMatchObject({ incomeAmount: 400, incomeFrequency: "weekly", zip: "19102" });
  });

  it("resolves both canonical income questions while preserving unrelated required steps", async () => {
    const id = await start();
    const actions = [
      { id: "food-amount", need: "food_now", field: "incomeAmount", reason: "missing_fact", title: "Income", explanation: "Required amount", resolved: false },
      { id: "food-period", need: "food_now", field: "incomeFrequency", reason: "missing_fact", title: "Income period", explanation: "Required period", resolved: false },
      { id: "food-size", need: "food_now", field: "householdSize", reason: "missing_fact", title: "Household size", explanation: "Required size", resolved: false },
      { id: "gas-amount", need: "gas", field: "incomeAmount", reason: "missing_fact", title: "Gas income", explanation: "Required gas income", resolved: false },
    ];
    await fixture.admin.query("update public.parent_requests set required_actions=$2 where id=$1", [id, JSON.stringify(actions)]);
    await save(id, [{ need: "food_now", field: "income", value: { amount: 0, frequency: "monthly" } }]);
    expect((await read(id)).required_actions).toEqual([
      { ...actions[0], resolved: true }, { ...actions[1], resolved: true }, actions[2], actions[3],
    ]);
  });

  it("applies provider resets before the bundle's explicit current account answers, regardless of entry order", async () => {
    const id = await start();
    await answer(id, "gas", "amountDue", 70);
    await answer(id, "electricity", "amountDue", 90);
    await answer(id, "electricity", "totalBalance", 100);
    const gas = (await read(id)).facts!.find((fact) => fact.need === "gas");
    await save(id, [
      { need: "electricity", field: "amountDue", value: 20 },
      { need: "electricity", field: "accountAuthority", value: "authorized_caregiver" },
      { need: "electricity", field: "dueDate", value: "2026-11-15" },
      { need: "electricity", field: "utilityProvider", value: "other" },
    ], (await read(id)).version);
    const after = await read(id);
    expect(after.facts).toContainEqual(gas);
    expect(after.facts).toContainEqual(expect.objectContaining({ need: "electricity", field: "amountDue", value: 20 }));
    expect(after.facts).toContainEqual(expect.objectContaining({ need: "electricity", field: "accountAuthority", value: "authorized_caregiver" }));
    expect(after.facts).toContainEqual(expect.objectContaining({ need: "electricity", field: "dueDate", value: "2026-11-15" }));
    expect(after.facts?.some((fact) => fact.need === "electricity" && fact.field === "totalBalance")).toBe(false);
    expect(after.account_changed_at?.electricity).toBeTruthy();
    const current = (await fixture.admin.query(
      "select count(*)::integer count,bool_and((f->>'confirmedAt')::timestamptz>=(r.account_changed_at->>'electricity')::timestamptz) after_change,bool_and(parent_private.current_account_evidence(r.id,'electricity',(f->>'confirmedAt')::timestamptz)) accepted from public.parent_requests r cross join lateral jsonb_array_elements(r.facts) f where r.id=$1 and f->>'need'='electricity' and f->>'field' in ('amountDue','accountAuthority','dueDate')",
      [id],
    )).rows[0];
    expect(current).toEqual({ count: 3, after_change: true, accepted: true });
    const { facts } = buildAssistantFacts({
      request: after, runtime: { planningReady: false, assistantReady: false },
      operations: [], reports: [], documents: [], history: [],
    }, new Date());
    expect(facts.find((fact) => fact.id === "fact-electricity-amountDue")?.text).toContain("20");
    expect(facts.find((fact) => fact.id === "fact-electricity-accountAuthority")?.text).toContain("authorized_caregiver");
    expect(facts.find((fact) => fact.id === "fact-electricity-dueDate")?.text).toContain("2026-11-15");
    expect(facts.some((fact) => fact.id === "fact-electricity-totalBalance")).toBe(false);
  });

  it("keeps a paused request paused while saving its factual answers", async () => {
    const id = await start();
    await query("authenticated", "select public.parent_control_request($1,'pause')", [id]);
    await save(id, [zip, size], (await read(id)).version);
    const after = await snapshot(id);
    expect(after.request.status).toBe("paused");
    expect(after.request.facts).toHaveLength(2);
    expect(after.job.state).toBe("cancelled");
  });

  it("does not expand permission when factual answers are saved", async () => {
    const id = await start();
    const before = await read(id);
    await save(id, [zip, size]);
    expect((await read(id)).mandate).toEqual(before.mandate);
  });

  it.each(["stale", "null_version", "cancelled"])("denies %s saves without partially applying answers", async (state) => {
    const id = await start();
    if (state === "stale") await answer(id, "gas", "amountDue", 70);
    if (state === "cancelled") await query("authenticated", "select public.parent_control_request($1,'cancel')", [id]);
    const before = await snapshot(id);
    await expect(save(id, [zip, size], state === "null_version" ? null as unknown as number : 1)).rejects.toMatchObject({ code: "40001" });
    expect(await snapshot(id)).toEqual(before);
  });

  it.each(["different_owner", "expired_session", "closed_processing"])("denies %s access without mutating the target household", async (state) => {
    const id = await start();
    if (state === "expired_session") await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [sessions.get(owner)]);
    if (state === "closed_processing") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    const before = await snapshot(id);
    try {
      await expect(save(id, [zip, size], 1, state === "different_owner" ? otherOwner : owner)).rejects.toMatchObject({ code: "42501" });
      expect(await snapshot(id)).toEqual(before);
    } finally {
      await fixture.admin.query("update auth.sessions set not_after=now()+interval '1 hour' where id=$1", [sessions.get(owner)]);
      await fixture.admin.query("update parent_private.processing_controls set enabled=true");
    }
  });

  it("invalidates a queued immutable packet and leaves only the bundle's committed current job version", async () => {
    const id = await start();
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job;
    expect(job.request.id).toBe(id);
    const operation = (await query("parent_worker", "select parent_private.parent_prepare_operation($1,$2,1,'philly-food','prepare','{\"zip\":\"19104\"}',array['household'],array[]::uuid[],$3,'food_now') id", [job.jobId, job.leaseToken, randomUUID()])).rows[0].id;
    const before = (await fixture.admin.query("select packet,packet_hash from public.parent_operations where id=$1", [operation])).rows[0];
    await save(id, [zip, size]);
    expect((await fixture.admin.query("select packet,packet_hash,state from public.parent_operations where id=$1", [operation])).rows[0]).toEqual({ ...before, state: "invalidated" });
    const after = await snapshot(id);
    expect(after.job).toMatchObject({ request_version: after.request.version, state: "queued", lease_token: null, lease_until: null });
    await expect(query("parent_worker", "select parent_private.parent_get_operations($1,$2)", [job.jobId, job.leaseToken])).rejects.toMatchObject({ code: "42501" });
  });
});
