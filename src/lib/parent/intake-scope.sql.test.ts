import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import type { ServiceMandate, SupportIntake, SupportNeed } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const migrationPath = "supabase/migrations/20261027142357_parent_intake_need_scope.sql";
const mirroredFields = ["householdSize", "incomeAmount", "incomeFrequency", "zip"];

describe.skipIf(!modulePath)("sticky exact-need intake scope against PostgreSQL migrations", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(),
    otherOwner = randomUUID();
  const sessions = new Map([owner, otherOwner].map((id) => [id, randomUUID()]));

  async function initialize() {
    const database = await createParentSqlFixture(modulePath!);
    await database.admin.query(
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic intake-scope test',approved_until=now()+interval '1 day'",
    );
    for (const user of [owner, otherOwner]) {
      await database.admin.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
        [user, `${user}@example.invalid`],
      );
      await database.admin.query(
        "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
        [sessions.get(user), user],
      );
    }
    return database;
  }

  beforeAll(async () => {
    fixture = await initialize();
  });
  afterAll(async () => {
    await fixture?.admin.end();
  });

  async function parent(sql: string, values: unknown[] = [], user = owner) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: user,
          session_id: sessions.get(user),
          role: "authenticated",
          amr: [{ method: "otp" }],
        }),
      ]);
      return await fixture.admin.query(sql, values);
    } finally {
      await fixture.admin.query("reset role");
    }
  }

  const intake = (overrides: Partial<SupportIntake> = {}) => fixtureIntake({
    incomeAmount: 3125,
    incomeFrequency: "monthly",
    ...overrides,
  });
  const mandate = (overrides: Partial<ServiceMandate> = {}) => fixtureMandate({
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  });

  async function start(
    details: Partial<SupportIntake> = {},
    permission: Partial<ServiceMandate> = {},
    user = owner,
  ) {
    const active = await parent(
      "select id from public.parent_requests where status in ('active','paused')",
      [], user,
    );
    for (const row of active.rows)
      await parent("select public.parent_control_request($1,'cancel')", [row.id], user);
    return (await parent("select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(intake(details)), JSON.stringify(mandate(permission)), randomUUID(),
    ], user)).rows[0].id as string;
  }

  async function read(id: string) {
    return (await parent("select * from public.parent_requests where id=$1", [id])).rows[0];
  }

  async function scope(id: string) {
    const row = await read(id);
    expect(Array.isArray(row.intake_need_scoped_fields)).toBe(true);
    return [...row.intake_need_scoped_fields].sort();
  }

  async function answer(
    id: string,
    field: string,
    value: unknown,
    need: SupportNeed = "electricity",
  ) {
    const row = await read(id);
    await parent("select public.parent_answer_fact($1,$2,$3,$4,$5)", [
      id, need, field, JSON.stringify(value), row.version,
    ]);
  }

  async function correct(id: string, patch: Partial<SupportIntake>) {
    const row = await read(id);
    await parent("select public.parent_correct_request($1,$2,$3)", [
      id, JSON.stringify({ ...row.intake, ...patch }), row.version,
    ]);
  }

  it("starts new household intake with no exact-need-only fallback fields", async () => {
    const id = await start();
    expect(await scope(id)).toEqual([]);
    expect((await read(id)).intake.incomeAmount).toBe(3125);
  });

  it("marks only changed mirrored fields and preserves existing restrictions", async () => {
    const id = await start();
    await answer(id, "zip", "19103");
    expect(await scope(id)).toEqual(["zip"]);
    await answer(id, "householdSize", 4);
    expect(await scope(id)).toEqual(["householdSize", "zip"]);
  });

  it("does not narrow or refresh an independent original source on same-value answers", async () => {
    const id = await start();
    const before = (await read(id)).intake_confirmed_at;
    await answer(id, "zip", "19104");
    await answer(id, "income", { amount: 3125, frequency: "monthly" });
    expect(await scope(id)).toEqual([]);
    expect((await read(id)).intake_confirmed_at).toEqual(before);
  });

  it("tracks both or just the changed component of paired income", async () => {
    const both = await start();
    await answer(both, "income", { amount: 4000, frequency: "weekly" });
    expect(await scope(both)).toEqual(["incomeAmount", "incomeFrequency"]);
    const amountOnly = await start();
    await answer(amountOnly, "income", { amount: 4000, frequency: "monthly" });
    expect(await scope(amountOnly)).toEqual(["incomeAmount"]);
    const frequencyOnly = await start();
    await answer(frequencyOnly, "income", { amount: 3125, frequency: "weekly" });
    expect(await scope(frequencyOnly)).toEqual(["incomeFrequency"]);
  });

  it("keeps restrictions after the originating need and fact disappear, no-op correction and renewal", async () => {
    const id = await start(
      { needs: ["snap_new", "electricity"] },
      { recipientIds: ["snap-pa", "peco-cap"] },
    );
    await answer(id, "income", { amount: 4000, frequency: "weekly" }, "snap_new");
    const before = (await read(id)).intake_confirmed_at;
    await correct(id, { needs: ["electricity"] });
    expect((await read(id)).facts).toEqual([]);
    expect(await scope(id)).toEqual(["incomeAmount", "incomeFrequency"]);
    await correct(id, {});
    const row = await read(id);
    await parent("select public.parent_replace_mandate($1,$2,$3)", [
      id, JSON.stringify({ ...row.mandate, recipientIds: ["peco-cap"] }), row.version,
    ]);
    expect(await scope(id)).toEqual(["incomeAmount", "incomeFrequency"]);
    const after = await read(id);
    expect(after.intake.incomeAmount).toBe(4000);
    expect(after.intake_confirmed_at.incomeAmount).toBe(before.incomeAmount);
    expect(after.intake_confirmed_at.incomeFrequency).toBe(before.incomeFrequency);
  });

  it("clears only genuinely changed household fields during a full-form correction", async () => {
    const id = await start();
    await answer(id, "zip", "19103");
    await answer(id, "householdSize", 4);
    await answer(id, "income", { amount: 4000, frequency: "weekly" });
    expect(await scope(id)).toEqual(mirroredFields);
    await correct(id, { zip: "19105", incomeAmount: 4500 });
    expect(await scope(id)).toEqual(["householdSize", "incomeFrequency"]);
    await correct(id, {});
    expect(await scope(id)).toEqual(["householdSize", "incomeFrequency"]);
  });

  it("keeps an existing restriction on a same-value exact-need answer", async () => {
    const id = await start();
    await answer(id, "zip", "19103");
    const before = (await read(id)).intake_confirmed_at.zip;
    await answer(id, "zip", "19103");
    expect(await scope(id)).toEqual(["zip"]);
    expect((await read(id)).intake_confirmed_at.zip).toBe(before);
  });

  it("denies direct scope writes and another household's changes or reads", async () => {
    const id = await start();
    await answer(id, "zip", "19103");
    await start({}, {}, otherOwner);
    await expect(parent(
      "update public.parent_requests set intake_need_scoped_fields='{}' where id=$1", [id],
    ))
      .rejects.toMatchObject({ code: "42501" });
    const row = await read(id);
    await expect(parent(
      "select public.parent_correct_request($1,$2,$3)",
      [id, JSON.stringify(row.intake), row.version], otherOwner,
    ))
      .rejects.toMatchObject({ code: "42501" });
    expect((await parent("select id from public.parent_requests where id=$1", [id], otherOwner)).rows).toEqual([]);
    expect(await scope(id)).toEqual(["zip"]);
  });

  it("restricts all four uncertain legacy origins without changing their values or source dates", async () => {
    const legacy = await initialize();
    try {
      await legacy.admin.query("alter table public.parent_requests drop column if exists intake_need_scoped_fields");
      const priorFunction = readFileSync("supabase/migrations/20261027141312_parent_intake_source_dates.sql", "utf8")
        .match(/create function parent_private\.record_intake_source_dates\(\)[\s\S]*?end \$\$;/)?.[0];
      expect(priorFunction).toBeDefined();
      await legacy.admin.query(priorFunction!.replace("create function", "create or replace function"));
      await legacy.admin.query("set role authenticated");
      await legacy.admin.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: owner,
          session_id: sessions.get(owner),
          role: "authenticated",
          amr: [{ method: "otp" }],
        }),
      ]);
      const id = (await legacy.admin.query("select public.parent_start_request($1,$2,$3) id", [
        JSON.stringify(intake()), JSON.stringify(mandate()), randomUUID(),
      ])).rows[0].id;
      await legacy.admin.query("reset role");
      const before = (await legacy.admin.query("select * from public.parent_requests where id=$1", [id])).rows[0];
      await legacy.admin.query(
        `do $scope_replay$ begin execute $migration_source$${readFileSync(migrationPath, "utf8")}$migration_source$; end $scope_replay$;`,
      );
      const after = (await legacy.admin.query("select * from public.parent_requests where id=$1", [id])).rows[0];
      expect([...after.intake_need_scoped_fields].sort()).toEqual(mirroredFields);
      expect(after.intake).toEqual(before.intake);
      expect(after.intake_confirmed_at).toEqual(before.intake_confirmed_at);
    } finally {
      await legacy.admin.end();
    }
  });
});
