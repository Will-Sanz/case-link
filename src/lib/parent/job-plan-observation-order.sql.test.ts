import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("job plan receipt composition (synthetic SQL fixtures)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), session = randomUUID();
  const base = Date.now() - 3_600_000;
  const at = (offset: number) => new Date(base + offset).toISOString();
  const evidence = (observed: unknown, state = "agency_submitted") => ({
    source: "agency_receipt", reference: "Synthetic agency notice", recordedAt: at(60_000),
    agencyStatus: { reference: "Synthetic agency notice", observedAt: observed,
      ...(state === "agency_submitted" ? { waitingForDecision: true } : { documents: [{ name: "Decision notice" }] }) },
  });
  async function actor(sql: string, values: unknown[] = []) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function worker(sql: string, values: unknown[] = []) {
    await fixture.admin.query("set role parent_worker");
    try { return await fixture.admin.query(sql, values); } finally { await fixture.admin.query("reset role"); }
  }
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic SQL composition',approved_until=now()+interval '1 day'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function request(snapOnly = false) {
    const active = await actor("select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows) await actor("select public.parent_control_request($1,'cancel')", [row.id]);
    return (await actor("select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: snapOnly ? ["snap_new"] : ["snap_new", "food_now"], utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ recipientIds: snapOnly ? ["snap-pa"] : ["snap-pa", "philly-food"], expiresAt: new Date(Date.now() + 86_400_000).toISOString() })), randomUUID(),
    ])).rows[0].id as string;
  }
  async function operation(request: string, state: string, updatedAt: string, receipt: unknown,
    binding: { need?: string; program?: string; createdAt?: string } = {}) {
    const id = randomUUID();
    await fixture.admin.query(`insert into public.parent_operations(id,request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,permission_version,state,evidence,executed_at,created_at,updated_at)
      values($1::uuid,$2,1,$3,$4,'submit','{}',encode(sha256(convert_to($1::text,'UTF8')),'hex'),'{household}',$1::text,'synthetic-status-only',$5,$6,$7,$7,$8)`,
    [id, request, binding.program ?? "snap-pa", binding.need ?? "snap_new", state, JSON.stringify(receipt), binding.createdAt ?? at(-60_000), updatedAt]);
  }
  async function claim(request: string) {
    await fixture.admin.query("update public.parent_jobs set run_at=now() where request_id=$1", [request]);
    return (await worker("select parent_private.parent_claim_job(120) value")).rows[0].value as { jobId: string; leaseToken: string };
  }
  const save = (job: { jobId: string; leaseToken: string }, state = "assistance_approved") => worker(
    "select parent_private.parent_save_job_plan($1,$2,1,$3,'[]',null,'agency','none')", [job.jobId, job.leaseToken,
      JSON.stringify({ version: 1, routes: [{ need: "snap_new", programId: "snap-pa", state }] })]);
  async function persisted(request: string, state?: string) {
    await save(await claim(request), state);
    return (await fixture.admin.query("select plan->'routes'->0->>'state' state,status from public.parent_requests where id=$1", [request])).rows[0];
  }

  it.each(["agency_submitted", "declined"])("persists the newer approval when older %s is ingested later", async oldState => {
    const id = await request();
    await operation(id, "assistance_approved", at(20_000), evidence(at(10_000), "assistance_approved"));
    await operation(id, oldState, at(30_000), evidence(at(0), oldState));
    expect(await persisted(id)).toEqual({ state: "assistance_approved", status: "active" });
  });
  it("persists the newer denial when an older approval is ingested later", async () => {
    const id = await request();
    await operation(id, "declined", at(20_000), evidence(at(10_000), "declined"));
    await operation(id, "assistance_approved", at(30_000), evidence(at(0), "assistance_approved"));
    expect(await persisted(id, "declined")).toEqual({ state: "declined", status: "active" });
  });
  it("keeps a SNAP-only request active when an older denial precedes a newer approval", async () => {
    const id = await request(true);
    await operation(id, "assistance_approved", at(20_000), evidence(at(10_000), "assistance_approved"));
    await operation(id, "declined", at(30_000), evidence(at(0), "declined"));
    expect(await persisted(id)).toEqual({ state: "assistance_approved", status: "active" });
  });
  it.each([
    ["declined", "all_permitted_routes_exhausted"],
    ["support_received", "completed"],
  ])("retains attributed %s closure when the current program outcome permits it", async (state, reason) => {
    const id = await request(true);
    await operation(id, state, at(20_000), evidence(at(10_000), state));
    expect(await persisted(id, state)).toEqual({ state, status: "closed" });
    const row = (await fixture.admin.query("select evidence->>'reason' reason from public.parent_events where request_id=$1 and kind='request.closed'", [id])).rows[0];
    expect(row).toEqual({ reason });
  });
  it("never treats an unattributed negative as exhausted routes", async () => {
    const id = await request(true);
    await operation(id, "declined", at(20_000), { ...evidence(at(10_000), "declined"), source: "unverified" });
    expect(await persisted(id, "declined")).toEqual({ state: "declined", status: "active" });
  });
  it("preserves actual support received ahead of a newer denial", async () => {
    const id = await request();
    await operation(id, "support_received", at(20_000), evidence(at(0), "support_received"));
    await operation(id, "declined", at(30_000), evidence(at(10_000), "declined"));
    expect(await persisted(id, "support_received")).toEqual({ state: "support_received", status: "active" });
  });
  it.each([
    undefined, "not-a-date", "2026-02-30T12:00:00Z", "infinity", "now", "2026-11-17", 123,
    at(70_000),
  ])("falls back to ingestion for missing or invalid agency observation %#", async observed => {
    const id = await request();
    await operation(id, "assistance_approved", at(20_000), evidence(at(10_000), "assistance_approved"));
    await operation(id, "declined", at(30_000), evidence(observed, "declined"));
    expect(await persisted(id, "declined")).toEqual({ state: "declined", status: "active" });
  });
  it("keeps ordinary transport receipts ordered by ingestion", async () => {
    const id = await request();
    await operation(id, "agency_submitted", at(20_000), evidence(at(10_000)));
    await operation(id, "partner_received", at(30_000), { source: "provider_api", reference: "Synthetic transport receipt", recordedAt: at(0) });
    expect(await persisted(id, "partner_received")).toEqual({ state: "partner_received", status: "active" });
  });
  it("accepts valid minute precision and offset agency timestamps", async () => {
    const id = await request();
    const minute = new Date(base - 60_000).toISOString().replace(/:\d{2}\.\d{3}Z$/, "-00:00");
    await operation(id, "assistance_approved", at(20_000), evidence(minute, "assistance_approved"));
    await operation(id, "declined", at(30_000), evidence(at(-120_000), "declined"));
    expect(await persisted(id)).toEqual({ state: "assistance_approved", status: "active" });
  });
  it("uses the trusted referral observedAt carrier when recordedAt is absent", async () => {
    const id = await request();
    const receipt = evidence(at(10_000), "assistance_approved");
    const { recordedAt: observedAt, ...rest } = receipt;
    await operation(id, "assistance_approved", at(20_000), { ...rest, observedAt });
    await operation(id, "agency_submitted", at(30_000), evidence(at(0)));
    expect(await persisted(id)).toEqual({ state: "assistance_approved", status: "active" });
  });
  it.each([undefined, "not-a-date", "2026-02-30T12:00:00Z", "infinity"])("falls back safely for an invalid carrier timestamp %#", async recordedAt => {
    const id = await request();
    await operation(id, "assistance_approved", at(20_000), evidence(at(10_000), "assistance_approved"));
    await operation(id, "declined", at(30_000), { ...evidence(at(0), "declined"), recordedAt });
    expect(await persisted(id, "declined")).toEqual({ state: "declined", status: "active" });
  });
  it("keeps receipt identity bound to the current account, need and program", async () => {
    const id = await request();
    await fixture.admin.query("update public.parent_requests set account_changed_at=jsonb_build_object('snap_new',$2::text) where id=$1", [id, at(0)]);
    await operation(id, "agency_submitted", at(10_000), evidence(at(0)), { createdAt: at(1) });
    await operation(id, "support_received", at(30_000), evidence(at(20_000), "support_received"));
    await operation(id, "assistance_approved", at(40_000), evidence(at(20_000), "assistance_approved"), { need: "food_now" });
    await operation(id, "declined", at(50_000), evidence(at(20_000), "declined"), { program: "philly-food" });
    expect(await persisted(id, "agency_submitted")).toEqual({ state: "agency_submitted", status: "active" });
  });
  it("preserves the exact lease and worker-only execution boundary", async () => {
    const id = await request(), job = await claim(id);
    await expect(save({ ...job, leaseToken: randomUUID() })).rejects.toThrow();
    await actor("select public.parent_control_request($1,'cancel')", [id]);
    await expect(save(job)).rejects.toThrow();
    const grants = (await fixture.admin.query(`select has_function_privilege('parent_worker','parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamptz,text,text)','EXECUTE') worker,
      has_function_privilege('authenticated','parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamptz,text,text)','EXECUTE') parent,
      has_function_privilege('service_role','parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamptz,text,text)','EXECUTE') service,
      has_function_privilege('parent_worker','parent_private.current_program_operation(uuid,text,text)','EXECUTE') internal_worker,
      has_function_privilege('authenticated','parent_private.current_program_operation(uuid,text,text)','EXECUTE') internal_parent`)).rows[0];
    expect(grants).toEqual({ worker: true, parent: false, service: false, internal_worker: false, internal_parent: false });
  });
});
