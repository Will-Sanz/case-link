import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const migrationPath = "supabase/migrations/20261027141312_parent_intake_source_dates.sql";
const historical = "2026-01-01T12:00:00.000Z";

describe.skipIf(!modulePath)("server-owned intake source dates against PostgreSQL migrations", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(),
    otherOwner = randomUUID();
  const sessions = new Map([owner, otherOwner].map((id) => [id, randomUUID()]));

  async function initialize() {
    const db = await createParentSqlFixture(modulePath!);
    await db.admin.query(
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic provenance test',approved_until=now()+interval '1 day'",
    );
    for (const user of [owner, otherOwner]) {
      await db.admin.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
        [user, `${user}@example.invalid`],
      );
      await db.admin.query(
        "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
        [sessions.get(user), user],
      );
    }
    return db;
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

  const intake = () => fixtureIntake({ incomeAmount: 3125, incomeFrequency: "monthly" });
  const mandate = () => fixtureMandate({ expiresAt: new Date(Date.now() + 86400000).toISOString() });

  async function start(user = owner) {
    return (await parent("select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(intake()), JSON.stringify(mandate()), randomUUID(),
    ], user)).rows[0].id as string;
  }

  async function read(id: string) {
    const row = (await parent("select * from public.parent_requests where id=$1", [id])).rows[0];
    expect(row.intake_confirmed_at).toBeTypeOf("object");
    return row;
  }

  async function ageSources(id: string) {
    // Only this isolated fixture creates historical state; parents cannot set source timestamps.
    await fixture.admin.query(
      "update public.parent_requests set intake_confirmed_at=(select jsonb_object_agg(k,to_jsonb($2::timestamptz)) from jsonb_object_keys(intake) k) where id=$1",
      [id, historical],
    );
    return (await read(id)).intake_confirmed_at;
  }

  it("initializes every existing strict intake key with a server source timestamp only", async () => {
    const row = await read(await start());
    const databaseNow = (await fixture.admin.query("select clock_timestamp() at")).rows[0].at;
    const dates = row.intake_confirmed_at as Record<string, string>;
    expect(Object.keys(dates).sort()).toEqual(Object.keys(row.intake).sort());
    for (const value of Object.values(dates)) {
      expect(value).toBeTypeOf("string");
      expect(new Date(value).getTime()).toBeGreaterThanOrEqual(new Date(row.created_at).getTime());
      expect(new Date(value).getTime()).toBeLessThanOrEqual(new Date(databaseNow).getTime());
    }
    expect(JSON.stringify(dates)).not.toContain("3125");
  });

  it("updates only changed source fields during an authenticated full-form correction", async () => {
    const id = await start();
    const before = await ageSources(id);
    await parent("select public.parent_correct_request($1,$2,1)", [
      id, JSON.stringify({ ...intake(), zip: "19103", householdSize: null }),
    ]);
    const cleared = await read(id);
    const after = cleared.intake_confirmed_at;
    expect(cleared.intake.householdSize).toBeNull();
    expect(new Date(after.zip).getTime()).toBeGreaterThan(new Date(before.zip).getTime());
    expect(new Date(after.householdSize).getTime()).toBeGreaterThan(new Date(before.householdSize).getTime());
    expect({ ...after, zip: before.zip, householdSize: before.householdSize }).toEqual(before);

    // Age this null source deterministically so the second transition needs no timing delay.
    await fixture.admin.query(
      "update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{householdSize}',to_jsonb($2::timestamptz)) where id=$1",
      [id, historical],
    );
    const beforeRestore = (await read(id)).intake_confirmed_at;
    await parent("select public.parent_correct_request($1,$2,2)", [
      id, JSON.stringify({ ...cleared.intake, householdSize: 4 }),
    ]);
    const restored = await read(id);
    expect(restored.intake.householdSize).toBe(4);
    expect(new Date(restored.intake_confirmed_at.householdSize).getTime())
      .toBeGreaterThan(new Date(beforeRestore.householdSize).getTime());
    expect({ ...restored.intake_confirmed_at, householdSize: beforeRestore.householdSize })
      .toEqual(beforeRestore);
  });

  it("does not refresh source age on a same-value correction or owner reads", async () => {
    const id = await start();
    const before = await ageSources(id);
    await read(id);
    await parent("select public.parent_correct_request($1,$2,1)", [id, JSON.stringify(intake())]);
    expect((await read(id)).intake_confirmed_at).toEqual(before);
  });

  it("preserves source age through mandate renewal, booking changes, pause and resume", async () => {
    const id = await start();
    const before = await ageSources(id);
    await parent("select public.parent_replace_mandate($1,$2,1)", [
      id, JSON.stringify({ ...mandate(), expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() }),
    ]);
    await parent("select public.parent_update_booking_preference($1,'weekday_afternoon',2)", [id]);
    await parent("select public.parent_control_request($1,'pause')", [id]);
    await parent("select public.parent_control_request($1,'resume')", [id]);
    expect((await read(id)).intake_confirmed_at).toEqual(before);
  });

  it("keeps an explicit same-value paired income answer fresh only in its dated fact evidence", async () => {
    const id = await start();
    const before = await ageSources(id);
    await parent("select public.parent_answer_fact($1,'electricity','income',$2,1)", [
      id, JSON.stringify({ amount: 3125, frequency: "monthly" }),
    ]);
    const row = await read(id);
    expect(row.intake_confirmed_at).toEqual(before);
    const fact = row.facts.find((item: { field: string }) => item.field === "income");
    expect(fact).toMatchObject({ need: "electricity", source: "parent", value: { amount: 3125, frequency: "monthly" } });
    expect(new Date(fact.confirmedAt).getTime()).toBeGreaterThan(new Date(before.incomeAmount).getTime());
  });

  it("denies client-written timestamps and another household's corrections or source reads", async () => {
    const id = await start();
    const before = (await read(id)).intake_confirmed_at;
    await start(otherOwner);
    await expect(parent("update public.parent_requests set intake_confirmed_at='{}' where id=$1", [id]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(parent("select public.parent_correct_request($1,$2,1)", [id, JSON.stringify(intake())], otherOwner))
      .rejects.toMatchObject({ code: "42501" });
    expect((await parent("select id from public.parent_requests where id=$1", [id], otherOwner)).rows).toEqual([]);
    expect((await read(id)).intake_confirmed_at).toEqual(before);
  });

  it("backfills a legacy row from created_at instead of a recent unrelated updated_at", async () => {
    const legacy = await initialize();
    try {
      // Recreate only the pre-migration shape in a separate in-memory database.
      await legacy.admin.query("drop trigger if exists parent_intake_source_dates on public.parent_requests");
      await legacy.admin.query("alter table public.parent_requests drop column if exists intake_confirmed_at");
      await legacy.admin.query("drop function if exists parent_private.record_intake_source_dates()");
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
      await legacy.admin.query("update public.parent_requests set created_at=$2,updated_at=now() where id=$1", [id, historical]);
      await legacy.admin.query(
        `do $provenance_replay$ begin execute $migration_source$${readFileSync(migrationPath, "utf8")}$migration_source$; end $provenance_replay$;`,
      );
      const row = (await legacy.admin.query("select * from public.parent_requests where id=$1", [id])).rows[0];
      expect(Object.keys(row.intake_confirmed_at).sort()).toEqual(Object.keys(row.intake).sort());
      expect(new Date(row.updated_at).getTime()).toBeGreaterThan(new Date(historical).getTime());
      for (const value of Object.values(row.intake_confirmed_at))
        expect(new Date(String(value)).toISOString()).toBe(historical);
    } finally {
      await legacy.admin.end();
    }
  });
});
