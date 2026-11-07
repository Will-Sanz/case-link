import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_SOURCE, snapApplicationFieldsValueSchema } from "./snap-application-fields";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const notice = "snap-application-details-2026-11-03.v1";
describe.skipIf(!modulePath)("private SNAP application snapshots against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  let today: string;
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const sessions = new Map(users.map(id => [id, randomUUID()]));
  const owner = users[0], other = users[1], staff = users[2];
  const person = randomUUID(), child = randomUUID(), incomeId = randomUUID();
  const intake = () => fixtureIntake({ needs: ["snap_new"], utilityProviders: [], householdSize: 2 });
  const mandate = () => fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const details = () => ({
    zip: "19104", language: "en", householdSize: 2,
    applicant: { firstName: "Mira", lastName: "Example" }, address: { street: "1 Example St", city: "Philadelphia", state: "PA" },
    county: "Philadelphia", interpreter: false,
    screening: { lowCashAndIncome: false, migrantOrSeasonal: false, belowShelterCosts: false },
    household: [{ id: person, firstName: "Mira", lastName: "Example", dateOfBirth: "1990-01-01", relationship: "SELF", requestingSnap: true, citizen: true },
      { id: child, firstName: "Alex", lastName: "Example", dateOfBirth: "2016-01-01", relationship: "CHILD", requestingSnap: false }],
    income: { month: today.slice(0, 7), hasIncome: true, entries: [{ id: incomeId, personId: person, source: "Work", amount: 120, frequency: "weekly", status: "received", date: today }] },
    history: { fleeingOrProbation: { answer: false }, welfareFraud: { answer: false }, otherStateDisqualification: { answer: false } },
    expenses: { rent: 800 }, expenseClaims: { household: "claim", housing: ["rent"], medical: "not_applicable" },
  });
  async function query(sql: string, values: unknown[] = [], user = owner, role = "authenticated") {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: sessions.get(user), role,
        amr: [{ method: user === staff ? "password" : "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function gate(enabled = true) {
    await fixture.admin.query(`update parent_private.processing_controls set snap_details_enabled=$1,
      snap_details_approval_reference='isolated synthetic SNAP purpose',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$2`, [enabled, notice]);
  }
  async function start(user = owner, overrideMandate = {}, overrideIntake = {}) {
    const active = await query("select id from public.parent_requests where status in ('active','paused')", [], user);
    for (const row of active.rows) await query("select public.parent_control_request($1,'cancel')", [row.id], user);
    return (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify({ ...intake(), ...overrideIntake }),
      JSON.stringify({ ...mandate(), ...overrideMandate }), randomUUID()], user)).rows[0].id as string;
  }
  async function save(request: string, value: unknown = details(), version = 1, key = randomUUID(), user = owner, suppliedNotice = notice) {
    return (await query("select public.parent_save_snap_application_details($1,$2,$3,$4,$5) id", [request, version, JSON.stringify(value), suppliedNotice, key], user)).rows[0].id as string;
  }
  async function read(request: string, user = owner) {
    return (await query("select * from public.parent_snap_application_details where request_id=$1 order by revision desc", [request], user)).rows;
  }
  async function state(request: string) {
    return (await fixture.admin.query(`select r.version,r.updated_at,r.facts,r.intake,r.intake_confirmed_at,
      (select row_to_json(j) from public.parent_jobs j where j.request_id=r.id) job,
      (select count(*)::int from public.parent_events e where e.request_id=r.id) events
      from public.parent_requests r where r.id=$1`, [request])).rows[0];
  }
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated SNAP test',approved_until=now()+interval '1 day',existing_accounts_enabled=true");
    today = (await fixture.admin.query("select to_char(now() at time zone 'America/New_York','YYYY-MM-DD') today")).rows[0].today;
    for (const id of users) {
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [sessions.get(id), id]);
    }
    await fixture.admin.query("insert into public.app_users(id,email,role,is_active) values($1,'staff@example.invalid','admin',true)", [staff]);
  });
  afterAll(async () => { await fixture?.admin.end(); });

  it("defaults collection closed independently of globally enabled processing", async () => {
    const request = await start();
    expect(Object.keys((await query("select public.parent_authorization_window() value")).rows[0].value).sort()).toEqual(["expiresAt", "issuedAt"]);
    expect((await query("select public.parent_snap_application_collection() value")).rows[0].value).toEqual({ collectionEnabled: false, noticeVersion: null });
    await expect(save(request)).rejects.toMatchObject({ code: "42501" });
    expect(await read(request)).toEqual([]);
    expect((await state(request)).version).toBe(1);
    await gate();
    expect((await query("select public.parent_snap_application_collection() value")).rows[0].value).toEqual({ collectionEnabled: true, noticeVersion: notice });
  });
  it("stores one owned immutable snapshot with exact source and server-owned evidence, outside ordinary facts", async () => {
    const request = await start(), before = await state(request);
    const id = await save(request), row = (await read(request))[0], after = await state(request);
    expect(row).toMatchObject({ id, request_id: request, revision: 1, base_version: 1, request_version: 2, notice_version: notice, details: details(), source: SNAP_APPLICATION_SOURCE });
    expect(row.provenance[`household.${person}.firstName`]).toMatchObject({ source: "parent", asOf: today });
    expect(row.provenance[`income.entries.${incomeId}.amount`]).toMatchObject({ source: "parent", asOf: today, period: today.slice(0, 7) });
    expect(row.provenance[`household.${person}.id`]).toBeUndefined();
    expect(after).toMatchObject({ version: 2, facts: before.facts, intake: before.intake, intake_confirmed_at: before.intake_confirmed_at, job: { request_version: 2, state: "queued" } });
    const ordinary = JSON.stringify(await state(request));
    expect(ordinary).not.toContain("Mira"); expect(ordinary).not.toContain("1 Example St");
    await expect(fixture.admin.query("update public.parent_snap_application_details set details='{}' where id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(query("insert into public.parent_snap_application_details select * from public.parent_snap_application_details where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
    await expect(query("delete from public.parent_snap_application_details where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
  });
  it("isolates other parents and school roles while allowing explicit shared-account ownership", async () => {
    const request = await start(); await save(request);
    await query("select public.parent_ensure_account()", [], other);
    expect(await read(request, other)).toEqual([]);
    expect(await read(request, staff)).toEqual([]);
    await expect(save(request, details(), 2, randomUUID(), other)).rejects.toMatchObject({ code: "42501" });
    await expect(save(request, details(), 2, randomUUID(), staff)).rejects.toMatchObject({ code: "42501" });
    const owned = await start(staff); await save(owned, details(), 1, randomUUID(), staff);
    expect(await read(owned, staff)).toHaveLength(1);
    await expect(query("select * from public.parent_snap_application_details", [], owner, "anon")).rejects.toMatchObject({ code: "42501" });
    await expect(query("select * from public.parent_snap_application_details", [], owner, "parent_worker")).rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_snap_application_collection()", [], owner, "anon")).rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_snap_application_collection()", [], owner, "parent_worker")).rejects.toMatchObject({ code: "42501" });
  });
  it.each([
    ["wrong need", {}, { needs: ["food_now"] }], ["wrong recipient", { recipientIds: ["philly-food"] }, {}],
    ["no prepare", { allowedActions: ["research"] }, {}], ["no household permission", { allowedData: ["income"] }, {}],
    ["no income permission", { allowedData: ["household"] }, {}],
  ])("rejects %s without any snapshot or request mutation", async (_name, m, i) => {
    const request = await start(owner, m, i), before = await state(request);
    await expect(save(request)).rejects.toMatchObject({ code: "42501" });
    expect(await state(request)).toEqual(before); expect(await read(request)).toEqual([]);
  });
  it.each(["expired", "revoked", "paused", "account_inactive", "global_closed", "purpose_closed", "wrong_notice", "purpose_expired", "purpose_notice", "purpose_missing_reference"])("rejects %s after a previous save, including an exact retry", async kind => {
    const request = await start(), key = randomUUID(); await save(request, details(), 1, key);
    if (kind === "expired") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb(now()-interval '1 day')),version=version+1 where id=$1", [request]);
    if (kind === "revoked") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [request]);
    if (kind === "paused") await query("select public.parent_control_request($1,'pause')", [request]);
    if (kind === "account_inactive") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [owner]);
    if (kind === "global_closed") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (kind === "purpose_closed") await gate(false);
    if (kind === "purpose_expired") await fixture.admin.query("update parent_private.processing_controls set snap_details_approved_until=now()-interval '1 day'");
    if (kind === "purpose_notice") await fixture.admin.query("update parent_private.processing_controls set snap_details_notice_version='not-approved'");
    if (kind === "purpose_missing_reference") await fixture.admin.query("update parent_private.processing_controls set snap_details_approval_reference=' '");
    try {
      await expect(save(request, details(), 1, key, owner, kind === "wrong_notice" ? "not-approved" : notice)).rejects.toMatchObject({ code: "42501" });
      if (kind === "global_closed" || kind === "account_inactive") expect(await read(request)).toEqual([]);
    } finally {
      await fixture.admin.query("update parent_private.processing_controls set enabled=true");
      await fixture.admin.query("update public.parent_accounts set status='active' where id=$1", [owner]);
      await gate();
    }
  });
  it.each(["anonymous_identity", "revoked_session", "banned_identity"])("does not accept a stale token or %s for owned reads or writes", async kind => {
    const request = await start(), key = randomUUID(); await save(request, details(), 1, key);
    if (kind === "anonymous_identity") await fixture.admin.query("update auth.users set is_anonymous=true where id=$1", [owner]);
    if (kind === "revoked_session") await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 day' where id=$1", [sessions.get(owner)]);
    if (kind === "banned_identity") await fixture.admin.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [owner]);
    try {
      expect(await read(request)).toEqual([]);
      await expect(save(request, details(), 1, key)).rejects.toMatchObject({ code: "42501" });
      await expect(query("select public.parent_authorization_window()")).rejects.toMatchObject({ code: "42501" });
      await expect(query("select public.parent_snap_application_collection()")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await fixture.admin.query("update auth.users set is_anonymous=false,banned_until=null where id=$1", [owner]);
      await fixture.admin.query("update auth.sessions set not_after=now()+interval '1 hour' where id=$1", [sessions.get(owner)]);
    }
  });
  it("binds exact retries and stale versions without extending facts, retention, jobs or events", async () => {
    const request = await start(), key = randomUUID(), value = details(), id = await save(request, value, 1, key);
    const before = await state(request), original = (await read(request))[0];
    expect(await save(request, value, 1, key)).toBe(id);
    expect(await state(request)).toEqual(before); expect(await read(request)).toEqual([original]);
    await expect(save(request, { ...value, county: "Other" }, 1, key)).rejects.toMatchObject({ code: "40001" });
    await expect(save(request, value, 1)).rejects.toMatchObject({ code: "40001" });
    const noOpKey = randomUUID(), noOp = await save(request, value, 2, noOpKey);
    expect(noOp).not.toBe(id); expect(await state(request)).toEqual(before);
    expect((await read(request))[0].provenance).toEqual(original.provenance);
    await expect(save(request, value, 1, key)).rejects.toMatchObject({ code: "40001" });
    await expect(save(request, { ...value, county: "Other" }, 2, noOpKey)).rejects.toMatchObject({ code: "40001" });
  });
  it("preserves stable per-field evidence through row reorder and changes only a corrected field", async () => {
    const request = await start(), value = details();
    value.household.push({ ...value.household[1], id: randomUUID(), firstName: "Sam" }); value.householdSize = 3;
    value.income.entries.push({ ...value.income.entries[0], id: randomUUID(), source: "Other work" });
    await save(request, value); const original = (await read(request))[0];
    const reordered = { ...value, household: [value.household[0], value.household[2], value.household[1]], income: { ...value.income, entries: [...value.income.entries].reverse() } };
    await save(request, reordered, 2);
    expect((await read(request))[0].provenance).toEqual(original.provenance);
    const before = await state(request);
    expect(before.version).toBe(2);
    await save(request, { ...reordered, address: { ...value.address, street: "2 Example St" } }, 2);
    const current = (await read(request))[0], path = "address.street";
    expect({ ...current.provenance, [path]: original.provenance[path] }).toEqual(original.provenance);
    expect((await state(request)).version).toBe(3);
  });
  it("invalidates an added representative group even before its indispensable answers are known", async () => {
    const request = await start(), value = { county: "Philadelphia" };
    await save(request, value);
    const original = (await read(request))[0];
    await save(request, { ...value, authorizedRepresentative: {} }, 2);
    expect((await state(request)).version).toBe(3);
    expect((await read(request))[0].provenance).toEqual(original.provenance);
  });
  it("keeps unchanged historical income readable/editable and requires a current month for changed income", async () => {
    const request = await start(), value = details(), oldMonth = "2026-01";
    const historical = { ...value, income: { ...value.income, month: oldMonth, entries: [{ ...value.income.entries[0], date: "2026-01-05" }] } };
    const historicalEvidence = { "income.month": { source: "parent", confirmedAt: "2026-01-05T12:00:00Z", asOf: "2026-01-05", period: oldMonth },
      [`income.entries.${incomeId}.amount`]: { source: "parent", confirmedAt: "2026-01-05T12:00:00Z", asOf: "2026-01-05", period: oldMonth } };
    await fixture.admin.query(`insert into public.parent_snap_application_details(request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key)
      values($1,1,1,1,$2,$3,$4,$5,$6)`, [request, JSON.stringify(historical), JSON.stringify(historicalEvidence), JSON.stringify(SNAP_APPLICATION_SOURCE), notice, randomUUID()]);
    await save(request, { ...historical, address: { ...value.address, street: "2 Example St" } });
    const saved = (await read(request))[0];
    expect(saved.details.income).toEqual(historical.income);
    expect(saved.provenance[`income.entries.${incomeId}.amount`]).toEqual(historicalEvidence[`income.entries.${incomeId}.amount`]);
    await expect(save(request, { ...historical, income: { ...historical.income, entries: [{ ...historical.income.entries[0], amount: 140 }] } }, 2)).rejects.toMatchObject({ code: "23514" });
    await save(request, value, 2);
    const refreshed = (await read(request))[0];
    expect(refreshed.provenance[`income.entries.${incomeId}.amount`]).toMatchObject({ asOf: today, period: today.slice(0, 7) });
    await save(request, { income: { hasIncome: false } }, 3);
    await save(request, {}, 4);
    expect((await read(request))[0].details).toEqual({});
  });
  it("reuses fresh scoped ZIP/language source dates without reconstructing roster or income from aggregates", async () => {
    const request = await start();
    const original = "2026-11-01T12:00:00Z";
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(jsonb_set(intake_confirmed_at,'{zip}',to_jsonb($2::timestamptz)),'{language}',to_jsonb($2::timestamptz)) where id=$1", [request, original]);
    await save(request, { zip: "19104", language: "en" });
    const row = (await read(request))[0];
    expect(new Date(row.provenance.zip.confirmedAt).toISOString()).toBe(new Date(original).toISOString());
    expect(row.provenance.language.asOf).toBe("2026-11-01");
    expect(row.details).toEqual({ zip: "19104", language: "en" });
  });
  it("atomically starts one request, answers and a current job; same initial key cannot outlive a correction", async () => {
    const key = randomUUID(), value = details(), args = [JSON.stringify(intake()), JSON.stringify(mandate()), JSON.stringify(value), notice, key];
    const sql = "select public.parent_start_snap_application($1,$2,$3,$4,$5) id";
    const request = (await query(sql, args)).rows[0].id;
    expect((await read(request))[0]).toMatchObject({ idempotency_key: key, request_version: 2 });
    const before = await state(request);
    expect((await query(sql, args)).rows[0].id).toBe(request); expect(await state(request)).toEqual(before);
    await expect(query(sql, [...args.slice(0, 2), JSON.stringify({ ...value, county: "Other" }), notice, key])).rejects.toMatchObject({ code: "40001" });
    await save(request, { ...value, county: "Other" }, 2);
    await expect(query(sql, args)).rejects.toMatchObject({ code: "40001" });
  });
  it("rolls back the initial request and queued job if the details or permission fail", async () => {
    const key = randomUUID(), m = mandate();
    await expect(query("select public.parent_start_snap_application($1,$2,$3,$4,$5)", [JSON.stringify(intake()), JSON.stringify(m), JSON.stringify({ ssn: "123-45-6789" }), notice, key])).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [key])).rows).toEqual([]);
    await expect(query("select public.parent_start_snap_application($1,$2,$3,$4,$5)", [JSON.stringify(intake()), JSON.stringify({ ...m, allowedActions: ["research"] }), JSON.stringify(details()), notice, key])).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [key])).rows).toEqual([]);
  });
  it("inherits request deletion and existing retention without deleting shared Auth identity", async () => {
    const request = await start(staff); await save(request, details(), 1, randomUUID(), staff);
    await query("select public.parent_control_request($1,'cancel')", [request], staff);
    await fixture.admin.query("update public.parent_requests set updated_at=now()-interval '91 days' where id=$1", [request]);
    const expired = (await query("select parent_private.parent_claim_cleanup(100) batch", [], owner, "parent_retention_worker")).rows[0].batch;
    expect(expired.requestIds).toContain(request);
    await query("select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],array[]::uuid[],array[]::uuid[])", [expired.batchId, expired.leaseToken], owner, "parent_retention_worker");
    expect((await fixture.admin.query("select id from public.parent_snap_application_details where request_id=$1", [request])).rows).toEqual([]);
    const deleted = await start(staff); await save(deleted, details(), 1, randomUUID(), staff);
    await query("select public.parent_request_deletion()", [], staff);
    const account = (await query("select parent_private.parent_claim_cleanup(100) batch", [], owner, "parent_retention_worker")).rows[0].batch;
    expect(account.accountIds).toContain(staff);
    await query("select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],$3,array[]::uuid[])", [account.batchId, account.leaseToken, account.accountIds], owner, "parent_retention_worker");
    expect((await fixture.admin.query("select id from public.parent_snap_application_details where request_id=$1", [deleted])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from public.parent_accounts where id=$1", [staff])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from auth.users where id=$1", [staff])).rows).toHaveLength(1);
    expect(JSON.stringify((await fixture.admin.query("select * from parent_private.retained_evidence")).rows)).not.toContain("Mira");
  });
  it("bounds repeated no-op save keys and still permits the exact current retry", async () => {
    const request = await start(), value = { county: "Philadelphia" };
    let key = randomUUID(), id = await save(request, value, 1, key);
    for (let i = 1; i < 20; i++) { key = randomUUID(); id = await save(request, value, 2, key); }
    await expect(save(request, value, 2)).rejects.toMatchObject({ code: "23514" });
    expect(await save(request, value, 2, key)).toBe(id);
  });
  it("matches the strict shared value contract on protected, malformed and conditional fields", async () => {
    const good = details();
    const cases: unknown[] = [good, {}, { phone: "+1 (215) 555-0100" }, { household: [{ id: person }] },
      { household: [{ id: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" }] },
      { ssn: "123-45-6789" }, { applicant: { signature: "Mira" } }, { applicant: { "123-45-6789": "hidden key" } },
      { applicant: { firstName: "１２３／４５／６７８９" } }, { address: { street: "password: private" } }, { phone: "Call me" },
      { applicant: { firstName: "é123-45-6789é" } }, { applicant: { firstName: "épassword=synthetic" } },
      { applicant: { firstName: "123\u168045\u16806789" } }, { applicant: { firstName: "social\u1680security=private" } },
      { applicant: { firstName: "password\u1680is\u1680private" } },
      { applicant: { firstName: "\u00a0" } }, { applicant: { firstName: "😀".repeat(50) } },
      { household: [{ id: person, citizen: true }] }, { household: [{ id: person }, { id: person }] },
      { household: [{ id: person, relationship: "CHILD" }] }, { household: [{ id: person, dateOfBirth: "2026-02-30" }] },
      { income: { entries: [{ id: incomeId, personId: child }] } }, { income: { hasIncome: false, entries: [{ id: incomeId }] } },
      { history: { welfareFraud: { answer: false, names: "Example" } } }, { expenses: { outsidePayer: false, outsideAmount: 0 } },
      { expenses: { medical: ["doctor", "doctor"] } }, { expenseClaims: { housing: ["rent", "rent"] } },
      { expenses: { otherUtility: "Example" } }, { expenses: { rent: 1 }, expenseClaims: { housing: [] } },
      { language: "en", otherLanguage: "Spanish" }, { interpreter: false, interpreterLanguage: "Spanish" },
      { "applicant.firstName": "Allowed-looking dotted key" }, { expenses: { unknown: {} } }, { household: {} }, { income: { entries: [null] } },
    ];
    for (const value of cases) {
      const expected = snapApplicationFieldsValueSchema.safeParse(value).success;
      const result = fixture.admin.query("select parent_private.validate_snap_details($1)", [JSON.stringify(value)]);
      if (expected) await expect(result).resolves.toBeTruthy();
      else await expect(result).rejects.toMatchObject({ code: "23514", message: "invalid application details" });
    }
  });
});
