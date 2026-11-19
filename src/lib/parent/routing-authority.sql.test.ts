import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import type { ServiceMandate } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const oldDate = "2026-01-01T12:00:00Z";
const permission = "synthetic-routing-v1";

describe.skipIf(!modulePath)("routing authority at restricted SQL execution boundaries", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), session = randomUUID();
  type Job = { jobId: string; leaseToken: string; request: { id: string; version: number } };

  async function query(role: "authenticated" | "parent_worker", sql: string, values: unknown[] = []) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify(role === "authenticated"
          ? { sub: owner, session_id: session, role, amr: [{ method: "otp" }] }
          : { role }),
      ]);
      return await fixture.admin.query(sql, values);
    } finally {
      await fixture.admin.query("reset role");
    }
  }

  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query(
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic routing-authority test',approved_until=now()+interval '1 day'",
    );
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,'routing-guard@example.invalid',now())", [owner]);
    await fixture.admin.query(
      "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
      [session, owner],
    );
    await fixture.admin.query(`
      insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      select program,action,true,true,false,$1,'isolated synthetic fixture',
        array['amountDue','statusReference','householdSize'],
        '{"amountDue":"utility","statusReference":"household","householdSize":"household"}'::jsonb,
        array[]::text[],now()+interval '1 day'
      from unnest(array['peco-cap','uesf-utilities']) program
      cross join unnest(array['share','submit','schedule','follow_up']) action
    `, [permission]);
  });
  afterAll(async () => { await fixture?.admin.end(); });

  async function start(allowedData: ServiceMandate["allowedData"] = ["household", "utility"]) {
    const active = await query("authenticated", "select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows)
      await query("authenticated", "select public.parent_control_request($1,'cancel')", [row.id]);
    return (await query("authenticated", "select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: ["electricity", "water"], utilityProviders: ["peco", "pwd"] })),
      JSON.stringify(fixtureMandate({ recipientIds: ["peco-cap", "uesf-utilities"], allowedData, expiresAt: new Date(Date.now() + 86400000).toISOString() })),
      randomUUID(),
    ])).rows[0].id as string;
  }

  async function claim(): Promise<Job> {
    return (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job;
  }

  async function prepare(job: Job, action: string, packet: Record<string, unknown> = { amountDue: 50 }, program = "peco-cap", need = "electricity") {
    const data: string[] = [];
    if (Object.hasOwn(packet, "amountDue")) data.push("utility");
    if (Object.keys(packet).some((field) => field !== "amountDue")) data.push("household");
    return (await query("parent_worker",
      "select parent_private.parent_prepare_operation($1,$2,$3,$4,$5,$6,$7::text[],array[]::uuid[],$8,$9) id",
      [job.jobId, job.leaseToken, job.request.version, program, action, JSON.stringify(packet), data, randomUUID(), need],
    )).rows[0].id as string;
  }

  async function begin(job: Job, operation: string) {
    return (await query("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3) operation", [
      operation, job.jobId, job.leaseToken,
    ])).rows[0].operation;
  }

  async function finishedReceipt(job: Job, program = "peco-cap", need = "electricity") {
    const id = await prepare(job, "share", { amountDue: 50 }, program, need);
    await begin(job, id);
    const reference = `synthetic-${randomUUID()}`;
    await query("parent_worker", "select parent_private.parent_finish_operation($1,$2,$3,'sent',$4,null)", [
      id, job.jobId, job.leaseToken, JSON.stringify({ source: "provider_api", reference }),
    ]);
    return { id, reference };
  }

  async function restrictZip(id: string) {
    await fixture.admin.query("update public.parent_requests set intake_need_scoped_fields=array['zip'] where id=$1", [id]);
  }

  async function ageSource(id: string, field: string) {
    await fixture.admin.query(
      "update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,array[$2],to_jsonb($3::text)) where id=$1",
      [id, field, oldDate],
    );
  }

  it.each(["share", "submit", "schedule", "follow_up"])(
    "denies new %s with a utility-only packet when no current ZIP is usable",
    async (action) => {
      const id = await start();
      await restrictZip(id);
      await expect(prepare(await claim(), action)).rejects.toMatchObject({ code: "42501" });
      expect((await fixture.admin.query("select count(*)::integer count from public.parent_operations where request_id=$1", [id])).rows[0].count).toBe(0);
    },
  );

  it.each(["expired", "excluded", "other_need", "outside_area"])(
    "denies utility-only sharing when routing authority is %s",
    async (state) => {
      const id = await start(state === "excluded" ? ["utility"] : undefined);
      if (state === "expired") await ageSource(id, "zip");
      if (state === "other_need")
        await query("authenticated", "select public.parent_answer_fact($1,'water','zip','\"19103\"'::jsonb,1)", [id]);
      if (state === "outside_area")
        await query("authenticated", "select public.parent_answer_fact($1,'electricity','zip','\"10001\"'::jsonb,1)", [id]);
      await expect(prepare(await claim(), "share")).rejects.toMatchObject({ code: "42501" });
    },
  );

  it.each(["share", "submit", "schedule", "follow_up"])(
    "executes current authorized %s without transmitting routing ZIP to a provider that forbids it",
    async (action) => {
      await start();
      const job = await claim();
      const packet = { amountDue: 50 };
      const operation = await prepare(job, action, packet);
      expect((await begin(job, operation)).packet).toEqual(packet);
      const row = (await fixture.admin.query("select packet,data_categories from public.parent_operations where id=$1", [operation])).rows[0];
      expect(row.packet).not.toHaveProperty("zip");
      expect(row.data_categories).toEqual(["utility"]);
    },
  );

  it("resumes from an exact-need current ZIP answer without putting ZIP in the provider packet", async () => {
    const id = await start();
    await restrictZip(id);
    await query("authenticated", "select public.parent_answer_fact($1,'electricity','zip','\"19103\"'::jsonb,1)", [id]);
    const job = await claim();
    const packet = { amountDue: 50 };
    expect((await begin(job, await prepare(job, "share", packet))).packet).toEqual(packet);
  });

  it("keeps authorized research and preparation independent of missing routing permission", async () => {
    const id = await start(["utility"]);
    await restrictZip(id);
    const job = await claim();
    for (const action of ["research", "prepare"])
      expect(await prepare(job, action)).toBeTypeOf("string");
  });

  it.each(["expired", "outside_area"])(
    "continues a verified-reference follow-up and current supplement when ZIP is %s",
    async (state) => {
      const id = await start();
      const job = await claim();
      const receipt = await finishedReceipt(job);
      if (state === "expired") await ageSource(id, "zip");
      else await fixture.admin.query("update public.parent_requests set intake=jsonb_set(intake,'{zip}','\"10001\"') where id=$1", [id]);
      const status = { statusReference: receipt.reference };
      expect((await begin(job, await prepare(job, "follow_up", status))).packet).toEqual(status);
      const supplement = { ...status, amountDue: 75, householdSize: 3 };
      expect((await begin(job, await prepare(job, "follow_up", supplement))).packet).toEqual(supplement);
    },
  );

  it.each(["fabricated", "other_request", "other_program", "other_need"])(
    "does not exempt a %s status reference from current routing authority",
    async (state) => {
      let id = await start();
      let job = await claim();
      const receipt = state === "fabricated" ? { reference: "not-a-real-receipt" } : await finishedReceipt(
        job, state === "other_program" || state === "other_need" ? "uesf-utilities" : "peco-cap",
        state === "other_need" ? "water" : "electricity",
      );
      if (state === "other_request") {
        id = await start();
        job = await claim();
      }
      await restrictZip(id);
      await expect(prepare(job, "follow_up", { statusReference: receipt.reference },
        state === "other_need" ? "uesf-utilities" : "peco-cap"))
        .rejects.toMatchObject({ code: "42501" });
    },
  );

  it.each(["mismatched", "expired"])(
    "keeps current-field validation for a %s supplement despite a genuine reference",
    async (state) => {
      const id = await start();
      const job = await claim();
      const receipt = await finishedReceipt(job);
      await restrictZip(id);
      if (state === "expired") await ageSource(id, "householdSize");
      await expect(prepare(job, "follow_up", {
        statusReference: receipt.reference, householdSize: state === "mismatched" ? 4 : 3,
      })).rejects.toMatchObject({ code: "42501" });
    },
  );

  it("rechecks unsent routing facts at final begin without changing a prepared utility-only packet", async () => {
    const id = await start();
    const job = await claim();
    const operation = await prepare(job, "submit");
    const before = (await fixture.admin.query("select packet,packet_hash,request_version from public.parent_operations where id=$1", [operation])).rows[0];
    await ageSource(id, "zip");
    await expect(begin(job, operation)).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select packet,packet_hash,request_version,state,executed_at from public.parent_operations where id=$1", [operation])).rows[0])
      .toEqual({ ...before, state: "prepared", executed_at: null });
  });

  it("rechecks receipt evidence at final begin even when current ZIP is valid", async () => {
    await start();
    const job = await claim();
    const receipt = await finishedReceipt(job);
    const operation = await prepare(job, "follow_up", { statusReference: receipt.reference });
    await fixture.admin.query("update public.parent_operations set evidence='{}'::jsonb where id=$1", [receipt.id]);
    await expect(begin(job, operation)).rejects.toMatchObject({ code: "42501" });
  });

  it("denies final begin for a legacy prepared fabricated reference despite valid current ZIP", async () => {
    await start();
    const job = await claim();
    const id = randomUUID();
    const packet = JSON.stringify({ statusReference: "legacy-unverified-reference" });
    await fixture.admin.query(
      "insert into public.parent_operations(id,request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,permission_version) values($1,$2,$3,'electricity','peco-cap','follow_up',$4,encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'),array['household'],array[]::uuid[],$5,$6)",
      [id, job.request.id, job.request.version, packet, randomUUID(), permission],
    );
    await expect(begin(job, id)).rejects.toMatchObject({ code: "42501" });
  });
});
