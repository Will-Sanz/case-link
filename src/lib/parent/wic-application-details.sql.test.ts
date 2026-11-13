import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { WIC_APPLICATION_NOTICE_VERSION as notice, WIC_SUBJECT_AUTHORITY_STATEMENT } from "./constants";
import { WIC_APPLICATION_SOURCE, wicApplicationFieldsValueSchema, wicApplicationLeaves } from "./wic-application-fields";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("default-off private WIC revisions against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  let owner: string, session: string;
  const intake = () => fixtureIntake({ needs: ["wic_new"], utilityProviders: [], householdSize: null, childrenUnderFive: null, pregnantOrPostpartum: null });
  const mandate = () => fixtureMandate({ recipientIds: ["wic-pa"], allowedData: ["household"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const details = () => ({ applicationType: "new", beneficiaries: "children", appointmentPreference: "morning",
    contact: { firstName: "WicPrivateCanary", lastName: "Example", street: "1 Synthetic Lane", city: "Philadelphia", county: "Philadelphia", dateOfBirth: "1990-01-01", email: "fictional@example.test", phone: "215-555-0101" },
    children: [{ id: randomUUID(), firstName: "ChildCanary", lastName: "Example", dateOfBirth: "2024-01-01" }] });
  async function query(sql: string, values: unknown[] = [], user = owner, role = "authenticated", userSession = session) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: userSession, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function gate(enabled = true) {
    await fixture.admin.query("update parent_private.processing_controls set wic_details_enabled=$1,wic_details_approval_reference='isolated fictional WIC test',wic_details_approved_until=now()+interval '1 day',wic_details_notice_version=$2", [enabled, notice]);
  }
  async function start(overrides = {}, permission = {}) {
    return (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify({ ...intake(), ...overrides }), JSON.stringify({ ...mandate(), ...permission }), randomUUID()])).rows[0].id as string;
  }
  async function save(request: string, value: unknown, version = 1, key = randomUUID(), suppliedNotice = notice) {
    return (await query("select public.parent_save_wic_application_details($1,$2,$3,$4,$5,true) id", [request, version, JSON.stringify(value), suppliedNotice, key])).rows[0].id as string;
  }
  async function read(request: string) {
    return (await query("select * from public.parent_wic_application_details where request_id=$1 order by revision desc", [request])).rows;
  }
  async function state(request: string) {
    return (await fixture.admin.query("select r.*,(select row_to_json(j) from public.parent_jobs j where j.request_id=r.id) job,(select count(*)::int from public.parent_events e where e.request_id=r.id) events from public.parent_requests r where r.id=$1", [request])).rows[0];
  }
  beforeAll(async () => { fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); });
  beforeEach(async () => {
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated test',approved_until=now()+interval '1 day',existing_accounts_enabled=true");
    await gate(false);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
  });

  it("stays closed even when global processing and the distinct SNAP purpose are enabled", async () => {
    const request = await start();
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true,snap_details_approval_reference='isolated SNAP',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version='snap-application-details-2026-11-03.v1'");
    expect((await query("select public.parent_wic_application_collection() value")).rows[0].value).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
    await expect(save(request, details())).rejects.toMatchObject({ code: "42501" });
    expect(await read(request)).toEqual([]);
    await gate();
    expect((await query("select public.parent_wic_application_collection() value")).rows[0].value).toMatchObject({ collectionEnabled: true, noticeVersion: notice });
  });

  it("returns only the earliest actual WIC/global/source deadline to an authenticated owner without table access", async () => {
    await start(); await gate();
    await expect(query("select * from parent_private.processing_controls")).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update parent_private.processing_controls set approved_until=now()+interval '2 hours',wic_details_approved_until=now()+interval '1 hour'");
    const response = (await query("select public.parent_wic_application_collection() value")).rows[0].value;
    const expected = (await fixture.admin.query("select least(approved_until,wic_details_approved_until,'2026-11-20T18:57:45.283Z'::timestamptz) expiry from parent_private.processing_controls")).rows[0].expiry;
    expect(response.collectionEnabled).toBe(true); expect(new Date(response.expiresAt).toISOString()).toBe(new Date(expected).toISOString());
    expect(Object.keys(response).sort()).toEqual(["collectionEnabled", "expiresAt", "noticeVersion"]);
  });

  it("stores exact immutable owned values/provenance without ZIP, ordinary facts or worker/model exposure", async () => {
    await gate(); const request = await start(), value = details(), before = await state(request);
    const id = await save(request, value), row = (await read(request))[0], after = await state(request);
    expect(row).toMatchObject({ id, request_id: request, revision: 1, base_version: 1, request_version: 2, source: WIC_APPLICATION_SOURCE, notice_version: notice, details: value });
    expect(Object.keys(row.provenance).sort()).toEqual(Object.keys(wicApplicationLeaves(value)).sort());
    expect(row.provenance[`children.${value.children[0].id}.firstName`]).toMatchObject({ source: "parent" });
    expect(row.consent_evidence).toMatchObject({ subjectAuthorityDeclared: true, statement: WIC_SUBJECT_AUTHORITY_STATEMENT,
      actorId: owner, noticeVersion: notice, revision: 1, subjects: ["contact", `children.${value.children[0].id}`] });
    expect((await fixture.admin.query("select consent_evidence->>'detailsSha256'=encode(sha256(convert_to(details::text,'UTF8')),'hex') bound from public.parent_wic_application_details where id=$1", [id])).rows[0].bound).toBe(true);
    expect(after.version).toBe(2); expect(after.job.request_version).toBe(2);
    expect(after.intake).toEqual(before.intake); expect(after.facts).toEqual(before.facts);
    expect(JSON.stringify(after)).not.toMatch(/WicPrivateCanary|ChildCanary/);
    const job = (await query("select parent_private.parent_claim_job(120) value", [], owner, "parent_worker")).rows[0].value;
    expect(JSON.stringify(job)).not.toMatch(/WicPrivateCanary|ChildCanary/);
    await expect(fixture.admin.query("update public.parent_wic_application_details set details='{}' where id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(query("delete from public.parent_wic_application_details where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
    await expect(query("insert into public.parent_wic_application_details select * from public.parent_wic_application_details where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
  });

  it.each(["anon", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker"])("denies raw values and collection RPCs to %s", async role => {
    await gate(); const request = await start(); await save(request, details());
    await expect(query("select * from public.parent_wic_application_details", [], owner, role)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_wic_application_collection()", [], owner, role)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_save_wic_application_details($1,2,'{}',$2,$3,true)", [request, notice, randomUUID()], owner, role)).rejects.toMatchObject({ code: "42501" });
  });

  it("does not give another parent or a school identity access to this household", async () => {
    await gate(); const request = await start(); await save(request, details());
    for (const school of [false, true]) {
      const other = randomUUID(), otherSession = randomUUID();
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [other, `${other}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [otherSession, other]);
      if (school) await fixture.admin.query("insert into public.app_users(id,email,role,is_active) values($1,$2,'admin',true)", [other, `${other}@example.invalid`]);
      if (!school) await query("select public.parent_ensure_account()", [], other, "authenticated", otherSession);
      expect((await query("select * from public.parent_wic_application_details where request_id=$1", [request], other, "authenticated", otherSession)).rows).toEqual([]);
      await expect(query("select public.parent_save_wic_application_details($1,2,'{}',$2,$3,true)", [request, notice, randomUUID()], other, "authenticated", otherSession)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it.each([
    ["continuing journey", { needs: ["wic_continuing"] }, {}], ["SNAP journey", { needs: ["snap_new"] }, { recipientIds: ["snap-pa"] }],
    ["unnamed WIC recipient", {}, { recipientIds: ["uesf-benefits"] }], ["missing preparation permission", {}, { allowedActions: ["research"] }],
    ["missing household permission", {}, { allowedData: ["income"] }],
  ])("rejects %s without mutating ordinary state", async (_label, i, m) => {
    await gate(); const request = await start(i, m), before = await state(request);
    await expect(save(request, details())).rejects.toMatchObject({ code: "42501" });
    expect(await read(request)).toEqual([]); expect(await state(request)).toEqual(before);
  });

  it.each(["purpose_closed", "purpose_expired", "wrong_purpose_notice", "no_reference", "wrong_notice", "global_closed", "cancelled", "revoked", "expired_mandate", "inactive_account", "revoked_session"])("rejects %s even for an exact saved retry", async condition => {
    await gate(); const request = await start(), value = details(), key = randomUUID(); await save(request, value, 1, key);
    if (condition === "purpose_closed") await gate(false);
    if (condition === "purpose_expired") await fixture.admin.query("update parent_private.processing_controls set wic_details_approved_until=now()-interval '1 day'");
    if (condition === "wrong_purpose_notice") await fixture.admin.query("update parent_private.processing_controls set wic_details_notice_version='snap-application-details-2026-11-03.v1'");
    if (condition === "no_reference") await fixture.admin.query("update parent_private.processing_controls set wic_details_approval_reference=' '");
    if (condition === "global_closed") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (condition === "cancelled") await query("select public.parent_control_request($1,'cancel')", [request]);
    if (condition === "revoked") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [request]);
    if (condition === "expired_mandate") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb(now()-interval '1 day')) where id=$1", [request]);
    if (condition === "inactive_account") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [owner]);
    if (condition === "revoked_session") await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 day' where id=$1", [session]);
    await expect(save(request, value, 1, key, condition === "wrong_notice" ? "snap-application-details-2026-11-03.v1" : notice)).rejects.toMatchObject({ code: "42501" });
    if (["global_closed", "inactive_account", "revoked_session"].includes(condition)) expect(await read(request)).toEqual([]);
  });

  it("requires genuine subject authority on every save and exact retry, rather than inferring it from account ownership", async () => {
    await gate(); const request = await start(), value = details(), key = randomUUID();
    for (const declaration of [false, null])
      await expect(query("select public.parent_save_wic_application_details($1,1,$2,$3,$4,$5)", [request, JSON.stringify(value), notice, key, declaration])).rejects.toMatchObject({ code: "42501" });
    await save(request, value, 1, key);
    await expect(query("select public.parent_save_wic_application_details($1,1,$2,$3,$4,false)", [request, JSON.stringify(value), notice, key])).rejects.toMatchObject({ code: "42501" });
    const changed = { ...value, children: [...value.children, { id: randomUUID(), firstName: "AdditionalChild" }] };
    await expect(query("select public.parent_save_wic_application_details($1,2,$2,$3,$4,false)", [request, JSON.stringify(changed), notice, randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await save(request, changed, 2);
    const rows = await read(request);
    expect(rows[0].consent_evidence.subjects).toContain(`children.${changed.children[1].id}`);
    expect(rows[0].consent_evidence.detailsSha256).not.toBe(rows[1].consent_evidence.detailsSha256);
    expect(rows[1].consent_evidence.subjects).not.toContain(`children.${changed.children[1].id}`);
  });

  it("allows current in-scope corrections while paused and keeps all execution stopped", async () => {
    await gate(); const request = await start(), value = details(); await save(request, value);
    await query("select public.parent_control_request($1,'pause')", [request]);
    const paused = await state(request);
    await save(request, { ...value, contact: { ...value.contact, street: "2 Synthetic Lane" } }, paused.version);
    const updated = await state(request);
    expect(updated.status).toBe("paused"); expect(updated.job.state).toBe("cancelled"); expect(updated.next_actor).toBe("parent");
    expect(updated.version).toBe(paused.version + 1);
  });

  it("keeps unchanged original provenance on no-op/reordered saves and invalidates corrected work", async () => {
    await gate(); const request = await start(), value = details(); value.children.push({ ...value.children[0], id: randomUUID(), firstName: "OtherChild" });
    const key = randomUUID(), id = await save(request, value, 1, key), original = (await read(request))[0], before = await state(request);
    expect(await save(request, value, 1, key)).toBe(id); expect(await state(request)).toEqual(before);
    const reordered = { ...value, children: [...value.children].reverse() };
    await save(request, reordered, 2); expect((await read(request))[0].provenance).toEqual(original.provenance); expect(await state(request)).toEqual(before);
    await expect(save(request, value, 1, key)).rejects.toMatchObject({ code: "40001" });
    await save(request, { ...reordered, contact: { ...value.contact, street: "2 Synthetic Lane" } }, 2);
    const current = (await read(request))[0];
    expect({ ...current.provenance, "contact.street": original.provenance["contact.street"] }).toEqual(original.provenance);
    expect((await state(request)).version).toBe(3);
    expect((await read(request))).toHaveLength(3);
  });

  it("invalidates added empty child records and rejects changed future birth dates", async () => {
    await gate(); const request = await start(); await save(request, { beneficiaries: "children", children: [] });
    await save(request, { beneficiaries: "children", children: [{ id: randomUUID() }] }, 2);
    expect((await state(request)).version).toBe(3);
    await expect(save(request, { contact: { dateOfBirth: "2099-01-01" } }, 3)).rejects.toMatchObject({ code: "23514" });
  });

  it("starts atomically with reviewed routing reuse, preserves its original dates and stores no duplicate postal ZIP", async () => {
    await gate(); const source = await start({ needs: ["food_now"] }, { recipientIds: ["philly-food"] });
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',to_jsonb(now()-interval '5 days')) where id=$1", [source]);
    const value = details(), key = randomUUID();
    const args = [JSON.stringify(intake()), JSON.stringify(mandate()), JSON.stringify(value), notice, key, source, 1];
    const sql = "select public.parent_start_wic_application($1,$2,$3,$4,$5,true,$6,$7) id";
    const request = (await query(sql, args)).rows[0].id as string;
    expect((await query(sql, args)).rows[0].id).toBe(request);
    const saved = (await read(request))[0], current = await state(request), original = await state(source);
    expect(current.intake_confirmed_at.zip).toEqual(original.intake_confirmed_at.zip);
    expect(current.intake_reuse.zip.sourceRequestId).toBe(source);
    expect(JSON.stringify(saved)).not.toMatch(/"zip"|postalZip|19104/);
    await expect(query(sql, [...args.slice(0, 5), source, 2])).rejects.toMatchObject({ code: "40001" });
    const failedKey = randomUUID();
    await expect(query(sql, [args[0], args[1], JSON.stringify({ contact: { zip: "invalid" } }), notice, failedKey, source, 1])).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [failedKey])).rows).toEqual([]);
    const staleKey = randomUUID();
    await expect(query(sql, [args[0], args[1], JSON.stringify(value), notice, staleKey, source, 2])).rejects.toMatchObject({ code: "P0001", message: "parent_reuse_source_changed" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [staleKey])).rows).toEqual([]);
  });

  it("records a genuinely supplied contact postal ZIP separately from reused household routing", async () => {
    await gate(); const source = await start({ needs: ["food_now"] }, { recipientIds: ["philly-food"] });
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',to_jsonb(now()-interval '5 days')) where id=$1", [source]);
    const value = { ...details(), contact: { ...details().contact, zip: "19147" } };
    const request = (await query("select public.parent_start_wic_application($1,$2,$3,$4,$5,true,$6,1) id",
      [JSON.stringify(intake()), JSON.stringify(mandate()), JSON.stringify(value), notice, randomUUID(), source])).rows[0].id as string;
    const saved = (await read(request))[0], ordinary = await state(request);
    expect(saved.details.contact.zip).toBe("19147"); expect(ordinary.intake.zip).toBe("19104");
    expect(Date.parse(saved.provenance["contact.zip"].confirmedAt)).toBeGreaterThan(Date.parse(ordinary.intake_confirmed_at.zip));
    await query("select public.parent_correct_request($1,$2,1)", [source, JSON.stringify({ ...intake(), needs: ["food_now"], zip: "19120" })]);
    expect((await state(request)).intake.zip).toBe("19120"); expect((await read(request))[0].details.contact.zip).toBe("19147");
    expect((await read(request))[0].provenance["contact.zip"]).toEqual(saved.provenance["contact.zip"]);
  });

  it.each([{ householdSize: 3 }, { incomeAmount: 100, incomeFrequency: "monthly" }, { utilityProviders: ["peco"] }, { needs: ["wic_continuing"] }, { needs: ["wic_new", "electricity"] }])("rejects irrelevant ordinary data before creating an initial WIC-private request", async override => {
    await gate(); const key = randomUUID();
    await expect(query("select public.parent_start_wic_application($1,$2,'{}',$3,$4,true)", [JSON.stringify({ ...intake(), ...override }), JSON.stringify(mandate()), notice, key])).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select id from public.parent_requests where start_key=$1", [key])).rows).toEqual([]);
  });

  it("deletes WIC history through account cleanup after processing closure without deleting the shared identity", async () => {
    await gate(); const request = await start(); await save(request, details());
    await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    await query("select public.parent_request_deletion()");
    const batch = (await query("select parent_private.parent_claim_cleanup(100) value", [], owner, "parent_retention_worker")).rows[0].value;
    expect(batch.accountIds).toContain(owner);
    await query("select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],$3,array[]::uuid[])", [batch.batchId, batch.leaseToken, batch.accountIds], owner, "parent_retention_worker");
    expect((await fixture.admin.query("select id from public.parent_wic_application_details where request_id=$1", [request])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from public.parent_accounts where id=$1", [owner])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from auth.users where id=$1", [owner])).rows).toHaveLength(1);
  });

  it("cascades every immutable revision through retention and preserves the shared Auth identity", async () => {
    await gate(); const request = await start(); await save(request, details()); await save(request, {}, 2);
    await query("select public.parent_control_request($1,'cancel')", [request]);
    await fixture.admin.query("update public.parent_requests set updated_at=now()-interval '91 days' where id=$1", [request]);
    const batch = (await query("select parent_private.parent_claim_cleanup(100) value", [], owner, "parent_retention_worker")).rows[0].value;
    expect(batch.requestIds).toContain(request);
    await query("select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],array[]::uuid[],array[]::uuid[])", [batch.batchId, batch.leaseToken], owner, "parent_retention_worker");
    expect((await fixture.admin.query("select id from public.parent_wic_application_details where request_id=$1", [request])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from auth.users where id=$1", [owner])).rows).toHaveLength(1);
    expect(JSON.stringify((await fixture.admin.query("select * from parent_private.retained_evidence")).rows)).not.toMatch(/WicPrivateCanary|ChildCanary/);
  });

  it("matches the strict private schema and rejects cross-purpose fields and private canaries", async () => {
    const id = randomUUID();
    const cases: unknown[] = [details(), {}, { beneficiaries: "children", children: [{ id }] }, { beneficiaries: "mother", mother: { status: "pregnant" } },
      { contact: { zip: "invalid" } }, { contact: { postalZip: "19104" } }, { kind: "synthetic_rehearsal" },
      { ssn: "123-45-6789" }, { acknowledgment: true }, { contact: { firstName: "１２３／４５／６７８９" } },
      { contact: { firstName: "password=private" } }, { contact: { firstName: "😀".repeat(26) } },
      { contact: { firstName: "123\u168045\u16806789" } }, { contact: { firstName: "social\u1680security=private" } },
      { contact: { email: "bad@email" } }, { contact: { email: "test..user@example.test" } }, { contact: { phone: "Call me" } },
      { beneficiaries: "children", children: [{ id }, { id }] }, { beneficiaries: "children", children: [{}] },
      { beneficiaries: "children", children: [{ id, race: ["W"] }] }, { mother: { status: "pregnant" } },
      { beneficiaries: "mother", mother: { status: "postpartum", expectedDeliveryDate: "2027-01-01" } },
      { beneficiaries: "mother", mother: { status: "pregnant", dateOfBirth: "1990-01-01", expectedDeliveryDate: "1989-01-01" } },
      { contact: { dateOfBirth: "2025-02-29" } }, { "contact.firstName": "private" }, { contact: null },
    ];
    for (const value of cases) {
      const parsed = wicApplicationFieldsValueSchema.safeParse(value);
      const result = fixture.admin.query("select parent_private.validate_wic_details($1)", [JSON.stringify(parsed.success ? parsed.data : value)]);
      if (parsed.success) await expect(result).resolves.toBeTruthy();
      else await expect(result).rejects.toMatchObject({ code: "23514", message: "invalid WIC details" });
    }
  });
});
