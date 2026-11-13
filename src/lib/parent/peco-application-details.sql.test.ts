import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { PECO_APPLICATION_NOTICE_VERSION as notice, PECO_APPLICATION_SOURCE, PECO_SUBJECT_AUTHORITY_STATEMENT, PECO_ACCOUNT_AUTHORITY_STATEMENT, pecoApplicationFieldsValueSchema, pecoApplicationLeaves } from "./peco-application-fields";
import { pecoApplicationSnapshotSchema } from "./peco-application-snapshot";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const at = new Date("2026-11-13T20:10:00Z");
describe.skipIf(!modulePath)("closed PECO private preparation against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  const intake = () => fixtureIntake({ needs: ["electricity"], householdSize: null, utilityProviders: ["peco"], accountAuthority: "self" });
  const mandate = () => fixtureMandate({ mode: "prepare_only", recipientIds: ["peco-cap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"], expiresAt: new Date(at.getTime() + 86400000).toISOString() });
  const details = () => ({ journey: "new_enrollment", currentCapState: "not_enrolled", accountNumber: "9000000001", householdComplete: true,
    applicant: { id: randomUUID(), firstName: "PecoPrivateCanary", lastName: "Example", dateOfBirth: "1990-01-01", income: { state: "sources", sources: [{ id: randomUUID(), kind: "employment" }, { id: randomUUID(), kind: "pension" }] } },
    address: { street: "1 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19147" }, householdMembers: [{ id: randomUUID(), firstName: "ChildCanary", dateOfBirth: "2020-01-01", relationship: "Child" }] });
  async function query(sql: string, values: unknown[] = [], user = owner, role = "authenticated", userSession = session) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: userSession, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function gate(enabled = true) {
    await fixture.admin.query("update parent_private.processing_controls set peco_details_enabled=$1,peco_details_approval_reference='isolated fictional PECO test',peco_details_approved_until=now()+interval '1 day',peco_details_notice_version=$2", [enabled, notice]);
  }
  async function start(i = {}, m = {}) {
    return (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify({ ...intake(), ...i }), JSON.stringify({ ...mandate(), ...m }), randomUUID()])).rows[0].id as string;
  }
  async function save(request: string, value: unknown, version = 1, key = randomUUID(), suppliedNotice = notice, subject = true, account = true) {
    return (await query("select public.parent_save_peco_application_details($1,$2,$3,$4,$5,$6,$7) id", [request, version, JSON.stringify(value), suppliedNotice, key, subject, account])).rows[0].id as string;
  }
  async function read(request: string) { return (await query("select * from public.parent_peco_application_details where request_id=$1 order by revision desc", [request])).rows; }
  async function state(request: string) {
    return (await fixture.admin.query("select r.*,(select row_to_json(j) from public.parent_jobs j where j.request_id=r.id) job from public.parent_requests r where r.id=$1", [request])).rows[0];
  }
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
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
  });

  it("remains closed independently of SNAP and WIC and exposes only a bounded purpose deadline", async () => {
    const request = await start();
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true,wic_details_enabled=true");
    expect((await query("select public.parent_peco_application_collection() value")).rows[0].value).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
    await expect(save(request, details())).rejects.toMatchObject({ code: "42501" });
    await gate();
    await fixture.admin.query("update parent_private.processing_controls set approved_until=now()+interval '2 hours',peco_details_approved_until=now()+interval '1 hour'");
    const collection = (await query("select public.parent_peco_application_collection() value")).rows[0].value;
    expect(collection).toMatchObject({ collectionEnabled: true, noticeVersion: notice });
    expect(new Date(collection.expiresAt).toISOString()).toBe(new Date(at.getTime() + 3600000).toISOString());
    expect(Object.keys(collection).sort()).toEqual(["collectionEnabled", "expiresAt", "noticeVersion"]);
    await expect(query("select * from parent_private.processing_controls")).rejects.toMatchObject({ code: "42501" });
  });

  it("binds exact account/subject declarations, actors, versions and private source hashes without worker exposure", async () => {
    await gate(); const request = await start(), value = details(), before = await state(request), key = randomUUID();
    const id = await save(request, value, 1, key), row = (await read(request))[0], after = await state(request);
    expect(pecoApplicationSnapshotSchema.parse(JSON.parse(JSON.stringify(row)))).toMatchObject({ id, request_id: request, revision: 1, base_version: 1, request_version: 2, details: value, source: PECO_APPLICATION_SOURCE, notice_version: notice });
    expect(Object.keys(row.provenance).sort()).toEqual(Object.keys(pecoApplicationLeaves(value)).sort());
    expect(row.consent_evidence).toMatchObject({ actorId: owner, subjectAuthorityDeclared: true, subjectStatement: PECO_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true, accountStatement: PECO_ACCOUNT_AUTHORITY_STATEMENT, accountAuthority: "self", revision: 1,
      subjects: [`applicant.${value.applicant.id}`, `householdMembers.${value.householdMembers[0].id}`] });
    expect((await fixture.admin.query("select consent_evidence->>'detailsSha256'=encode(sha256(convert_to(details::text,'UTF8')),'hex') and consent_evidence->>'accountNumberSha256'=encode(sha256(convert_to(details->>'accountNumber','UTF8')),'hex') bound from public.parent_peco_application_details where id=$1", [id])).rows[0].bound).toBe(true);
    expect(after.intake).toEqual(before.intake); expect(after.facts).toEqual(before.facts); expect(after.version).toBe(2); expect(after.job.request_version).toBe(2);
    expect(JSON.stringify(after)).not.toMatch(/PecoPrivateCanary|ChildCanary|9000000001/);
    const claim = (await query("select parent_private.parent_claim_job(120) value", [], owner, "parent_worker")).rows[0].value;
    expect(JSON.stringify(claim)).not.toMatch(/PecoPrivateCanary|ChildCanary|9000000001/);
    await expect(fixture.admin.query("update public.parent_peco_application_details set details='{}' where id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(query("delete from public.parent_peco_application_details where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
    await expect(query("insert into public.parent_peco_application_details select * from public.parent_peco_application_details where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
  });

  it.each(["anon", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker"])("denies raw reads and owner RPCs to %s", async role => {
    await gate(); const request = await start(); await save(request, details());
    await expect(query("select * from public.parent_peco_application_details", [], owner, role)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_peco_application_collection()", [], owner, role)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_save_peco_application_details($1,2,'{}',$2,$3,true,true)", [request, notice, randomUUID()], owner, role)).rejects.toMatchObject({ code: "42501" });
  });

  it("denies a second household and school-admin identity without importing school records", async () => {
    await gate(); const request = await start(); await save(request, details());
    for (const school of [false, true]) {
      const other = randomUUID(), otherSession = randomUUID();
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [other, `${other}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [otherSession, other]);
      if (school) await fixture.admin.query("insert into public.app_users(id,email,role,is_active) values($1,$2,'admin',true)", [other, `${other}@example.invalid`]);
      else await query("select public.parent_ensure_account()", [], other, "authenticated", otherSession);
      expect((await query("select * from public.parent_peco_application_details where request_id=$1", [request], other, "authenticated", otherSession)).rows).toEqual([]);
      await expect(query("select public.parent_save_peco_application_details($1,2,'{}',$2,$3,true,true)", [request, notice, randomUUID()], other, "authenticated", otherSession)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it.each([
    ["gas request", { needs: ["gas"] }, {}], ["combined request", { needs: ["electricity", "water"] }, {}], ["wrong provider", { utilityProviders: ["pgw"] }, {}],
    ["unknown account authority", { accountAuthority: "not_sure" }, {}], ["wrong recipient", {}, { recipientIds: ["pwd-tap"] }],
    ["full execution mandate", {}, { mode: "full" }], ["missing prepare permission", {}, { allowedActions: ["research"] }],
    ["missing utility permission", {}, { allowedData: ["household", "income"] }], ["unneeded document permission", {}, { allowedData: ["household", "income", "utility", "documents"] }],
  ])("rejects %s without changing the request", async (_label, i, m) => {
    await gate(); const request = await start(i, m), before = await state(request);
    await expect(save(request, details())).rejects.toMatchObject({ code: "42501" }); expect(await read(request)).toEqual([]); expect(await state(request)).toEqual(before);
  });

  it.each(["closed", "expired", "wrong_control_notice", "missing_reference", "wrong_save_notice", "global_closed", "cancelled", "revoked", "expired_mandate", "inactive_account", "revoked_session", "no_subject", "no_account"])("rejects %s even for an exact retry", async condition => {
    await gate(); const request = await start(), value = details(), key = randomUUID(); await save(request, value, 1, key);
    if (condition === "closed") await gate(false);
    if (condition === "expired") await fixture.admin.query("update parent_private.processing_controls set peco_details_approved_until=now()-interval '1 day'");
    if (condition === "wrong_control_notice") await fixture.admin.query("update parent_private.processing_controls set peco_details_notice_version='WIC'");
    if (condition === "missing_reference") await fixture.admin.query("update parent_private.processing_controls set peco_details_approval_reference=' '");
    if (condition === "global_closed") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (condition === "cancelled") await query("select public.parent_control_request($1,'cancel')", [request]);
    if (condition === "revoked") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [request]);
    if (condition === "expired_mandate") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb(now()-interval '1 day')) where id=$1", [request]);
    if (condition === "inactive_account") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [owner]);
    if (condition === "revoked_session") await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 day' where id=$1", [session]);
    await expect(save(request, value, 1, key, condition === "wrong_save_notice" ? "WIC" : notice, condition !== "no_subject", condition !== "no_account")).rejects.toMatchObject({ code: "42501" });
    if (["global_closed", "inactive_account", "revoked_session"].includes(condition)) expect(await read(request)).toEqual([]);
  });

  it("keeps original dates on reorder/no-op, rejects superseded retries, and invalidates exact account/person corrections", async () => {
    await gate(); const request = await start(), value = details(), key = randomUUID(), id = await save(request, value, 1, key), original = (await read(request))[0], before = await state(request);
    expect(await save(request, value, 1, key)).toBe(id); expect(await state(request)).toEqual(before);
    const reordered = { ...value, applicant: { ...value.applicant, income: { ...value.applicant.income, sources: [...value.applicant.income.sources].reverse() } } };
    await save(request, reordered, 2); expect((await read(request))[0].provenance).toEqual(original.provenance); expect(await state(request)).toEqual(before);
    await expect(save(request, value, 1, key)).rejects.toMatchObject({ code: "40001" });
    await save(request, { ...value, accountNumber: "9000000002" }, 2);
    const corrected = (await read(request))[0]; expect((await state(request)).version).toBe(3);
    expect(corrected.consent_evidence.accountNumberSha256).not.toBe(original.consent_evidence.accountNumberSha256);
    expect({ ...corrected.provenance, accountNumber: original.provenance.accountNumber }).toEqual(original.provenance);
    await save(request, { ...value, applicant: { ...value.applicant, id: randomUUID() } }, 3);
    expect((await state(request)).version).toBe(4); expect((await read(request))).toHaveLength(4);
    expect((await read(request)).at(-1).details).toEqual(value);
  });

  it("accepts a renewal/unknown partial draft without relabeling it a new application or making it executable", async () => {
    await gate(); const request = await start(); await save(request, { journey: "renewal", currentCapState: "enrolled" });
    const first = (await read(request))[0]; expect(first.details).toEqual({ journey: "renewal", currentCapState: "enrolled" }); expect(first.consent_evidence.accountNumberSha256).toBeNull();
    await query("select public.parent_control_request($1,'pause')", [request]); const paused = await state(request);
    await save(request, {}, paused.version); const updated = await state(request);
    expect(updated.status).toBe("paused"); expect(updated.job.state).toBe("cancelled"); expect(updated.next_actor).toBe("parent");
    expect(updated.version).toBe(paused.version + 1);
  });

  it("starts once atomically, preserves source routing dates and keeps service-address ZIP independent", async () => {
    await gate(); const source = await start({ needs: ["food_now"], utilityProviders: [] }, { recipientIds: ["philly-food"] });
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',to_jsonb(now()-interval '5 days')) where id=$1", [source]);
    const value = details(), key = randomUUID(), sql = "select public.parent_start_peco_application($1,$2,$3,$4,$5,true,true,$6,$7) id";
    const args = [JSON.stringify(intake()), JSON.stringify(mandate()), JSON.stringify(value), notice, key, source, 1];
    const request = (await query(sql, args)).rows[0].id as string; expect((await query(sql, args)).rows[0].id).toBe(request);
    const saved = (await read(request))[0], current = await state(request), original = await state(source);
    expect(current.intake_confirmed_at.zip).toEqual(original.intake_confirmed_at.zip); expect(current.intake_reuse.zip.sourceRequestId).toBe(source);
    expect(saved.details.address.zip).toBe("19147"); expect(current.intake.zip).toBe("19104");
    const staleKey = randomUUID(); await expect(query(sql, [...args.slice(0, 4), staleKey, source, 2])).rejects.toMatchObject({ code: "P0001", message: "parent_reuse_source_changed" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [staleKey])).rows).toEqual([]);
    const invalidKey = randomUUID(); await expect(query(sql, [args[0], args[1], JSON.stringify({ ssn: "123-45-6789" }), notice, invalidKey, source, 1])).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [invalidKey])).rows).toEqual([]);
  });

  it("rejects initial irrelevant intake and broad mandate without leaving a request", async () => {
    await gate();
    for (const [i, m] of [[{ householdSize: 3 }, {}], [{ incomeAmount: 10, incomeFrequency: "monthly" }, {}], [{ needs: ["water"] }, {}], [{}, { mode: "full" }]]) {
      const key = randomUUID(); await expect(query("select public.parent_start_peco_application($1,$2,'{}',$3,$4,true,true)", [JSON.stringify({ ...intake(), ...i }), JSON.stringify({ ...mandate(), ...m }), notice, key])).rejects.toBeTruthy();
      expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [key])).rows).toEqual([]);
    }
  });
  it("keeps the validated ordinary shutoff date on an urgent preparation start without claiming protection", async () => {
    await gate();
    const urgent = { ...intake(), urgency: "today", shutoffDate: "2026-11-15" };
    const request = (await query("select public.parent_start_peco_application($1,$2,'{}',$3,$4,true,true) id", [JSON.stringify(urgent), JSON.stringify(mandate()), notice, randomUUID()])).rows[0].id as string;
    expect((await state(request)).intake).toEqual(urgent);
    expect((await read(request))[0].details).not.toHaveProperty("shutoffDate");
    expect((await fixture.admin.query("select * from public.parent_receipts where request_id=$1", [request])).rows).toEqual([]);
  });

  it("deletes every private revision after processing closure while preserving the shared Auth identity", async () => {
    await gate(); const request = await start(); await save(request, details()); await save(request, {}, 2);
    await fixture.admin.query("update parent_private.processing_controls set enabled=false"); await query("select public.parent_request_deletion()");
    const batch = (await query("select parent_private.parent_claim_cleanup(100) value", [], owner, "parent_retention_worker")).rows[0].value;
    expect(batch.accountIds).toContain(owner);
    await query("select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],$3,array[]::uuid[])", [batch.batchId, batch.leaseToken, batch.accountIds], owner, "parent_retention_worker");
    expect((await fixture.admin.query("select id from public.parent_peco_application_details where request_id=$1", [request])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from auth.users where id=$1", [owner])).rows).toHaveLength(1);
    expect(JSON.stringify((await fixture.admin.query("select * from parent_private.retained_evidence")).rows)).not.toMatch(/PecoPrivateCanary|ChildCanary|9000000001/);
  });

  it("matches direct database validation with the strict route-specific schema", async () => {
    const id = randomUUID(), source = randomUUID();
    const cases: unknown[] = [details(), {}, { journey: "renewal", currentCapState: "enrolled" }, { applicant: { id } }, { applicant: { id, income: { state: "none", sources: [] } } },
      { accountNumber: "9000000001" }, { accountNumber: "123456789" }, { accountNumber: "123-45-6789" }, { ssn: "123-45-6789" },
      { mother: { status: "pregnant" } }, { applicant: { id, firstName: "password=private" } }, { applicant: { id, firstName: "social\u1680security=private" } },
      { applicant: { id, firstName: "１２３／４５／６７８９" } }, { applicant: { id, firstName: "😀".repeat(41) } }, { applicant: { id, dateOfBirth: "2025-02-29" } },
      { applicant: { id }, householdMembers: [{ id }] }, { applicant: {} }, { applicant: null }, { householdMembers: [null] }, { householdComplete: true },
      { smsUpdates: true }, { smsUpdates: true, cellPhone: "215-555-0101" }, { address: { zip: "invalid" } }, { address: { state: "NJ" } },
      { applicant: { id, income: { state: "none", sources: [{ id: source, kind: "employment" }] } } },
      { applicant: { id, income: { state: "sources", sources: [{ id: source, kind: "employment" }, { id: source, kind: "pension" }] } } },
      { applicant: { id, income: { state: "sources", sources: [] } } }, { applicant: { id, income: { state: "unknown", sources: [] } } },
      { applicant: { id, income: { state: "sources", sources: [{ id: source, kind: "employment", amount: 10 }] } } },
    ];
    for (const value of cases) {
      const parsed = pecoApplicationFieldsValueSchema.safeParse(value);
      const result = fixture.admin.query("select parent_private.validate_peco_details($1)", [JSON.stringify(parsed.success ? parsed.data : value)]);
      if (parsed.success) await expect(result).resolves.toBeTruthy(); else await expect(result).rejects.toMatchObject({ code: "23514", message: "invalid PECO details" });
    }
  });
});
