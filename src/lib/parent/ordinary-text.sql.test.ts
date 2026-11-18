import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import corpus from "../../../tests/fixtures/parent/ordinary-text-cases.json";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { FAMILY_PROFILE_NOTICE_VERSION } from "./family-profile";
import { isOrdinaryText } from "./ordinary-text";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE, at = new Date("2026-11-17T18:00:00Z");
const person = "12345678-1234-4234-8234-123456789012";
const programmes = [
  { kind: "snap_application", prefix: "snap", programme: "snap-pa", need: "snap_new", provider: null, notice: "snap-application-details-2026-11-03.v1", details: (name: string) => ({ applicant: { firstName: name } }) },
  { kind: "wic_application", prefix: "wic", programme: "wic-pa", need: "wic_new", provider: null, notice: "wic-application-details-2026-11-13.v1", details: (name: string) => ({ contact: { firstName: name } }) },
  { kind: "peco_application", prefix: "peco", programme: "peco-cap", need: "electricity", provider: "peco", notice: "peco-application-details-2026-11-13.v1", details: (name: string) => ({ applicant: { id: person, firstName: name } }) },
  { kind: "pgw_application", prefix: "pgw", programme: "pgw-crp", need: "gas", provider: "pgw", notice: "pgw-application-details-2026-11-13.v1", details: (name: string) => ({ customer: { id: person, firstName: name } }) },
  { kind: "water_application", prefix: "water", programme: "pwd-tap", need: "water", provider: "pwd", notice: "water-application-details-2026-11-13.v1", details: (name: string) => ({ applicant: { id: person, name } }) },
] as const;

describe.skipIf(!modulePath)("ordinary text actual PostgreSQL boundaries", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  async function query(sql: string, values: unknown[] = [], role = "authenticated") {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  const allowed = async (details: unknown, kind = "wic_application") => (await fixture.admin.query("select parent_private.ordinary_application_text_allowed($1,$2) allowed", [details === null ? null : JSON.stringify(details), kind])).rows[0].allowed;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); fixture = await createParentSqlFixture(modulePath!);
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '2 days',existing_accounts_enabled=true,family_profile_enabled=true,family_profile_approval_reference='synthetic only',family_profile_approved_until=now()+interval '2 days',family_profile_notice_version=$1", [FAMILY_PROFILE_NOTICE_VERSION]);
    for (const programme of programmes) await fixture.admin.query(`update parent_private.processing_controls set ${programme.prefix}_details_enabled=true,${programme.prefix}_details_approval_reference='synthetic only',${programme.prefix}_details_approved_until=now()+interval '2 days',${programme.prefix}_details_notice_version=$1`, [programme.notice]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '2 days')", [session, owner]);
    await query("select public.parent_ensure_account()");
  });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });

  it.each([...corpus.rejected.map(value => ({ value, expected: false })), ...corpus.accepted.map(value => ({ value, expected: true }))])("matches the shared TypeScript corpus for $value", async ({ value, expected }) => {
    expect(isOrdinaryText(value)).toBe(expected);
    for (const kind of [...programmes.map(programme => programme.kind), "family_profile"]) expect(await allowed({ text: value }, kind)).toBe(expected);
  });
  it("permits only exact SNAP phone paths, stable UUID paths and dedicated utility accounts", async () => {
    for (const phone of corpus.snapPhones) {
      expect(await allowed({ phone, otherPhone: phone, authorizedRepresentative: { phone } }, "snap_application")).toBe(true);
      if (/\d{12}/.test(phone)) {
        expect(await allowed({ applicant: { phone } }, "snap_application")).toBe(false);
        expect(await allowed({ phone }, "wic_application")).toBe(false);
      }
    }
    expect(await allowed({ applicant: { id: person } }, "peco_application")).toBe(true);
    expect(await allowed({ text: person }, "peco_application")).toBe(false);
    expect(await allowed({ accountNumber: "1234567890123456789" }, "pgw_application")).toBe(true);
    expect(await allowed({ accountNumber: "9000000001" }, "peco_application")).toBe(true);
    expect(await allowed({ accountNumber: "1234567890123456789" }, "family_profile")).toBe(false);
    expect(await allowed({ customer: { accountNumber: "1234567890123456789" } }, "pgw_application")).toBe(false);
    expect(await allowed(null, "family_profile")).toBe(true);
    expect(await allowed(null)).toBe(false);
    expect(await allowed({}, "unrecognised")).toBe(false);
  });
  it.each(programmes)("rejects the audited disclosure through the actual $kind RPC without leaving a request", async programme => {
    const intake = fixtureIntake({ needs: [programme.need], utilityProviders: programme.provider ? [programme.provider] : [], householdSize: null });
    const mandate = fixtureMandate({ mode: "prepare_only", recipientIds: [programme.programme], allowedActions: ["research", "prepare"], allowedData: programme.provider ? ["household", "income", "utility"] : ["household", "income"], expiresAt: new Date(at.getTime() + 86400000).toISOString() });
    const args = [JSON.stringify(intake), JSON.stringify(mandate), JSON.stringify(programme.details(corpus.rejected[0])), programme.notice, randomUUID()];
    const suffix = programme.prefix === "snap" ? "" : programme.prefix === "wic" ? ",true" : ",true,true";
    const sql = `select public.parent_start_${programme.prefix}_application($1,$2,$3,$4,$5${suffix}) id`;
    const before = (await fixture.admin.query("select count(*)::int count from public.parent_requests")).rows[0].count;
    await expect(query(sql, args)).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select count(*)::int count from public.parent_requests")).rows[0].count).toBe(before);
    args[2] = JSON.stringify(programme.details("Fictional"));
    const result = await query(sql, args); expect(result.rows[0].id).toEqual(expect.any(String));
  });
  it("rejects profile writes while allowing mixed legacy expiry cleanup and clear after processing closes", async () => {
    await expect(query("select public.parent_save_family_profile($1,0,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify({ primaryPerson: { id: person, firstName: corpus.rejected[0] } }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()])).rejects.toMatchObject({ code: "23514" });
    expect((await query("select public.parent_save_family_profile($1,0,$2,$3,true,true,'{}',$4) revision", [owner, JSON.stringify({ primaryPerson: { id: person, firstName: "Fictional" } }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()])).rows[0].revision).toBe(1);
    // Model an earlier stored value; adding the guard must not block independent expiry cleanup.
    await fixture.admin.query("update parent_private.family_profiles set details=$2,provenance=$3 where owner_id=$1", [owner,
      JSON.stringify({ primaryPerson: { id: person, firstName: corpus.rejected[0] }, contact: { phone: "215-555-0101" } }),
      JSON.stringify({ "primaryPerson.firstName": { confirmedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 86400000).toISOString() },
        "contact.phone": { confirmedAt: new Date(at.getTime() - 86400000).toISOString(), expiresAt: new Date(at.getTime() - 1000).toISOString() } })]);
    await query("select parent_private.parent_purge_family_profiles(100)", [], "parent_retention_worker");
    const retained = (await fixture.admin.query("select details from parent_private.family_profiles where owner_id=$1", [owner])).rows[0].details;
    expect(retained).toMatchObject({ primaryPerson: { id: person, firstName: corpus.rejected[0] } });
    expect(retained).not.toHaveProperty("contact.phone");
    await fixture.admin.query("update parent_private.processing_controls set enabled=false,family_profile_enabled=false");
    expect((await query("select public.parent_clear_family_profile($1,2,$2) revision", [owner, randomUUID()])).rows[0].revision).toBe(3);
    expect((await fixture.admin.query("select details from parent_private.family_profiles where owner_id=$1", [owner])).rows[0].details).toBeNull();
  });
  it("does not expose the helper as a new API or weaken existing table grants", async () => {
    for (const role of ["anon", "authenticated", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker", "parent_snap_finalizer", "parent_utility_protected"])
      expect((await fixture.admin.query("select has_function_privilege($1,'parent_private.ordinary_application_text_allowed(jsonb,text)','EXECUTE') allowed", [role])).rows[0].allowed).toBe(false);
    for (const programme of programmes) expect((await fixture.admin.query("select has_table_privilege('authenticated',$1,'INSERT') allowed", [`public.parent_${programme.prefix}_application_details`])).rows[0].allowed).toBe(false);
  });
});
