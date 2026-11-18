import { SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID, SNAP_SPANISH_APPLICATION_SOURCE } from "./snap-form-source";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileReadSchema, type FamilyProfileSource } from "./family-profile";
import { projectFamilyProfileApplication, type FamilyProfileApplicationProgram } from "./family-profile-application";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE, confirmedAt = new Date("2026-11-16T18:00:00Z"), at = new Date("2026-11-17T18:00:00Z");
const programs = {
  "snap-pa": { kind: "snap_application", need: "snap_new", provider: null, notice: "snap-application-details-2026-11-03.v1", table: "parent_snap_application_details" },
  "wic-pa": { kind: "wic_application", need: "wic_new", provider: null, notice: "wic-application-details-2026-11-13.v1", table: "parent_wic_application_details" },
  "peco-cap": { kind: "peco_application", need: "electricity", provider: "peco", notice: "peco-application-details-2026-11-13.v1", table: "parent_peco_application_details" },
  "pgw-crp": { kind: "pgw_application", need: "gas", provider: "pgw", notice: "pgw-application-details-2026-11-13.v1", table: "parent_pgw_application_details" },
  "pwd-tap": { kind: "water_application", need: "water", provider: "pwd", notice: "water-application-details-2026-11-13.v1", table: "parent_water_application_details" },
} as const;
describe.skipIf(!modulePath)("atomic fixed programme reuse of owned family basics", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string, primary: string, child: string, adult: string;
  async function query(sql: string, values: unknown[] = [], role = "authenticated", user = owner, token = session) {
    await fixture.admin.query(`set role ${role}`); try { await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: token, role, amr: [{ method: "otp" }] })]); return await fixture.admin.query(sql, values); }
    finally { await fixture.admin.query("reset role"); }
  }
  const profileDetails = () => ({ primaryPerson: { id: primary, firstName: "Fictional", lastName: "Rivera", middleInitial: "Q", dateOfBirth: "1990-01-01", income: { state: "sources", sources: [{ id: randomUUID(), kind: "employment" }] } },
    members: [{ id: child, firstName: "Child", lastName: "Rivera", dateOfBirth: "2023-01-01", relationship: "Child", income: { state: "none", sources: [] } }, { id: adult, firstName: "Other", lastName: "Adult", dateOfBirth: "1990-01-01", relationship: "Sibling", income: { state: "unknown", sources: [] } }],
    homeAddress: { street: "123 Synthetic Lane", apartment: "Unit 2", city: "Philadelphia", state: "PA", zip: "19104", county: "Philadelphia" },
    mailingAddress: { street: "456 Synthetic Avenue", city: "Philadelphia", state: "PA", zip: "19103", county: "Philadelphia" }, contact: { phone: "215-555-0101", email: "fictional@example.invalid" }, preferredLanguage: "es" });
  async function profile() { return familyProfileReadSchema.parse((await query("select public.parent_get_family_profile() value")).rows[0].value).profile!; }
  async function input(program: FamilyProfileApplicationProgram, options: FamilyProfileSource["options"] = { useHomeAddress: true, pecoPhoneType: "cell", wicChildIds: [child] }) {
    const sourceProfile = await profile(), meta = programs[program];
    const projection = projectFamilyProfileApplication(sourceProfile, program, { now: at, accountAuthority: "self", wicBeneficiaries: "children", ...options });
    const details = { ...projection.details, ...(program === "peco-cap" || program === "pgw-crp" ? { accountNumber: "9000000001" } : {}) };
    return { program, meta, details, key: randomUUID(), source: { expectedOwnerId: owner, revision: sourceProfile.revision, fields: projection.fields, options },
      intake: fixtureIntake({ needs: [meta.need], utilityProviders: meta.provider ? [meta.provider] : [], householdSize: null, language: "es", accountAuthority: "self" }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: [program], allowedActions: ["research", "prepare"], allowedData: meta.provider ? ["household", "income", "utility"] : ["household", "income"], expiresAt: new Date(at.getTime() + 86400000).toISOString() }) };
  }
  async function start(value: Awaited<ReturnType<typeof input>>) {
    return (await query("select public.parent_start_application_with_family_profile($1,$2,$3,$4,$5,$6,$7,true,true) id", [value.meta.kind, JSON.stringify(value.intake), JSON.stringify(value.mandate), JSON.stringify(value.details), value.meta.notice, value.key, JSON.stringify(value.source)])).rows[0].id as string;
  }
  async function save(value: Awaited<ReturnType<typeof input>>, id: string, version: number, source: unknown = value.source, key = randomUUID(), confirmed: string[] = []) {
    return (await query("select public.parent_save_application_with_family_profile($1,$2,$3,$4,$5,$6,$7,true,true,$8) id", [value.meta.kind, id, version, JSON.stringify(value.details), value.meta.notice, key, source === null ? null : JSON.stringify(source), confirmed])).rows[0].id as string;
  }
  async function snapshot(value: Awaited<ReturnType<typeof input>>, id: string) { return (await fixture.admin.query(`select * from public.${value.meta.table} where request_id=$1 order by revision desc limit 1`, [id])).rows[0]; }
  beforeAll(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(confirmedAt); fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.setSystemTime(confirmedAt); owner = randomUUID(); session = randomUUID(); primary = randomUUID(); child = randomUUID(); adult = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '90 days',existing_accounts_enabled=true,family_profile_enabled=true,family_profile_approval_reference='synthetic only',family_profile_approved_until=now()+interval '90 days',family_profile_notice_version=$1", [FAMILY_PROFILE_NOTICE_VERSION]);
    for (const prefix of ["snap", "wic", "peco", "pgw", "water"]) await fixture.admin.query(`update parent_private.processing_controls set ${prefix}_details_enabled=true,${prefix}_details_approval_reference='synthetic only',${prefix}_details_approved_until=now()+interval '2 days',${prefix}_details_notice_version=$1`, [Object.values(programs).find(item => item.kind.startsWith(prefix))!.notice]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]); await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')", [session, owner]);
    await query("select public.parent_ensure_account()"); await query("select public.parent_save_family_profile($1,0,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify(profileDetails()), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    vi.setSystemTime(at);
  });
  it.each(Object.keys(programs) as FamilyProfileApplicationProgram[])("uses actual %s start/save and immutable typed leaves with original family confirmation dates", async program => {
    const value = await input(program), id = await start(value), saved = await snapshot(value, id), old = confirmedAt.toISOString();
    expect(saved.details).toEqual(value.details);
    for (const mapping of value.source.fields) {
      const leafPaths = Object.keys(saved.provenance as object).filter(path => path === mapping.applicationPath || mapping.applicationPath.endsWith(".income") && (path === `${mapping.applicationPath}.state` || path.startsWith(`${mapping.applicationPath}.sources`)));
      expect(leafPaths.length).toBeGreaterThan(0);
      for (const path of leafPaths) { const metadata = (saved.provenance as Record<string, { source: string; confirmedAt: string; asOf: string }>)[path]; expect(metadata).toMatchObject({ source: "parent", asOf: "2026-11-16" }); expect(new Date(metadata.confirmedAt).toISOString()).toBe(old); }
    }
    expect((await fixture.admin.query("select parent_private.current_grant($1,2) allowed", [id])).rows[0].allowed).toBe(true);
    if (value.source.fields.some(mapping => mapping.profilePaths.includes("homeAddress.zip"))) expect(new Date((await fixture.admin.query("select intake_confirmed_at->>'zip' confirmed from public.parent_requests where id=$1", [id])).rows[0].confirmed as string).toISOString()).toBe(old);
    expect(await start(value)).toBe(id); expect((await fixture.admin.query(`select count(*)::int n from public.${value.meta.table} where request_id=$1`, [id])).rows[0].n).toBe(1);
  });
  it.each(Object.keys(programs) as FamilyProfileApplicationProgram[])("keeps actual %s corrections, original untouched dates and exact save retries", async program => {
    const value = await input(program), id = await start(value), before = await snapshot(value, id), key = randomUUID();
    value.details = { ...value.details, ...(program === "wic-pa" ? { appointmentPreference: "morning" as const } : program === "snap-pa" ? { bestTimeToCall: "Morning" } : program === "pwd-tap" ? { existingApplication: "none_known" as const } : { journey: "unknown" as const }) };
    const savedId = await save(value, id, 2, null, key), after = await snapshot(value, id);
    expect(after.id).toBe(savedId); expect(after.request_version).toBe(3);
    for (const path of Object.keys(before.provenance as object)) expect((after.provenance as Record<string, unknown>)[path]).toEqual((before.provenance as Record<string, unknown>)[path]);
    expect(await save(value, id, 2, null, key)).toBe(savedId);
    await expect(save(value, id, 2, value.source, key)).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profile_request_sources where request_id=$1 and request_version=2", [id])).rows[0].n).toBeGreaterThan(0);
  });
  it.each(["snap-pa", "wic-pa"] as const)("acknowledges the exact already committed %s save after its profile changed without writing again", async program => {
    const value = await input(program), id = await start(value), key = randomUUID();
    value.details = { ...value.details, ...(program === "snap-pa" ? { bestTimeToCall: "Morning" } : { appointmentPreference: "morning" as const }) };
    const result = await save(value, id, 2, value.source, key), saved = await snapshot(value, id), current = await profile(), prefix = program === "snap-pa" ? "snap" : "wic";
    await fixture.admin.query(`update parent_private.processing_controls set ${prefix}_details_enabled=false`);
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify({ ...current.details, primaryPerson: { ...current.details.primaryPerson, firstName: "Corrected" } }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    await fixture.admin.query(`update parent_private.processing_controls set ${prefix}_details_enabled=true`);
    expect(await save(value, id, 2, value.source, key)).toBe(result);
    expect(await snapshot(value, id)).toEqual(saved);
    await expect(save(value, id, 4, value.source)).rejects.toMatchObject({ code: "P0001", message: "parent_family_profile_source_changed" });
    await query("select public.parent_clear_family_profile($1,2,$2)", [owner, randomUUID()]);
    await fixture.admin.query("update parent_private.processing_controls set family_profile_enabled=false");
    expect(await save(value, id, 2, value.source, key)).toBe(result);
    expect((await snapshot(value, id)).id).toBe(saved.id);
  });
  it("binds an explicit document choice to profile start receipts while preserving historical acknowledgement and later no-choice source",async()=>{
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));const value=await input("snap-pa");
    const selected=(template=SNAP_ES_TEMPLATE_ID)=>query("select public.parent_start_snap_application_source($1,$2,$3,$4,$5,$6,$7) id",[JSON.stringify(value.intake),JSON.stringify(value.mandate),JSON.stringify(value.details),value.meta.notice,value.key,template,JSON.stringify(value.source)]);
    const id=(await selected()).rows[0].id,saved=await snapshot(value,id);expect(saved.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);
    await expect(selected(SNAP_EN_TEMPLATE_ID)).rejects.toMatchObject({code:"PT409"});
    const current=await profile();await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)",[owner,JSON.stringify({...current.details,primaryPerson:{...current.details.primaryPerson,firstName:"Corrected"}}),FAMILY_PROFILE_NOTICE_VERSION,randomUUID()]);
    const corrected=await snapshot(value,id);expect(corrected.details.applicant.firstName).toBe("Corrected");expect(corrected.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);expect(corrected.request_version).toBe(saved.request_version+2);
    expect((await selected()).rows[0].id).toBe(id);expect(await snapshot(value,id)).toEqual(corrected);
    const oldReceipt=(await fixture.admin.query("select write_hash from parent_private.family_profile_application_receipts where owner_id=$1 and idempotency_key=$2 and mutation='start'",[owner,value.key])).rows[0].write_hash;
    await query("select public.parent_clear_family_profile($1,2,$2)",[owner,randomUUID()]);await fixture.admin.query("update parent_private.processing_controls set family_profile_enabled=false");
    expect((await selected()).rows[0].id).toBe(id);expect((await fixture.admin.query("select write_hash from parent_private.family_profile_application_receipts where owner_id=$1 and idempotency_key=$2 and mutation='start'",[owner,value.key])).rows[0].write_hash).toBe(oldReceipt);
  });
  it("acknowledges an owned committed start after family reuse closes, without starting new work", async () => {
    const value = await input("snap-pa"), id = await start(value);
    await query("select public.parent_clear_family_profile($1,1,$2)", [owner, randomUUID()]);
    await fixture.admin.query("update parent_private.processing_controls set family_profile_enabled=false");
    const before = (await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [id])).rows[0].value;
    expect(await start(value)).toBe(id);
    expect((await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [id])).rows[0].value).toEqual(before);
    await expect(start({ ...value, key: randomUUID() })).rejects.toMatchObject({ code: "42501" });
  });
  it("repairs stale SNAP source bindings atomically under a fresh profile, without changing earlier snapshots or source history", async () => {
    const value = await input("snap-pa"), id = await start(value), original = await snapshot(value, id);
    const before = (await fixture.admin.query("select to_jsonb(s) data from parent_private.family_profile_request_sources s where request_id=$1 and request_version=2 order by application_path,profile_path", [id])).rows;
    const savedProfile = await profile(); const corrected = { ...savedProfile.details, primaryPerson: { ...savedProfile.details.primaryPerson, firstName: "Corrected" } };
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify(corrected), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    expect((await fixture.admin.query("select parent_private.current_grant($1,3) allowed", [id])).rows[0].allowed).toBe(false);
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true");
    const refreshed = await input("snap-pa"), key = randomUUID(), savedId = await save(refreshed, id, 3, refreshed.source, key), latest = await snapshot(value, id);
    expect(latest.id).toBe(savedId); expect(latest.base_version).toBe(3); expect(latest.request_version).toBe(4);
    expect(latest.details).toMatchObject({ applicant: { firstName: "Corrected" } });
    expect((await fixture.admin.query("select parent_private.current_grant($1,4) allowed", [id])).rows[0].allowed).toBe(true);
    expect((await fixture.admin.query(`select * from public.${value.meta.table} where id=$1`, [original.id])).rows[0]).toEqual(original);
    expect((await fixture.admin.query("select to_jsonb(s) data from parent_private.family_profile_request_sources s where request_id=$1 and request_version=2 order by application_path,profile_path", [id])).rows).toEqual(before);
    expect(await save(refreshed, id, 3, refreshed.source, key)).toBe(savedId);
    expect(await start(value)).toBe(id);
    const changedAttempt = structuredClone(value); (changedAttempt.details as { applicant: { firstName: string } }).applicant.firstName = "Different packet";
    await expect(start(changedAttempt)).rejects.toMatchObject({ code: "PT409" });
  });
  it.each(["snap-pa", "wic-pa"] as const)("updates compatible bound %s answers during the owned profile correction without opening a viewer", async program => {
    const value = await input(program), id = await start(value), original = await snapshot(value, id), savedProfile = await profile();
    const corrected = { ...savedProfile.details, primaryPerson: { ...savedProfile.details.primaryPerson, firstName: "Corrected" } };
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify(corrected), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    const latest = await snapshot(value, id);
    expect(latest.details).toMatchObject(program === "snap-pa" ? { applicant: { firstName: "Corrected" } } : { contact: { firstName: "Corrected" } });
    expect(latest.request_version).toBe(4);
    expect((await fixture.admin.query("select parent_private.current_grant($1,4) allowed", [id])).rows[0].allowed).toBe(true);
    expect((await fixture.admin.query(`select * from public.${value.meta.table} where id=$1`, [original.id])).rows[0]).toEqual(original);
    const untouched = program === "snap-pa" ? "applicant.lastName" : "contact.lastName";
    expect((latest.provenance as Record<string, unknown>)[untouched]).toEqual((original.provenance as Record<string, unknown>)[untouched]);
  });
  it("updates compatible SNAP answers in a combined food request while retaining its mandate and original snapshot", async () => {
    const value = await input("snap-pa");
    value.intake.needs = ["food_now", "snap_new"];
    value.mandate.recipientIds = ["philly-food", "snap-pa"];
    value.mandate.maxRecipients = 2;
    const id = await start(value), original = await snapshot(value, id), savedProfile = await profile();
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify({ ...savedProfile.details, primaryPerson: { ...savedProfile.details.primaryPerson, firstName: "Corrected" } }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    const latest = await snapshot(value, id);
    expect(latest.details).toMatchObject({ applicant: { firstName: "Corrected" } });
    expect(latest.provenance["applicant.lastName"]).toEqual(original.provenance["applicant.lastName"]);
    const request = (await fixture.admin.query("select intake,mandate,parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1", [id])).rows[0];
    expect(request).toMatchObject({ intake: { needs: ["food_now", "snap_new"] }, mandate: value.mandate, allowed: true });
    expect((await fixture.admin.query("select * from public.parent_snap_application_details where id=$1", [original.id])).rows[0]).toEqual(original);
  });
  it("updates a known same-as-home WIC routing ZIP without touching a separate manual application answer", async () => {
    const first = await profile(), details = { ...first.details, mailingAddressSameAsHome: true }; delete details.mailingAddress;
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify(details), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    const value = await input("wic-pa"), id = await start(value);
    (value.details as { contact: { firstName: string } }).contact.firstName = "Independent answer";
    await save(value, id, 2, null);
    const current = await profile(), corrected = { ...current.details, homeAddress: { ...current.details.homeAddress, zip: "19103" } };
    await query("select public.parent_save_family_profile($1,2,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify(corrected), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    const latest = await snapshot(value, id);
    expect(latest.details).toMatchObject({ contact: { firstName: "Independent answer", zip: "19103" } });
    expect((await fixture.admin.query("select intake->>'zip' zip,parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1", [id])).rows[0]).toEqual({ zip: "19103", allowed: true });
  });
  it("keeps paused food work stopped after a profile correction", async () => {
    const value = await input("snap-pa"), id = await start(value), original = await snapshot(value, id), current = await profile();
    await fixture.admin.query("update public.parent_requests set status='paused' where id=$1", [id]);
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify({ ...current.details, primaryPerson: { ...current.details.primaryPerson, firstName: "Corrected" } }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    expect((await snapshot(value, id)).id).toBe(original.id);
    expect((await fixture.admin.query("select status,parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1", [id])).rows[0]).toEqual({ status: "paused", allowed: false });
  });
  it("keeps profile-derived routing ZIP bound after a private ZIP is removed, including indirect request reuse", async () => {
    const value = await input("snap-pa"), id = await start(value);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profile_request_sources where request_id=$1 and request_version=2 and application_path='intake.zip'", [id])).rows[0].n).toBe(1);
    const borrowed = (await query("select public.parent_start_request_with_reused_zip($1,$2,$3,$4,2) id", [JSON.stringify(fixtureIntake({ needs: ["food_now"], utilityProviders: [] })), JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: ["philly-food"], allowedActions: ["research", "prepare"], allowedData: ["household"], expiresAt: new Date(at.getTime() + 86400000).toISOString() })), randomUUID(), id])).rows[0].id;
    delete (value.details as { zip?: string }).zip;
    await save(value, id, 2, null);
    const savedProfile = await profile();
    await query("select public.parent_clear_family_profile($1,$2,$3)", [owner, savedProfile.revision, randomUUID()]);
    expect((await fixture.admin.query("select parent_private.reusable_zip_source($1,(select household_id from public.parent_requests where id=$1)) value", [id])).rows[0].value).toBeNull();
    const borrower = (await fixture.admin.query("select version from public.parent_requests where id=$1", [borrowed])).rows[0];
    expect((await fixture.admin.query("select parent_private.current_grant($1,$2) allowed", [borrowed, borrower.version])).rows[0].allowed).toBe(false);
  });
  it("preserves a real manually corrected routing ZIP independently of the old profile ZIP", async () => {
    const value = await input("snap-pa"), id = await start(value);
    (value.details as { zip: string }).zip = "19103";
    await save(value, id, 2, null);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profile_request_sources where request_id=$1 and request_version=3 and application_path='intake.zip'", [id])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select parent_private.reusable_zip_source($1,(select household_id from public.parent_requests where id=$1)) value", [id])).rows[0].value).toMatchObject({ value: "19103" });
  });
  it("permits an actual independent parent correction while preserving every unchanged source and old attempted version", async () => {
    const value = await input("snap-pa"), id = await start(value);
    (value.details as { applicant: { firstName: string } }).applicant.firstName = "New parent answer";
    (value.details as { household: { id: string; firstName: string }[] }).household.find(person => person.id === primary)!.firstName = "New parent answer";
    await save(value, id, 2, null); const latest = await snapshot(value, id);
    const paths = (await fixture.admin.query("select application_path from parent_private.family_profile_request_sources where request_id=$1 and request_version=3", [id])).rows.map(row => row.application_path);
    expect(paths).not.toContain("applicant.firstName"); expect(paths).toContain("applicant.lastName");
    expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profile_request_sources where request_id=$1 and request_version=2 and application_path='applicant.firstName'", [id])).rows[0].n).toBe(1);
    const provenance = latest.provenance as Record<string, { confirmedAt: string }>;
    expect(new Date(provenance["applicant.firstName"].confirmedAt).toISOString()).toBe(at.toISOString()); expect(new Date(provenance["applicant.lastName"].confirmedAt).toISOString()).toBe(confirmedAt.toISOString());
  });
  it("keeps PGW no-income explanations programme-specific while preserving an equal reordered source inventory", async () => {
    const value = await input("pgw-crp"), rows = value.details as { householdMembers: { id: string; income?: { state: string; sources: unknown[]; noIncomeSituation?: string } }[] };
    const member = rows.householdMembers.find(row => row.id === child)!; member.income!.noIncomeSituation = "Supported by a relative";
    const id = await start(value), saved = await snapshot(value, id), metadata = saved.provenance as Record<string, { confirmedAt: string }>;
    expect(new Date(metadata[`householdMembers.${child}.income.state`].confirmedAt).toISOString()).toBe(confirmedAt.toISOString());
    expect(new Date(metadata[`householdMembers.${child}.income.noIncomeSituation`].confirmedAt).toISOString()).toBe(at.toISOString());
    const next = structuredClone(value); (next.details as typeof rows).householdMembers.find(row => row.id === child)!.income!.noIncomeSituation = "Updated programme explanation";
    await save(next, id, 2, null); expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profile_request_sources where request_id=$1 and request_version=3 and application_path=$2", [id, `householdMembers.${child}.income`])).rows[0].n).toBe(1);
  });
  it("queues a date-only explicit profile confirmation and keeps the caller's original base version for recovery", async () => {
    const value = await input("snap-pa"), id = await start(value), savedProfile = await profile(), key = randomUUID();
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,$4,$5)", [owner, JSON.stringify(savedProfile.details), FAMILY_PROFILE_NOTICE_VERSION, ["primaryPerson.firstName"], key]);
    const latest = await snapshot(value, id); expect(latest.base_version).toBe(2); expect(latest.request_version).toBe(3);
    expect(new Date((latest.provenance as Record<string, { confirmedAt: string }>)["applicant.firstName"].confirmedAt).toISOString()).toBe(at.toISOString());
    expect((await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,$4,$5) revision", [owner, JSON.stringify(savedProfile.details), FAMILY_PROFILE_NOTICE_VERSION, ["primaryPerson.firstName"], key])).rows[0].revision).toBe(2);
    expect((await snapshot(value, id)).id).toBe(latest.id);
  });
  it("honours explicit caregiver account selection and fresh same-as-home postal choice", async () => {
    const savedProfile = await profile(), profileValue = { ...savedProfile.details, mailingAddressSameAsHome: true }; delete profileValue.mailingAddress;
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify(profileValue), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    const current = await profile(), options = { accountPersonId: adult, useHomeAddress: true };
    const projected = projectFamilyProfileApplication(current, "pwd-tap", { now: at, accountAuthority: "authorized_caregiver", ...options });
    const value = await input("pwd-tap", options); value.intake.accountAuthority = "authorized_caregiver"; value.details = projected.details; value.source.fields = projected.fields;
    const id = await start(value), stored = await snapshot(value, id); expect(stored.details).toMatchObject({ applicant: { id: adult, name: "Other Adult" } }); expect(stored.details).not.toHaveProperty("phone");
    const self = await input("wic-pa"), selfId = await start(self), wic = await snapshot(self, selfId);
    expect(wic.details).toMatchObject({ contact: { street: "123 Synthetic Lane, Unit 2", zip: "19104" } });
    expect(self.source.fields.find(field => field.applicationPath === "contact.street")!.profilePaths).toContain("mailingAddressSameAsHome");
  });
  it("retains the exact original source expiry even after policy reopening, with no current-grant fallback", async () => {
    vi.setSystemTime(confirmedAt); const stored = await profile();
    await query("select public.parent_clear_family_profile($1,1,$2)", [owner, randomUUID()]);
    await fixture.admin.query("update parent_private.processing_controls set family_profile_approved_until=$1", [new Date(at.getTime() + 3600000)]);
    await query("select public.parent_save_family_profile($1,2,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify(stored.details), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    vi.setSystemTime(at); const value = await input("snap-pa"), id = await start(value);
    expect((await fixture.admin.query("select parent_private.current_grant($1,2) allowed", [id])).rows[0].allowed).toBe(true);
    vi.setSystemTime(new Date(at.getTime() + 3600001)); await fixture.admin.query("update parent_private.processing_controls set family_profile_approved_until=now()+interval '1 day'");
    expect((await fixture.admin.query("select parent_private.current_grant($1,2) allowed", [id])).rows[0].allowed).toBe(false);
    expect(await start(value)).toBe(id);
    await expect(start({ ...value, key: randomUUID() })).rejects.toMatchObject({ code: "P0001", message: "parent_family_profile_source_changed" });
  });
  it("keeps purpose and restricted-role denials atomic without a generic request fallback", async () => {
    const value = await input("peco-cap"); await fixture.admin.query("update parent_private.processing_controls set peco_details_enabled=false");
    await expect(start(value)).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1", [owner])).rows[0].n).toBe(0);
    for (const role of ["anon", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker", "parent_snap_finalizer", "parent_utility_protected"]) {
      await expect(query("select public.parent_start_application_with_family_profile($1,$2,$3,$4,$5,$6,$7,true,true)", [value.meta.kind, JSON.stringify(value.intake), JSON.stringify(value.mandate), JSON.stringify(value.details), value.meta.notice, value.key, JSON.stringify(value.source)], role)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(query("select parent_private.verify_family_profile_application($1,$2,$3,$4)", [value.meta.kind, JSON.stringify(value.intake), JSON.stringify(value.details), JSON.stringify(value.source)])).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects forged source paths, changed target values and explicit owner swaps before creating any request", async () => {
    for (const change of ["owner", "path", "value", "programme_only", "address_choice"]) {
      const value = await input("pwd-tap");
      if (change === "owner") value.source.expectedOwnerId = randomUUID();
      if (change === "path") value.source.fields[0].profilePaths = ["homeAddress.street"];
      if (change === "value") (value.details as { applicant: { name: string } }).applicant.name = "Changed";
      if (change === "programme_only") value.source.fields.push({ applicationPath: "householdComplete", profilePaths: ["preferredLanguage"] });
      if (change === "address_choice") value.source.options.useHomeAddress = false;
      await expect(start(value)).rejects.toMatchObject({ code: change === "owner" ? "42501" : "P0001" });
    }
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1", [owner])).rows[0].n).toBe(0);
  });
  it("does not accept a forged transaction setting on an ordinary programme save", async () => {
    const value = await input("wic-pa"); (value.details as { contact: { firstName: string } }).contact.firstName = "Different";
    await query("select set_config('caselink.family_profile_application_source',$1,false)", [JSON.stringify(value.source)]);
    await expect(query("select public.parent_start_wic_application($1,$2,$3,$4,$5,true)", [JSON.stringify(value.intake), JSON.stringify(value.mandate), JSON.stringify(value.details), value.meta.notice, value.key])).rejects.toMatchObject({ code: "P0001", message: "parent_family_profile_source_changed" });
    await fixture.admin.query("select set_config('caselink.family_profile_application_source','',false)");
  });
});
