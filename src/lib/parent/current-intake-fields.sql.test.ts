import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const oldDate = "2026-01-01T12:00:00Z";

describe.skipIf(!modulePath)("current intake sources at restricted SQL boundaries", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), session = randomUUID();
  type Job = { jobId: string; leaseToken: string; request: { version: number } };

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
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic source-guard test',approved_until=now()+interval '1 day'",
    );
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,'source-guard@example.invalid',now())", [owner]);
    await fixture.admin.query(
      "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
      [session, owner],
    );
    await fixture.admin.query(`
      insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      select program,action,true,true,false,'synthetic-source-v1','isolated synthetic fixture',
        array['zip','householdSize','incomeAmount','incomeFrequency','statusReference'],
        '{"zip":"household","householdSize":"household","incomeAmount":"income","incomeFrequency":"income","statusReference":"household"}'::jsonb,
        array[]::text[],now()+interval '1 day'
      from unnest(array['peco-cap','snap-pa']) program cross join unnest(array['share','follow_up']) action
    `);
  });

  afterAll(async () => { await fixture?.admin.end(); });

  async function start() {
    const active = await query("authenticated", "select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows)
      await query("authenticated", "select public.parent_control_request($1,'cancel')", [row.id]);
    return (await query("authenticated", "select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: ["electricity", "snap_new"], incomeAmount: 3125, incomeFrequency: "monthly" })),
      JSON.stringify(fixtureMandate({ recipientIds: ["peco-cap", "snap-pa"], expiresAt: new Date(Date.now() + 86400000).toISOString() })),
      randomUUID(),
    ])).rows[0].id as string;
  }

  async function claim(): Promise<Job> {
    return (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job;
  }

  async function answer(id: string, field: string, value: unknown, need = "electricity") {
    const row = (await query("authenticated", "select version from public.parent_requests where id=$1", [id])).rows[0];
    await query("authenticated", "select public.parent_answer_fact($1,$2,$3,$4,$5)", [id, need, field, JSON.stringify(value), row.version]);
  }

  async function prepare(job: Job, packet: Record<string, unknown>, action = "share", program = "peco-cap", need = "electricity") {
    const data = Object.keys(packet).some((field) => field.startsWith("income")) ? ["household", "income"] : ["household"];
    return (await query(
      "parent_worker",
      "select parent_private.parent_prepare_operation($1,$2,$3,$4,$5,$6,$7::text[],array[]::uuid[],$8,$9) id",
      [job.jobId, job.leaseToken, job.request.version, program, action, JSON.stringify(packet), data, randomUUID(), need],
    )).rows[0].id as string;
  }

  function begin(job: Job, operation: string) {
    return query("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3) operation", [operation, job.jobId, job.leaseToken]);
  }

  async function setSourceDate(id: string, field: string, date: unknown) {
    await fixture.admin.query(
      "update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,array[$2],$3::jsonb) where id=$1",
      [id, field, JSON.stringify(date)],
    );
  }

  async function register(id: string, job: Job, packet: Record<string, unknown>) {
    const template = `guard-${randomUUID()}`;
    await fixture.admin.query(
      "insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,source_url,verified_until,active) values($1,'1','peco-cap',array['electricity'],$2,$3,'{\"Zip\":\"zip\",\"Size\":\"householdSize\",\"Income\":\"incomeAmount\",\"Frequency\":\"incomeFrequency\"}',array[]::text[],'https://example.invalid/synthetic-form',now()+interval '1 day',true)",
      [template, "a".repeat(64), `${template}.pdf`],
    );
    const result = await query(
      "parent_worker",
      "select parent_private.parent_register_form_artifact($1,$2,'peco-cap',$3,'1',$4,$5,'electricity') artifact",
      [job.jobId, job.leaseToken, template, JSON.stringify(packet), "b".repeat(64)],
    );
    expect(result.rows[0].artifact.request_id).toBe(id);
    return result.rows[0].artifact;
  }

  it.each([
    ["expired", oldDate],
    ["null", null],
    ["invalid", "not-a-date"],
    ["invalid calendar", "2026-09-31T12:00:00Z"],
    ["timezone-free", "2026-10-26T12:00:00"],
    ["dynamic alias", "now"],
    ["future", "2099-01-01T00:00:00Z"],
  ])("denies direct preparation with a %s source instead of trusting the current intake value", async (_label, date) => {
    const id = await start();
    await setSourceDate(id, "zip", date);
    const job = await claim();
    await expect(prepare(job, { zip: "19104" })).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select count(*)::integer count from public.parent_operations where request_id=$1", [id])).rows[0].count).toBe(0);
  });

  it("denies a well-typed value that does not match its current source", async () => {
    await start();
    await expect(prepare(await claim(), { householdSize: 4 })).rejects.toMatchObject({ code: "42501" });
  });

  it("denies another need's mirrored answer while allowing the source need", async () => {
    const id = await start();
    await answer(id, "householdSize", 4, "snap_new");
    const job = await claim();
    await expect(prepare(job, { householdSize: 4 })).rejects.toMatchObject({ code: "42501" });
    const operation = await prepare(job, { householdSize: 4 }, "share", "snap-pa", "snap_new");
    expect((await begin(job, operation)).rows[0].operation.need).toBe("snap_new");
  });

  it("uses an exact-need paired answer with zero income for preparation and dispatch", async () => {
    const id = await start();
    await answer(id, "income", { amount: 0, frequency: "weekly" });
    const job = await claim();
    const packet = { incomeAmount: 0, incomeFrequency: "weekly" };
    const operation = await prepare(job, packet);
    expect((await begin(job, operation)).rows[0].operation.packet).toEqual(packet);
  });

  it("does not splice an individual income answer into the old intake frequency", async () => {
    const id = await start();
    await answer(id, "incomeAmount", 4000);
    await expect(prepare(await claim(), { incomeAmount: 4000, incomeFrequency: "monthly" }))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("denies stale form data before recording an artifact", async () => {
    const id = await start();
    await setSourceDate(id, "householdSize", oldDate);
    await expect(register(id, await claim(), { householdSize: 3 })).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select count(*)::integer count from public.parent_form_artifacts where request_id=$1", [id])).rows[0].count).toBe(0);
  });

  it("registers a form from current exact-need paired evidence", async () => {
    const id = await start();
    await answer(id, "income", { amount: 0, frequency: "monthly" });
    const artifact = await register(id, await claim(), { incomeAmount: 0, incomeFrequency: "monthly" });
    expect(artifact.status).toBe("registered");
  });

  it("rechecks source age at dispatch without changing the prepared immutable packet", async () => {
    const id = await start();
    const job = await claim();
    const operation = await prepare(job, { zip: "19104" });
    const before = (await fixture.admin.query("select packet,packet_hash,request_version from public.parent_operations where id=$1", [operation])).rows[0];
    await setSourceDate(id, "zip", oldDate);
    await expect(begin(job, operation)).rejects.toMatchObject({ code: "42501" });
    const after = (await fixture.admin.query("select packet,packet_hash,request_version,state,executed_at from public.parent_operations where id=$1", [operation])).rows[0];
    expect(after).toMatchObject({ ...before, state: "prepared", executed_at: null });
  });

  it("keeps verified-reference-only follow-up working without usable household facts", async () => {
    const id = await start();
    const job = await claim();
    const original = await prepare(job, { zip: "19104" });
    await begin(job, original);
    await query("parent_worker", "select parent_private.parent_finish_operation($1,$2,$3,'sent',$4,null)", [
      original, job.jobId, job.leaseToken, JSON.stringify({ source: "provider_api", reference: "synthetic-known-reference" }),
    ]);
    await fixture.admin.query(
      "update public.parent_requests set intake_need_scoped_fields=array['zip','householdSize','incomeAmount','incomeFrequency'],intake_confirmed_at=(select jsonb_object_agg(k,to_jsonb($2::text)) from jsonb_object_keys(intake) k) where id=$1",
      [id, oldDate],
    );
    const packet = { statusReference: "synthetic-known-reference" };
    const followUp = await prepare(job, packet, "follow_up");
    expect((await begin(job, followUp)).rows[0].operation.packet).toEqual(packet);
  });

  it("uses the inclusive 45-day boundary by instant, including an equivalent offset date", async () => {
    const id = await start();
    await fixture.admin.query("begin");
    try {
      await fixture.admin.query(`
        update public.parent_requests set intake_confirmed_at=
          jsonb_set(jsonb_set(intake_confirmed_at,'{zip}',
            to_jsonb(to_char(((now()-interval '45 days') at time zone 'UTC')+interval '5 hours 30 minutes','YYYY-MM-DD"T"HH24:MI:SS.US')||'+05:30')),
            '{householdSize}',to_jsonb(now()-interval '45 days 0.001 seconds'))
        where id=$1
      `, [id]);
      const job = await claim();
      expect(await prepare(job, { zip: "19104" })).toBeTypeOf("string");
      // The expected SQL error aborts this transaction; rollback precedes role cleanup.
      await fixture.admin.query("set role parent_worker");
      await expect(fixture.admin.query(
        "select parent_private.parent_prepare_operation($1,$2,$3,'peco-cap','share',$4,array['household'],array[]::uuid[],$5,'electricity')",
        [job.jobId, job.leaseToken, job.request.version, JSON.stringify({ householdSize: 3 }), randomUUID()],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await fixture.admin.query("rollback");
    }
  });

  it("interprets an exact-need date-only asOf as UTC in a non-UTC database session", async () => {
    const id = await start();
    await answer(id, "householdSize", 4);
    await fixture.admin.query("set timezone='America/New_York'");
    try {
      await fixture.admin.query(`
        update public.parent_requests set facts=(
          select jsonb_agg(f||jsonb_build_object(
            'confirmedAt',to_char((now() at time zone 'UTC')::date-1,'YYYY-MM-DD')||'T01:00:00Z',
            'asOf',to_char((now() at time zone 'UTC')::date-1,'YYYY-MM-DD')
          )) from jsonb_array_elements(facts) f
        ) where id=$1
      `, [id]);
      const job = await claim();
      const operation = await prepare(job, { householdSize: 4 });
      expect((await begin(job, operation)).rows[0].operation.packet).toEqual({ householdSize: 4 });
    } finally {
      await fixture.admin.query("set timezone='UTC'");
    }
  });

  it("does not expose the private source projection as a parent or worker read API", async () => {
    const id = await start();
    for (const role of ["authenticated", "parent_worker"] as const)
      await expect(query(role, "select parent_private.current_intake_fields($1,'electricity')", [id]))
        .rejects.toMatchObject({ code: "42501" });
  });
});
