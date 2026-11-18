import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileReadSchema } from "./family-profile";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE, at = new Date("2026-11-17T16:00:00Z");
describe.skipIf(!modulePath)("family profile actual PostgreSQL owner, expiry and reuse boundaries", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string, person: string;
  async function query(sql: string, values: unknown[] = [], user = owner, role = "authenticated", token = session) {
    await fixture.admin.query(`set role ${role}`);
    try { await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: token, role, amr: [{ method: "otp" }] })]); return await fixture.admin.query(sql, values); }
    finally { await fixture.admin.query("reset role"); }
  }
  async function enable(on = true) { await fixture.admin.query("update parent_private.processing_controls set family_profile_enabled=$1,family_profile_approval_reference='isolated synthetic only',family_profile_approved_until=now()+interval '90 days',family_profile_notice_version=$2", [on, FAMILY_PROFILE_NOTICE_VERSION]); }
  const details = () => ({ primaryPerson: { id: person, firstName: "ProfileCanary", lastName: "Example", dateOfBirth: "1990-01-01" }, homeAddress: { street: "1 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19147" } });
  async function save(value: unknown = details(), revision = 0, key = randomUUID(), expectedOwner = owner, confirmed: string[] = []) {
    return (await query("select public.parent_save_family_profile($1,$2,$3,$4,true,true,$5,$6) revision", [expectedOwner, revision, JSON.stringify(value), FAMILY_PROFILE_NOTICE_VERSION, confirmed, key])).rows[0].revision as number;
  }
  async function read() { return familyProfileReadSchema.parse((await query("select public.parent_get_family_profile() value")).rows[0].value); }
  async function request() { return (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake()), JSON.stringify(fixtureMandate({ expiresAt: new Date(Date.now() + 86400000).toISOString() })), randomUUID()])).rows[0].id as string; }
  async function bind(id: string, revision = 1, fields = [{ applicationPath: "applicant.firstName", profilePaths: ["primaryPerson.firstName"] }]) {
    // This fixture acts as the trusted fixed programme wrapper; ordinary roles cannot call the port.
    await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "otp" }] })]);
    return (await fixture.admin.query("select parent_private.bind_family_profile($1,1,$2,$3) value", [id, revision, JSON.stringify(fields)])).rows[0].value;
  }
  beforeAll(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.setSystemTime(at); owner = randomUUID(); session = randomUUID(); person = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '90 days',existing_accounts_enabled=true");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')", [session, owner]);
    await query("select public.parent_ensure_account()"); await enable(false);
  });
  it("defaults closed independently and checks consent, direct field validation and all API role boundaries", async () => {
    expect(await read()).toMatchObject({ ownerId: owner, revision: 0, profile: null, collection: { collectionEnabled: false } });
    await expect(save()).rejects.toMatchObject({ code: "42501" }); await enable();
    for (const value of [{ ...details(), ssn: "private" }, { ...details(), primaryPerson: { ...details().primaryPerson, firstName: "000-00-0000" } }, { ...details(), contact: { phone: null } }, { ...details(), primaryPerson: { id: person, income: { state: "none", sources: [{ id: randomUUID(), kind: "employment" }] } } }])
      await expect(save(value)).rejects.toMatchObject({ code: "23514" });
    await expect(query("select public.parent_save_family_profile($1,0,$2,$3,false,true,'{}',$4)", [owner, JSON.stringify(details()), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await save();
    for (const role of ["anon", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker", "parent_snap_finalizer", "parent_utility_protected"]) {
      await expect(query("select public.parent_get_family_profile()", [], owner, role)).rejects.toMatchObject({ code: "42501" });
      await expect(query("select * from parent_private.family_profiles", [], owner, role)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(query("select * from parent_private.family_profiles")).rejects.toMatchObject({ code: "42501" });
    await expect(query("select parent_private.family_profile_source(1)")).rejects.toMatchObject({ code: "42501" });
  });
  it("binds immutable retry keys and optimistic revisions; clear cannot resurrect an old exact save", async () => {
    await enable(); const key = randomUUID(); expect(await save(details(), 0, key)).toBe(1); expect(await save(details(), 0, key)).toBe(1);
    await expect(save({ ...details(), contact: { phone: "215-555-0101" } }, 0, key)).rejects.toMatchObject({ code: "40001" });
    await expect(save(details(), 0)).rejects.toMatchObject({ code: "40001" });
    const clearKey = randomUUID(); expect((await query("select public.parent_clear_family_profile($1,1,$2) revision", [owner, clearKey])).rows[0].revision).toBe(2);
    await expect(save(details(), 0, key)).rejects.toMatchObject({ code: "40001" }); expect(await read()).toMatchObject({ revision: 2, profile: null, lastMutationKey: clearKey });
    expect((await query("select public.parent_clear_family_profile($1,1,$2) revision", [owner, clearKey])).rows[0].revision).toBe(2);
    await save(details(), 2); await expect(query("select public.parent_clear_family_profile($1,1,$2)", [owner, clearKey])).rejects.toMatchObject({ code: "40001" });
  });
  it("preserves each original field date across reads, unchanged saves, array reorder and new request starts", async () => {
    await enable(); const first = randomUUID(), second = randomUUID(), source1 = randomUUID(), source2 = randomUUID();
    const value = { ...details(), primaryPerson: { ...details().primaryPerson, income: { state: "sources", sources: [{ id: source1, kind: "employment" }, { id: source2, kind: "pension" }] } }, members: [{ id: first, firstName: "First" }, { id: second, firstName: "Second" }] };
    await save(value); const original = (await read()).profile!.provenance;
    vi.setSystemTime(new Date(at.getTime() + 86400000));
    await save({ ...value, primaryPerson: { ...value.primaryPerson, income: { ...value.primaryPerson.income, sources: [...value.primaryPerson.income.sources].reverse() } }, members: [...value.members].reverse() }, 1);
    await request(); expect((await read()).profile!.provenance).toEqual(original);
    expect(Date.parse(original["primaryPerson.firstName"].expiresAt) - Date.parse(original["primaryPerson.firstName"].confirmedAt)).toBe(45 * 86400000);
    await save({ ...value, contact: { phone: "215-555-0101" } }, 2); const updated = (await read()).profile!.provenance;
    expect(updated["primaryPerson.firstName"]).toEqual(original["primaryPerson.firstName"]); expect(updated["contact.phone"].confirmedAt).not.toBe(original["primaryPerson.firstName"].confirmedAt);
  });
  it("denies foreign owners, retained expired sessions and ordinary school access", async () => {
    await enable(); await save(); await expect(save(details(), 1, randomUUID(), randomUUID())).rejects.toMatchObject({ code: "42501" });
    const foreign = randomUUID(), foreignSession = randomUUID();
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [foreign, `${foreign}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [foreignSession, foreign]);
    await query("select public.parent_ensure_account()", [], foreign, "authenticated", foreignSession);
    expect((await query("select public.parent_get_family_profile() value", [], foreign, "authenticated", foreignSession)).rows[0].value).toMatchObject({ ownerId: foreign, profile: null });
    await expect(query("select public.parent_clear_family_profile($1,1,$2)", [owner, randomUUID()], foreign, "authenticated", foreignSession)).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [session]); await expect(read()).rejects.toMatchObject({ code: "42501" });
  });
  it("links only fresh owned paths and invalidates affected queued uses across new versions while paused stays paused", async () => {
    await enable(); await save(); const id = await request(); const provenance = await bind(id);
    expect(provenance).toEqual({ "applicant.firstName": (await read()).profile!.provenance["primaryPerson.firstName"] });
    expect((await query("select public.parent_get_family_profile_sources($1,1) value", [id])).rows[0].value).toEqual({ fields: [{ applicationPath: "applicant.firstName", profilePaths: ["primaryPerson.firstName"] }] });
    await expect(query("select public.parent_get_family_profile_sources($1,2)", [id])).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select parent_private.family_profile_reuse_allowed($1,1) allowed", [id])).rows[0].allowed).toBe(true);
    await save({ ...details(), contact: { phone: "215-555-0101" } }, 1); expect((await fixture.admin.query("select version from public.parent_requests where id=$1", [id])).rows[0].version).toBe(1);
    await fixture.admin.query("update public.parent_requests set status='paused' where id=$1", [id]);
    await save({ ...details(), primaryPerson: { ...details().primaryPerson, firstName: "Corrected" } }, 2);
    const state = (await fixture.admin.query("select r.status,r.version,j.state from public.parent_requests r join public.parent_jobs j on j.request_id=r.id where r.id=$1", [id])).rows[0];
    expect(state).toMatchObject({ status: "paused", version: 2, state: "cancelled" });
    expect((await fixture.admin.query("select parent_private.family_profile_reuse_allowed($1,2) allowed", [id])).rows[0].allowed).toBe(false);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profile_request_sources where request_id=$1", [id])).rows[0].n).toBe(2);
    await expect(bind(id, 1)).rejects.toMatchObject({ code: "40001" });
  });
  it("rejects SQL NULL and JSON null mappings at the private binding port", async () => {
    await enable(); await save(); const id = await request();
    await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "otp" }] })]);
    for (const mappings of [null, "null"]) await expect(fixture.admin.query("select parent_private.bind_family_profile($1,1,1,$2)", [id, mappings])).rejects.toMatchObject({ code: "23514" });
  });
  it("expires original linked use, hides expired profile facts, purges independently and cascades with parent data only", async () => {
    await enable(); await save(); const id = await request(); await bind(id);
    vi.setSystemTime(new Date(at.getTime() + 46 * 86400000));
    expect((await fixture.admin.query("select parent_private.family_profile_reuse_allowed($1,1) allowed", [id])).rows[0].allowed).toBe(false);
    expect((await read()).profile).toBeNull();
    await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    expect((await query("select parent_private.parent_purge_family_profiles(100) n", [], owner, "parent_retention_worker")).rows[0].n).toBeGreaterThan(0);
    expect((await fixture.admin.query("select details,provenance from parent_private.family_profiles where owner_id=$1", [owner])).rows[0]).toEqual({ details: null, provenance: {} });
    await fixture.admin.query("delete from public.parent_accounts where id=$1", [owner]);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profiles where owner_id=$1", [owner])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select count(*)::int n from auth.users where id=$1", [owner])).rows[0].n).toBe(1);
  });
  it("drops expired other-person facts while retaining fresh unrelated answers, and never renews an existing request link", async () => {
    await enable(); const child = randomUUID(); await save({ ...details(), members: [{ id: child, firstName: "OldChild" }] });
    const id = await request(); await bind(id); const original = (await read()).profile!.provenance["primaryPerson.firstName"];
    vi.setSystemTime(new Date(at.getTime() + 44 * 86400000));
    await save({ ...details(), members: [{ id: child, firstName: "OldChild" }], contact: { phone: "215-555-0101" } }, 1, randomUUID(), owner, ["primaryPerson.firstName"]);
    expect((await read()).profile!.provenance["primaryPerson.firstName"].expiresAt).not.toBe(original.expiresAt);
    vi.setSystemTime(new Date(at.getTime() + 46 * 86400000));
    const current = await read(); expect(current.profile!.details.members).toBeUndefined(); expect(current.profile!.details.contact).toEqual({ phone: "215-555-0101" });
    expect((await fixture.admin.query("select parent_private.family_profile_reuse_allowed($1,1) allowed", [id])).rows[0].allowed).toBe(false);
    await query("select parent_private.parent_purge_family_profiles(100)", [], owner, "parent_retention_worker");
    const stored = (await fixture.admin.query("select details from parent_private.family_profiles where owner_id=$1", [owner])).rows[0].details;
    expect(JSON.stringify(stored)).not.toContain(child); expect(JSON.stringify(stored)).not.toContain("OldChild");
  });
  it("checks date-of-birth using the same Philadelphia day as the editor near UTC midnight", async () => {
    await enable(); vi.setSystemTime(new Date("2026-11-18T01:00:00Z"));
    await expect(save({ primaryPerson: { id: person, dateOfBirth: "2026-11-18" } })).rejects.toMatchObject({ code: "23514" });
    expect(await save({ primaryPerson: { id: person, dateOfBirth: "2026-11-17" } })).toBe(1);
  });
  it("bounds new write churn after exact latest retry and keeps actual data deletion available", async () => {
    await enable(); const key = randomUUID(); await save(details(), 0, key);
    await fixture.admin.query("insert into parent_private.family_profile_write_receipts(owner_id,idempotency_key,write_hash,revision) select $1,gen_random_uuid(),repeat('a',64),1 from generate_series(1,19)", [owner]);
    expect(await save(details(), 0, key)).toBe(1);
    await expect(save({ ...details(), contact: { phone: "215-555-0101" } }, 1)).rejects.toMatchObject({ code: "23514" });
    const clearKey = randomUUID(); expect((await query("select public.parent_clear_family_profile($1,1,$2) revision", [owner, clearKey])).rows[0].revision).toBe(2);
    expect((await query("select public.parent_clear_family_profile($1,1,$2) revision", [owner, clearKey])).rows[0].revision).toBe(2);
    await expect(query("select public.parent_clear_family_profile($1,2,$2)", [owner, randomUUID()])).rejects.toMatchObject({ code: "23514" });
  });
  it("does not silently retain an expired unchanged answer or renew it without explicit confirmation", async () => {
    await enable(); const value = { primaryPerson: { id: person, firstName: "StillMyName" } };
    await save(value); const original = (await read()).profile!.provenance["primaryPerson.firstName"];
    vi.setSystemTime(new Date(at.getTime() + 46 * 86400000));
    await expect(save(value, 1)).rejects.toMatchObject({ code: "23514" });
    expect((await read()).revision).toBe(1);
    expect(await save(value, 1, randomUUID(), owner, ["primaryPerson.firstName"])).toBe(2);
    expect((await read()).profile!.details.primaryPerson.firstName).toBe("StillMyName");
    expect((await read()).profile!.provenance["primaryPerson.firstName"].confirmedAt).not.toBe(original.confirmedAt);
  });
  it("allows current-owner read and clear after all collection closes without enrolling or reopening processing", async () => {
    await enable(); await save(); await fixture.admin.query("update parent_private.processing_controls set enabled=false,family_profile_enabled=false");
    expect(await read()).toMatchObject({ profile: { revision: 1 }, collection: { collectionEnabled: false } });
    await expect(save(details(), 1)).rejects.toMatchObject({ code: "42501" });
    expect((await query("select public.parent_clear_family_profile($1,1,$2) revision", [owner, randomUUID()])).rows[0].revision).toBe(2);
  });
});
