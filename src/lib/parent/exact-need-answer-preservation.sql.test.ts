import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { currentIntakeFields } from "./current-intake-fields";
import type { SupportIntake, SupportNeed, SupportRequest } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;

describe.skipIf(!modulePath)("exact-need answers preserve unrelated saved facts", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), session = randomUUID();

  async function parent(sql: string, values: unknown[] = []) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "otp" }] }),
      ]);
      return await fixture.admin.query(sql, values);
    } finally {
      await fixture.admin.query("reset role");
    }
  }

  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic exact-need preservation test',approved_until=now()+interval '1 day'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,'exact-need-preservation@example.invalid',now())", [owner]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
  });
  afterAll(async () => { await fixture?.admin.end(); });

  async function start() {
    const active = await parent("select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows)
      await parent("select public.parent_control_request($1,'cancel')", [row.id]);
    return (await parent("select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: ["food_now", "electricity", "gas"], utilityProviders: ["peco", "pgw"] })),
      JSON.stringify(fixtureMandate({ recipientIds: ["philly-food", "peco-cap", "pgw-crp"], expiresAt: new Date(Date.now() + 86400000).toISOString() })),
      randomUUID(),
    ])).rows[0].id as string;
  }

  async function read(id: string): Promise<SupportRequest> {
    return (await parent("select to_jsonb(r) request from public.parent_requests r where id=$1", [id])).rows[0].request;
  }

  async function answer(id: string, need: SupportNeed, field: string, value: unknown) {
    const request = await read(id);
    await parent("select public.parent_answer_fact($1,$2,$3,$4,$5)", [id, need, field, JSON.stringify(value), request.version]);
  }

  async function correct(id: string, patch: Partial<SupportIntake>) {
    const request = await read(id);
    await parent("select public.parent_correct_request($1,$2,$3)", [id, JSON.stringify({ ...request.intake, ...patch }), request.version]);
  }

  async function projection(id: string, need: SupportNeed) {
    const row = (await fixture.admin.query("select parent_private.current_intake_fields($1,$2) fields,now()::text at", [id, need])).rows[0];
    expect(currentIntakeFields(await read(id), new Date(row.at), need)).toEqual(row.fields);
    return row.fields as ReturnType<typeof currentIntakeFields>;
  }

  it.each([
    { field: "zip", first: "19103", second: "19102", firstFields: { zip: "19103" }, secondFields: { zip: "19102" } },
    { field: "householdSize", first: 2, second: 4, firstFields: { householdSize: 2 }, secondFields: { householdSize: 4 } },
    { field: "income", first: { amount: 1000, frequency: "monthly" }, second: { amount: 400, frequency: "weekly" }, firstFields: { incomeAmount: 1000, incomeFrequency: "monthly" }, secondFields: { incomeAmount: 400, incomeFrequency: "weekly" } },
  ])("preserves food $field when a utility supplies its own different answer", async ({ field, first, second, firstFields, secondFields }) => {
    const id = await start();
    await answer(id, "food_now", field, first);
    const original = (await read(id)).facts![0];
    await answer(id, "electricity", field, second);
    const request = await read(id);
    expect(request.facts).toHaveLength(2);
    expect(request.facts).toContainEqual(original);
    expect(await projection(id, "food_now")).toMatchObject(firstFields);
    expect(await projection(id, "electricity")).toMatchObject(secondFields);
  });

  it("preserves utility income when food supplies a different pair later", async () => {
    const id = await start();
    await answer(id, "electricity", "income", { amount: 400, frequency: "weekly" });
    const original = (await read(id)).facts![0];
    await answer(id, "food_now", "income", { amount: 1000, frequency: "monthly" });
    expect((await read(id)).facts).toContainEqual(original);
    expect(await projection(id, "electricity")).toMatchObject({ incomeAmount: 400, incomeFrequency: "weekly" });
    expect(await projection(id, "food_now")).toMatchObject({ incomeAmount: 1000, incomeFrequency: "monthly" });
  });

  it("replaces only the corrected need's field and preserves the other need's source dates", async () => {
    const id = await start();
    await answer(id, "food_now", "householdSize", 2);
    await answer(id, "electricity", "householdSize", 4);
    const original = (await read(id)).facts!.find((fact) => fact.need === "electricity");
    await answer(id, "food_now", "householdSize", 5);
    const request = await read(id);
    expect(request.facts).toHaveLength(2);
    expect(request.facts).toContainEqual(original);
    expect(request.facts?.filter((fact) => fact.need === "food_now")).toHaveLength(1);
    expect(await projection(id, "food_now")).toMatchObject({ householdSize: 5 });
    expect(await projection(id, "electricity")).toMatchObject({ householdSize: 4 });
  });

  it.each([
    { field: "incomeAmount", value: 1000, compatible: true },
    { field: "incomeFrequency", value: "monthly", compatible: true },
    { field: "incomeAmount", value: 600, compatible: false },
    { field: "incomeFrequency", value: "weekly", compatible: false },
  ])("keeps the income source after $field=$value without splicing incompatible components", async ({ field, value, compatible }) => {
    const id = await start();
    await answer(id, "food_now", "income", { amount: 1000, frequency: "monthly" });
    const original = (await read(id)).facts![0];
    await answer(id, "food_now", field, value);
    expect((await read(id)).facts).toContainEqual(original);
    const fields = await projection(id, "food_now");
    if (compatible) expect(fields).toMatchObject({ incomeAmount: 1000, incomeFrequency: "monthly" });
    else {
      expect(fields).not.toHaveProperty("incomeAmount");
      expect(fields).not.toHaveProperty("incomeFrequency");
      await answer(id, "food_now", "income", { amount: 600, frequency: "weekly" });
      expect(await projection(id, "food_now")).toMatchObject({ incomeAmount: 600, incomeFrequency: "weekly" });
    }
  });

  it("keeps food and other-account facts while resetting the changed utility account", async () => {
    const id = await start();
    await answer(id, "food_now", "income", { amount: 1000, frequency: "monthly" });
    await answer(id, "gas", "amountDue", 70);
    await answer(id, "electricity", "amountDue", 50);
    await answer(id, "electricity", "accountAuthority", "self");
    await answer(id, "electricity", "shutoffDate", "2026-11-10");
    const before = await read(id);
    const retained = before.facts!.filter((fact) => fact.need !== "electricity");
    await answer(id, "electricity", "utilityProvider", "other");
    const after = await read(id);
    expect(after.facts).toEqual([...retained, expect.objectContaining({ need: "electricity", field: "utilityProvider", value: "other" })]);
    expect(after.account_changed_at?.electricity).toBeTruthy();
    expect(await projection(id, "food_now")).toMatchObject({ incomeAmount: 1000, incomeFrequency: "monthly" });
  });

  it.each([
    { field: "zip", first: "19103", second: "19102", patch: { zip: "19105" } },
    { field: "householdSize", first: 2, second: 4, patch: { householdSize: 5 } },
    { field: "income", first: { amount: 1000, frequency: "monthly" }, second: { amount: 400, frequency: "weekly" }, patch: { incomeAmount: 700, incomeFrequency: "yearly" as const } },
  ])("still invalidates all matching $field facts after a shared household correction", async ({ field, first, second, patch }) => {
    const id = await start();
    await answer(id, "food_now", field, first);
    await answer(id, "electricity", field, second);
    await answer(id, "gas", "amountDue", 70);
    const unaffected = (await read(id)).facts!.find((fact) => fact.field === "amountDue");
    await correct(id, patch);
    expect((await read(id)).facts).toEqual([unaffected]);
  });

  it("still removes a deleted need's facts and does not transfer its mirrored values", async () => {
    const id = await start();
    await answer(id, "electricity", "zip", "19102");
    const retained = (await read(id)).facts![0];
    await answer(id, "food_now", "zip", "19103");
    await correct(id, { needs: ["electricity", "gas"] });
    expect((await read(id)).facts).toEqual([retained]);
    expect(await projection(id, "electricity")).toMatchObject({ zip: "19102" });
    expect(await projection(id, "gas")).not.toHaveProperty("zip");
  });
});
