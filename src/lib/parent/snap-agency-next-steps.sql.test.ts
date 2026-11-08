import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { normalizeWorkerOperation } from "./worker-runtime";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("scoped genuine SNAP observation ingestion (synthetic SQL fixtures)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), session = randomUUID(), contact = randomUUID(), contactSession = randomUUID();
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  const agencyStatus = { reference: "Synthetic SNAP notice", observedAt,
    documents: [{ name: "Proof of income", dueDate: "2026-11-18" }],
    interview: { scheduledAt: "2026-11-19T10:00:00-05:00", channel: "phone" } };
  const evidence = { reference: agencyStatus.reference, observedAt, agencyStatus };
  async function actor(id: string, sql: string, values: unknown[] = []) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: id === owner ? session : contactSession, role: "authenticated", amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic SQL observation',approved_until=now()+interval '1 day'");
    for (const [id, sid] of [[owner, session], [contact, contactSession]]) {
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [sid, id]);
    }
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function setup(overrides: { program?: string; need?: string; action?: string; role?: string } = {}) {
    const active = await actor(owner, "select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows) await actor(owner, "select public.parent_control_request($1,'cancel')", [row.id]);
    // Every fixture has its own immutable operation and explicit referral membership.
    const request = (await actor(owner, "select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: new Date(Date.now() + 86400000).toISOString() })), randomUUID(),
    ])).rows[0].id as string;
    const operation = randomUUID();
    await fixture.admin.query(`insert into public.parent_operations(id,request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,permission_version,state,executed_at,created_at)
      values($1::uuid,$2,1,$3,$4,$5,'{}',repeat('a',64),'{household}',$1::text,'synthetic-status-only','sent',now()-interval '2 hours',now()-interval '2 hours')`,
    [operation, request, overrides.program ?? "snap-pa", overrides.need ?? "snap_new", overrides.action ?? "submit"]);
    await fixture.admin.query(`insert into parent_private.trusted_memberships(user_id,request_id,operation_id,program_id,role,allowed_fields,can_record_status,purpose,permission_reference,expires_at)
      values($1,$2,$3,$4,$5,'{}',true,'Synthetic status observation','Synthetic referral grant',now()+interval '1 hour')`,
    [contact, request, operation, overrides.program ?? "snap-pa", overrides.role ?? "operator"]);
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where request_id=$1", [request]);
    return { request, operation };
  }
  async function worker(sql: string, values: unknown[] = []) {
    await fixture.admin.query("set role parent_worker");
    try { return await fixture.admin.query(sql, values); } finally { await fixture.admin.query("reset role"); }
  }
  async function claim(request: string) {
    await fixture.admin.query("update public.parent_jobs set run_at=now() where request_id=$1", [request]);
    return (await worker("select parent_private.parent_claim_job(120) value")).rows[0].value;
  }
  const save = (job: { jobId: string; leaseToken: string }) => worker("select parent_private.parent_save_job_plan($1,$2,1,$3,'[]',null,'service_operator','provider_capability_enabled')", [job.jobId, job.leaseToken, JSON.stringify({ version: 1, routes: [] })]);
  const record = (operation: string, input: unknown = evidence, state = "agency_submitted", id = contact) => actor(id,
    "select public.parent_record_referral_status($1,$2,$3) id", [operation, state, JSON.stringify(input)]);

  it("carries unchanged dates and attributed evidence through the actual RPC into the worker, wakes work and deduplicates", async () => {
    const { request, operation } = await setup();
    const first = await record(operation);
    const row = (await fixture.admin.query("select to_jsonb(o) value from public.parent_operations o where id=$1", [operation])).rows[0].value;
    expect(row.evidence).toMatchObject({ ...evidence, source: "operator_confirmed", attribution: "operator_confirmed", packetHash: "a".repeat(64) });
    expect(normalizeWorkerOperation(row)?.receipt).toEqual({ state: "agency_submitted", source: "operator_confirmed", reference: evidence.reference, recordedAt: observedAt, agencyStatus });
    expect((await fixture.admin.query("select state from public.parent_jobs where request_id=$1", [request])).rows[0].state).toBe("queued");
    expect((await record(operation)).rows[0].id).toBe(first.rows[0].id);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_receipts where operation_id=$1", [operation])).rows[0].n).toBe(1);
  });
  it("preserves valid supplementary Unicode at the exact JavaScript limits", async () => {
    const { operation } = await setup();
    const input = { reference: "😀".repeat(100), observedAt, agencyStatus: { reference: "😀".repeat(100), observedAt, documents: [{ name: "😀".repeat(80) }] } };
    await record(operation, input);
    const row = (await fixture.admin.query("select to_jsonb(o) value from public.parent_operations o where id=$1", [operation])).rows[0].value;
    expect(normalizeWorkerOperation(row)?.receipt?.agencyStatus).toEqual(input.agencyStatus);
  });
  it("keeps the actual earlier agency observation when the carrier report was recorded later", async () => {
    const { operation } = await setup();
    await fixture.admin.query("update public.parent_operations set evidence=$2 where id=$1", [operation, JSON.stringify({ source: "provider_api", reference: "sinch-fax:synthetic-only", recordedAt: new Date().toISOString() })]);
    await record(operation);
    expect((await fixture.admin.query("select evidence from public.parent_operations where id=$1", [operation])).rows[0].evidence).toMatchObject(evidence);
  });
  it("resumes same-state new details and refuses a delayed observation overwriting newer evidence", async () => {
    const { request, operation } = await setup({ role: "partner" });
    await record(operation);
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where request_id=$1", [request]);
    const at = new Date(Date.parse(observedAt) + 1000).toISOString();
    const next = { ...evidence, observedAt: at, agencyStatus: { reference: evidence.reference, observedAt: at, waitingForDecision: true } };
    await record(operation, next);
    expect((await fixture.admin.query("select state from public.parent_jobs where request_id=$1", [request])).rows[0].state).toBe("queued");
    const old = { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "Proof of residency" }] } };
    await expect(record(operation, old)).rejects.toThrow("older observation");
    const row = (await fixture.admin.query("select evidence from public.parent_operations where id=$1", [operation])).rows[0];
    expect(row.evidence).toMatchObject({ ...next, source: "authenticated_partner", attribution: "partner_reported" });
  });
  it("preserves an active lease and at-most-once operations, then discards its stale same-state plan and consumes the wake once", async () => {
    const { request, operation } = await setup();
    await record(operation);
    const job = await claim(request);
    const before = (await fixture.admin.query("select plan,required_actions from public.parent_requests where id=$1", [request])).rows[0];
    const at = new Date(Date.parse(observedAt) + 1000).toISOString();
    await record(operation, { ...evidence, observedAt: at, agencyStatus: { ...agencyStatus, observedAt: at, documents: [{ name: "Proof of residency" }] } });
    expect((await fixture.admin.query("select state,lease_token,receipt_wake_lease_token from public.parent_jobs where id=$1", [job.jobId])).rows[0]).toEqual({ state: "leased", lease_token: job.leaseToken, receipt_wake_lease_token: job.leaseToken });
    await save(job);
    expect((await fixture.admin.query("select plan,required_actions from public.parent_requests where id=$1", [request])).rows[0]).toEqual(before);
    expect((await fixture.admin.query("select state,lease_token,receipt_wake_lease_token from public.parent_jobs where id=$1", [job.jobId])).rows[0]).toEqual({ state: "queued", lease_token: null, receipt_wake_lease_token: null });
    expect((await fixture.admin.query("select next_actor,next_trigger,next_run_at is not null scheduled from public.parent_requests where id=$1", [request])).rows[0]).toEqual({ next_actor: "caselink", next_trigger: "verified_receipt_available", scheduled: true });
    await expect(save(job)).rejects.toThrow();
    const fresh = await claim(request); expect(fresh.leaseToken).not.toBe(job.leaseToken);
    await save(fresh);
    expect((await fixture.admin.query("select state,run_at::text from public.parent_jobs where id=$1", [job.jobId])).rows[0]).toEqual({ state: "waiting", run_at: "infinity" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1", [request])).rows[0].n).toBe(1);
  });
  it.each(["retry", "failure", "cancel", "limit", "expired"])("keeps receipt wake safe through %s", async mode => {
    const { request, operation } = await setup(); const job = await claim(request); await record(operation);
    if (mode === "cancel") {
      await actor(owner, "select public.parent_control_request($1,'cancel')", [request]); await expect(save(job)).rejects.toThrow();
      expect((await fixture.admin.query("select state from public.parent_jobs where id=$1", [job.jobId])).rows[0].state).toBe("cancelled");
    } else if (mode === "limit") {
      await fixture.admin.query("update public.parent_jobs set attempts=48 where id=$1", [job.jobId]); await save(job);
      expect((await fixture.admin.query("select state from public.parent_jobs where id=$1", [job.jobId])).rows[0].state).toBe("failed");
    } else if (mode === "expired") {
      await fixture.admin.query("update public.parent_jobs set lease_until=now()-interval '1 second' where id=$1", [job.jobId]);
      await expect(save(job)).rejects.toThrow(); const fresh = await claim(request); await save(fresh);
      expect((await fixture.admin.query("select state from public.parent_jobs where id=$1", [job.jobId])).rows[0].state).toBe("waiting");
    } else {
      await worker("select parent_private.parent_fail_job($1,$2,$3,$4)", [job.jobId, job.leaseToken, mode === "retry" ? "provider_unavailable" : "ai_budget_exhausted", mode === "retry" ? new Date(Date.now() + 60_000).toISOString() : null]);
      expect((await fixture.admin.query("select state from public.parent_jobs where id=$1", [job.jobId])).rows[0].state).toBe(mode === "retry" ? "waiting" : "failed");
      if (mode === "retry") { const fresh = await claim(request); await save(fresh); }
    }
    expect((await fixture.admin.query("select evidence from public.parent_operations where id=$1", [operation])).rows[0].evidence.agencyStatus).toEqual(agencyStatus);
  });
  it.each([
    { ...evidence, agencyStatus: null },
    { ...evidence, observedAt: observedAt.replace("T", " ").replace("Z", "+00") },
    { ...evidence, reference: "😀".repeat(101), agencyStatus: { ...agencyStatus, reference: "😀".repeat(101) } },
    { ...evidence, reference: "\u00a0", agencyStatus: { ...agencyStatus, reference: "\u00a0" } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "😀".repeat(81) }] } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "\u00a0" }] } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "\tProof of income\u00a0" }] } },
    { ...evidence, source: "agency_receipt" },
    { ...evidence, reason: "provider_declined" },
    { ...evidence, agencyStatus: { ...agencyStatus, program: "Medicaid" } },
    { ...evidence, agencyStatus: { ...agencyStatus, reference: "Unbound notice" } },
    { ...evidence, agencyStatus: { ...agencyStatus, observedAt: new Date(Date.parse(observedAt) + 1).toISOString() } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [] } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "SSN: 123-45-6789" }] } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "Contact 215-555-1234" }] } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "Proof of income", dueDate: "tomorrow" }] } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: [{ name: "Proof of income", dueDate: "2026-02-30" }] } },
    { ...evidence, agencyStatus: { ...agencyStatus, interview: {} } },
    { ...evidence, agencyStatus: { ...agencyStatus, interview: { channel: null } } },
    { ...evidence, agencyStatus: { ...agencyStatus, interview: { scheduledAt: "2026-11-19T10:00:00" } } },
    { ...evidence, agencyStatus: { ...agencyStatus, documents: Array.from({ length: 9 }, () => ({ name: "Proof of income" })) } },
  ])("rejects malformed or unrelated direct RPC payload %# without changing operation or receipts", async input => {
    const { operation } = await setup();
    await expect(record(operation, input)).rejects.toThrow();
    expect((await fixture.admin.query("select state from public.parent_operations where id=$1", [operation])).rows[0].state).toBe("sent");
    expect((await fixture.admin.query("select count(*)::int n from public.parent_receipts where operation_id=$1", [operation])).rows[0].n).toBe(0);
  });
  it.each([{ program: "peco-cap", need: "electricity" }, { need: "food_now" }, { action: "share" }, { action: "prepare" }])("rejects wrong operation binding %#", async overrides => {
    const { operation } = await setup(overrides); await expect(record(operation)).rejects.toThrow();
  });
  it.each(["partner_received", "partner_accepted", "unresolved"])("rejects agency next steps attached to %s", async state => {
    const { operation } = await setup(); await expect(record(operation, evidence, state)).rejects.toThrow();
  });
  it("preserves processing, session, exact membership and current mandate boundaries", async () => {
    const { request, operation } = await setup();
    await expect(record(operation, evidence, "agency_submitted", owner)).rejects.toThrow();
    for (const [disable, restore] of [
      ["update parent_private.processing_controls set enabled=false", "update parent_private.processing_controls set enabled=true"],
      [`update auth.sessions set not_after=now()-interval '1 second' where id='${contactSession}'`, `update auth.sessions set not_after=now()+interval '1 hour' where id='${contactSession}'`],
      [`update parent_private.trusted_memberships set active=false where operation_id='${operation}'`, `update parent_private.trusted_memberships set active=true where operation_id='${operation}'`],
      [`update parent_private.trusted_memberships set program_id='peco-cap' where operation_id='${operation}'`, `update parent_private.trusted_memberships set program_id='snap-pa' where operation_id='${operation}'`],
      [`update parent_private.trusted_memberships set can_record_status=false where operation_id='${operation}'`, `update parent_private.trusted_memberships set can_record_status=true where operation_id='${operation}'`],
    ]) {
      await fixture.admin.query(disable); try { await expect(record(operation)).rejects.toThrow(); } finally { await fixture.admin.query(restore); }
    }
    await actor(owner, "select public.parent_control_request($1,'cancel')", [request]);
    await expect(record(operation)).rejects.toThrow();
  });
  it("preserves legacy status input and replacement migration grants", async () => {
    const { operation } = await setup({ program: "peco-cap", need: "electricity", action: "share" });
    await record(operation, { reference: "Synthetic legacy receipt", observedAt }, "partner_received");
    const migration = readFileSync("supabase/migrations/20261108010000_parent_snap_agency_next_steps.sql", "utf8");
    for (const statement of migration.slice(migration.indexOf("create or replace function")).split(/\n(?=(?:(?:revoke|grant) execute|create or replace function))/)) await fixture.admin.query(statement);
    const grants = (await fixture.admin.query("select has_function_privilege('authenticated','public.parent_record_referral_status(uuid,text,jsonb)','EXECUTE') a,has_function_privilege('anon','public.parent_record_referral_status(uuid,text,jsonb)','EXECUTE') n,has_function_privilege('service_role','public.parent_record_referral_status(uuid,text,jsonb)','EXECUTE') s")).rows[0];
    expect(grants).toEqual({ a: true, n: false, s: false });
    await record(operation, { reference: "Synthetic legacy accepted", observedAt }, "partner_accepted");
  });
});
