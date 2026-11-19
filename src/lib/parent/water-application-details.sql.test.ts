import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { WATER_APPLICATION_NOTICE_VERSION as notice, WATER_APPLICATION_REFERENCE, waterApplicationFieldsValueSchema, waterApplicationLeaves } from "./water-application-fields";
import { waterApplicationSnapshotSchema } from "./water-application-snapshot";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE, at = new Date("2026-11-13T22:20:00Z");
describe.skipIf(!modulePath)("owned water reference preparation in PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  const intake = () => fixtureIntake({ needs: ["water"], householdSize: null, utilityProviders: ["pwd"], accountAuthority: "self", shutoffDate: "2026-12-01" });
  const mandate = () => fixtureMandate({ mode: "prepare_only", recipientIds: ["pwd-tap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"], expiresAt: new Date(at.getTime() + 86400000).toISOString() });
  const details = () => ({ journey: "new_application", existingApplication: "none_known", applicant: { id: randomUUID(), name: "WaterPrivateCanary", dateOfBirth: "1990-01-01", grossMonthlyIncome: "1200.50",
    income: { state: "sources", sources: [{ id: randomUUID(), kind: "employment" }, { id: randomUUID(), kind: "pension" }] } },
    propertyAddress: "100 Synthetic Lane", householdComplete: true, householdMembers: [{ id: randomUUID(), name: "WaterChildCanary", dateOfBirth: "2020-01-01", relationship: "Child" }],
    outsideIncomeSupport: "yes", outsideSupporters: [{ id: randomUUID(), name: "WaterSupporterCanary", address: "2 Synthetic Lane", amount: "25.00", frequency: "monthly" }] });
  async function query(sql: string, values: unknown[] = [], user = owner, role = "authenticated", userSession = session) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: userSession, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  const gate = (enabled = true) => fixture.admin.query("update parent_private.processing_controls set water_details_enabled=$1,water_details_approval_reference='isolated fictional water purpose',water_details_approved_until=now()+interval '1 day',water_details_notice_version=$2", [enabled, notice]);
  const start = async (i = {}, m = {}) => (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify({ ...intake(), ...i }), JSON.stringify({ ...mandate(), ...m }), randomUUID()])).rows[0].id as string;
  const save = async (request: string, value: unknown, version = 1, key = randomUUID(), declarations = true) => (await query("select public.parent_save_water_application_details($1,$2,$3,$4,$5,$6,$6) id", [request, version, JSON.stringify(value), notice, key, declarations])).rows[0].id as string;
  const read = async (request: string) => (await query("select * from public.parent_water_application_details where request_id=$1 order by revision desc", [request])).rows;
  const state = async (request: string) => (await fixture.admin.query("select to_jsonb(r) request,to_jsonb(j) job from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1", [request])).rows[0];
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at);
    fixture = await createParentSqlFixture(modulePath!);
    expect(new Date((await fixture.admin.query("select now() value")).rows[0].value).toISOString()).toBe(at.toISOString());
  });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated test',approved_until=now()+interval '1 day',existing_accounts_enabled=true");
    await gate(false);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [session, owner]);
  });
  it("defaults closed independently and returns the earliest current purpose deadline without table grants", async () => {
    const request = await start(); await fixture.admin.query("update parent_private.processing_controls set peco_details_enabled=true,wic_details_enabled=true");
    expect((await query("select public.parent_water_application_collection() value")).rows[0].value).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
    await expect(save(request, details())).rejects.toMatchObject({ code: "42501" }); await gate();
    await fixture.admin.query("update parent_private.processing_controls set water_details_approved_until=now()+interval '1 hour'");
    const value = (await query("select public.parent_water_application_collection() value")).rows[0].value;
    expect(value).toMatchObject({ collectionEnabled: true, noticeVersion: notice }); expect(new Date(value.expiresAt).getTime()).toBe(at.getTime() + 3600000);
    await expect(query("select * from parent_private.processing_controls")).rejects.toMatchObject({ code: "42501" });
  });
  it("binds every named subject and exact private revision while ordinary state and worker claims contain no raw answers", async () => {
    await gate(); const request = await start(), value = details(), before = await state(request), id = await save(request, value), row = (await read(request))[0], after = await state(request);
    expect(waterApplicationSnapshotSchema.parse(JSON.parse(JSON.stringify(row)))).toMatchObject({ id, details: value, source: WATER_APPLICATION_REFERENCE, request_version: 2 });
    expect(row.consent_evidence.subjects).toEqual([`applicant.${value.applicant.id}`, `householdMembers.${value.householdMembers[0].id}`, `outsideSupporters.${value.outsideSupporters[0].id}`]);
    expect(row.consent_evidence.actorId).toBe(owner); expect(Object.keys(row.provenance).sort()).toEqual(Object.keys(waterApplicationLeaves(value)).sort());
    expect(after.request.intake).toEqual(before.request.intake); expect(after.request.intake.shutoffDate).toBe("2026-12-01");
    expect(JSON.stringify(after)).not.toMatch(/WaterPrivateCanary|WaterChildCanary|WaterSupporterCanary|1200.50|100 Synthetic Lane/);
    const claim = (await query("select parent_private.parent_claim_job(120) value", [], owner, "parent_worker")).rows[0].value;
    expect(JSON.stringify(claim)).not.toMatch(/WaterPrivateCanary|WaterChildCanary|WaterSupporterCanary|1200.50|100 Synthetic Lane/);
    await expect(fixture.admin.query("update public.parent_water_application_details set details='{}' where id=$1", [id])).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["anon", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker"])("denies raw data and owner write RPCs to %s", async role => {
    await gate(); const request = await start(); await save(request, details());
    await expect(query("select * from public.parent_water_application_details", [], owner, role)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_save_water_application_details($1,2,'{}',$2,$3,true,true)", [request, notice, randomUUID()], owner, role)).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects another household and a school role without exposing the revision", async () => {
    await gate(); const request = await start(); await save(request, details());
    for (const school of [false, true]) {
      const other = randomUUID(), otherSession = randomUUID();
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [other, `${other}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [otherSession, other]);
      if (school) await fixture.admin.query("insert into public.app_users(id,email,role,is_active) values($1,$2,'admin',true)", [other, `${other}@example.invalid`]); else await query("select public.parent_ensure_account()", [], other, "authenticated", otherSession);
      expect((await query("select id from public.parent_water_application_details where request_id=$1", [request], other, "authenticated", otherSession)).rows).toEqual([]);
      await expect(query("select public.parent_save_water_application_details($1,2,'{}',$2,$3,true,true)", [request, notice, randomUUID()], other, "authenticated", otherSession)).rejects.toMatchObject({ code: "42501" });
    }
  });
  it.each([[{ needs: ["gas"] }, {}], [{ utilityProviders: ["pgw"] }, {}], [{ accountAuthority: "not_sure" }, {}],
    [{}, { recipientIds: ["peco-cap"] }], [{}, { mode: "full", allowedActions: ["prepare", "submit"] }], [{}, { allowedData: ["household", "income"] }]])("denies incompatible request or mandate scope %#", async (routing, permission) => {
    await gate(); const request = await start(routing, permission), before = await state(request);
    await expect(save(request, details())).rejects.toMatchObject({ code: "42501" }); expect(await read(request)).toEqual([]); expect(await state(request)).toEqual(before);
  });
  it.each([[false, true], [true, false]])("requires both genuine declarations separately (%s/%s)", async (subject, account) => {
    await gate(); const request = await start();
    await expect(query("select public.parent_save_water_application_details($1,1,'{}',$2,$3,$4,$5)", [request, notice, randomUUID(), subject, account])).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["closed", "expired", "notice", "global", "cancelled", "revoked", "declarations", "session", "account"])("rechecks %s even for an exact retry", async condition => {
    await gate(); const request = await start(), value = details(), key = randomUUID(); await save(request, value, 1, key);
    if (condition === "closed") await gate(false);
    if (condition === "expired") await fixture.admin.query("update parent_private.processing_controls set water_details_approved_until=now()-interval '1 day'");
    if (condition === "notice") await fixture.admin.query("update parent_private.processing_controls set water_details_notice_version='other'");
    if (condition === "global") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (condition === "cancelled") await query("select public.parent_control_request($1,'cancel')", [request]);
    if (condition === "revoked") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [request]);
    if (condition === "session") await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 day' where id=$1", [session]);
    if (condition === "account") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [owner]);
    await expect(save(request, value, 1, key, condition !== "declarations")).rejects.toMatchObject({ code: "42501" });
  });
  it("preserves original dates through reorder, denies superseded retries and saves paused corrections without resuming", async () => {
    await gate(); const request = await start(), value = details(), key = randomUUID(), id = await save(request, value, 1, key), original = (await read(request))[0], before = await state(request);
    expect(await save(request, value, 1, key)).toBe(id);
    await save(request, { ...value, applicant: { ...value.applicant, income: { ...value.applicant.income, sources: [...value.applicant.income.sources].reverse() } } }, 2);
    expect((await read(request))[0].provenance).toEqual(original.provenance); expect(await state(request)).toEqual(before);
    await expect(save(request, value, 1, key)).rejects.toMatchObject({ code: "PT409" });
    await query("select public.parent_control_request($1,'pause')", [request]); const paused = await state(request);
    await save(request, { ...value, propertyAddress: "101 Synthetic Lane" }, paused.request.version);
    const after = await state(request); expect(after.request.status).toBe("paused"); expect(after.job.state).toBe("cancelled"); expect(after.request.version).toBe(paused.request.version + 1);
    expect((await read(request)).at(-1).details).toEqual(value);
  });
  it.each([false, true])("starts once with atomic private data and original reused routing, explicit documents %s", async documents => {
    await gate(); const source = await start(), value = details(), key = randomUUID(), permission = mandate(); if (documents) permission.allowedData.push("documents");
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',to_jsonb(now()-interval '5 days')) where id=$1", [source]);
    const sql = "select public.parent_start_water_application($1,$2,$3,$4,$5,true,true,$6,$7) id", args = [JSON.stringify(intake()), JSON.stringify(permission), JSON.stringify(value), notice, key, source, 1];
    const request = (await query(sql, args)).rows[0].id as string; expect((await query(sql, args)).rows[0].id).toBe(request);
    expect((await state(request)).request.intake_confirmed_at.zip).toBe((await state(source)).request.intake_confirmed_at.zip);
    expect((await read(request))).toHaveLength(1);
    const invalidKey = randomUUID(); await expect(query(sql, [args[0], args[1], JSON.stringify({ waterAccessCode: "123456789" }), notice, invalidKey, source, 1])).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [invalidKey])).rows).toEqual([]);
    const staleKey = randomUUID(); await expect(query(sql, [...args.slice(0, 4), staleKey, source, 2])).rejects.toMatchObject({ code: "P0001", message: "parent_reuse_source_changed" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [staleKey])).rows).toEqual([]);
  });
  it("retains owned private history and cascades deletion after closure", async () => {
    await gate(); const request = await start(); await save(request, details()); await save(request, {}, 2);
    await gate(false); const history = await read(request);
    expect(history).toHaveLength(2); expect(JSON.stringify(history)).not.toMatch(/waterAccessCode|applicationId|accountNumberSha256/);
    await fixture.admin.query("update parent_private.processing_controls set enabled=false"); await query("select public.parent_request_deletion()");
    const batch = (await query("select parent_private.parent_claim_cleanup(100) value", [], owner, "parent_retention_worker")).rows[0].value;
    await query("select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],$3,array[]::uuid[])", [batch.batchId, batch.leaseToken, batch.accountIds], owner, "parent_retention_worker");
    expect((await fixture.admin.query("select id from public.parent_water_application_details where request_id=$1", [request])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from auth.users where id=$1", [owner])).rows).toHaveLength(1);
  });
  it("matches strict route and direct database field validation, with canonical money and no protected fields", async () => {
    const id = randomUUID();
    for (const value of [details(), {}, { applicant: { id, grossMonthlyIncome: "0", income: { state: "none", sources: [] } } },
      { journey: "recertification", existingApplication: "saved" }, { applicant: { id, name: "123456789" } }, { waterAccessCode: "123456789" }, { applicationId: "12345" },
      { applicant: { id, dateOfBirth: "2025-02-29" } }, { childSupportMonthlyAmount: "1" }, { applicant: { id, income: { state: "none", sources: [] }, grossMonthlyIncome: "1" } },
      { outsideIncomeSupport: "yes", outsideSupporters: [{ id, frequency: "monthly", frequencyDescription: "week" }] }, { hardship: "illness" }, { signature: "private" },
      { zeroIncomeClaim: "unknown" }, { applicant: { id, grossMonthlyIncome: "0" }, outsideIncomeSupport: "no", livingExpenses: { food: "Using savings", housing: "Household adult pays rent" } },
      { applicant: { id, grossMonthlyIncome: "1.00" }, outsideIncomeSupport: "no", livingExpenses: {} },
      { applicant: { id, grossMonthlyIncome: "0" }, outsideIncomeSupport: "yes" }, { applicant: { id, grossMonthlyIncome: "0" }, outsideIncomeSupport: "yes", livingExpenses: {} },
      { outsideIncomeSupport: "no", livingExpenses: {} }, { livingExpenses: { food: "Using savings" } },
      { applicant: { id, grossMonthlyIncome: "0" }, outsideIncomeSupport: "no", livingExpenses: { medical: "private" } },
      { applicant: { id, grossMonthlyIncome: "0" }, outsideIncomeSupport: "no", livingExpenses: { food: "password=secret" } },
    ]) {
      const parsed = waterApplicationFieldsValueSchema.safeParse(value), result = fixture.admin.query("select parent_private.validate_water_details($1)", [JSON.stringify(parsed.success ? parsed.data : value)]);
      if (parsed.success) await expect(result).resolves.toBeTruthy(); else await expect(result).rejects.toMatchObject({ code: "23514", message: "invalid water details" });
    }
  });
  it("stores applicable financial explanations with exact declarations and original provenance, without certifying a City attachment", async () => {
    await gate(); const request = await start(), base = details(), value = { ...base, applicant: { ...base.applicant, grossMonthlyIncome: "0.00", income: { state: "none", sources: [] } }, outsideIncomeSupport: "no", outsideSupporters: undefined,
      livingExpenses: { food: "ZeroIncomePrivateCanary savings", housing: "Another household adult pays rent", utilities: "Using savings" } };
    await save(request, value); const original = (await read(request))[0];
    expect(waterApplicationSnapshotSchema.parse(JSON.parse(JSON.stringify(original))).details).toEqual(value);
    expect(original.provenance["livingExpenses.food"]).toMatchObject({ source: "parent", asOf: "2026-11-13" });
    expect(original.consent_evidence.subjectAuthorityDeclared).toBe(true);
    expect(JSON.stringify(await state(request))).not.toContain("ZeroIncomePrivateCanary");
    expect(original.details).not.toHaveProperty("signature"); expect(original.consent_evidence).not.toHaveProperty("financialAssent");
    await save(request, { ...value, livingExpenses: { ...value.livingExpenses, utilities: "Corrected utility source" } }, 2);
    expect((await read(request))[0].provenance["livingExpenses.food"]).toEqual(original.provenance["livingExpenses.food"]);
  });
});
