import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileReadSchema } from "./family-profile";
import { projectFamilyProfileApplication } from "./family-profile-application";
import { WIC_APPLICATION_NOTICE_VERSION } from "./constants";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const originalTime = new Date("2026-11-16T18:00:00Z"), currentTime = new Date("2026-11-17T18:00:00Z");
describe.skipIf(!modulePath)("explicit WIC application-only reaffirmation", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  async function query(sql: string, values: unknown[] = [], user = owner) {
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: session, role: "authenticated", amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  beforeAll(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(originalTime); fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.setSystemTime(originalTime); owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '90 days',existing_accounts_enabled=true,family_profile_enabled=true,family_profile_approval_reference='synthetic only',family_profile_approved_until=now()+interval '90 days',family_profile_notice_version=$1,wic_details_enabled=true,wic_details_approval_reference='synthetic only',wic_details_approved_until=now()+interval '3 days',wic_details_notice_version=$2", [FAMILY_PROFILE_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')", [session, owner]);
    await query("select public.parent_ensure_account()");
    await query("select public.parent_save_family_profile($1,0,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify({ primaryPerson: { id: randomUUID(), firstName: "Fictional", lastName: "Example" }, homeAddress: { zip: "19104" }, mailingAddressSameAsHome: true }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    vi.setSystemTime(currentTime);
  });
  async function start(bindRouting = false) {
    const stored = familyProfileReadSchema.parse((await query("select public.parent_get_family_profile() value")).rows[0].value).profile!;
    const projected = projectFamilyProfileApplication(stored, "wic-pa", { now: currentTime });
    if (!bindRouting) { projected.fields = projected.fields.filter(field => !field.profilePaths.includes("homeAddress.zip")); delete (projected.details as { contact?: { zip?: string } }).contact?.zip; }
    const intake = fixtureIntake({ needs: ["wic_new"], householdSize: null, utilityProviders: [] });
    const mandate = fixtureMandate({ mode: "prepare_only", recipientIds: ["wic-pa"], allowedActions: ["research", "prepare"], allowedData: ["household"], expiresAt: "2026-11-18T18:00:00Z" });
    const source = { expectedOwnerId: owner, revision: 1, fields: projected.fields };
    const id = (await query("select public.parent_start_application_with_family_profile('wic_application',$1,$2,$3,$4,$5,$6,true) id", [JSON.stringify(intake), JSON.stringify(mandate), JSON.stringify(projected.details), WIC_APPLICATION_NOTICE_VERSION, randomUUID(), JSON.stringify(source)])).rows[0].id as string;
    return { id, details: projected.details };
  }
  async function saved(id: string) { return (await fixture.admin.query("select * from public.parent_wic_application_details where request_id=$1 order by revision desc limit 1", [id])).rows[0]; }
  async function version(id: string) { return (await fixture.admin.query("select version from public.parent_requests where id=$1", [id])).rows[0].version as number; }
  async function paths(id: string) { return (await fixture.admin.query("select distinct application_path path from parent_private.family_profile_request_sources where request_id=$1 and request_version=$2 order by application_path", [id, await version(id)])).rows.map(row => row.path as string); }
  async function save(value: Awaited<ReturnType<typeof start>>, base: number, confirmed: string[] = [], key = randomUUID()) {
    return (await query("select public.parent_save_application_with_family_profile('wic_application',$1,$2,$3,$4,$5,null,true,false,$6) id", [value.id, base, JSON.stringify(value.details), WIC_APPLICATION_NOTICE_VERSION, key, confirmed])).rows[0].id as string;
  }
  async function clear() { await query("select public.parent_clear_family_profile($1,1,$2)", [owner, randomUUID()]); }
  it("keeps identical removed-source answers stale until only the selected fields are genuinely reaffirmed", async () => {
    const value = await start(), original = await saved(value.id); await clear();
    expect(await paths(value.id)).toEqual(["contact.firstName", "contact.lastName"]);
    const staleVersion = await version(value.id);
    const oldSources = (await fixture.admin.query("select to_jsonb(s) value from parent_private.family_profile_request_sources s where request_id=$1 and request_version=$2 order by application_path,profile_path", [value.id, staleVersion])).rows;
    await save(value, staleVersion);
    expect((await saved(value.id)).provenance).toEqual(original.provenance);
    expect((await fixture.admin.query("select parent_private.current_grant($1,$2) allowed", [value.id, staleVersion])).rows[0].allowed).toBe(false);
    await save(value, staleVersion, ["contact.firstName"]);
    const partial = await saved(value.id), provenance = partial.provenance as Record<string, { confirmedAt: string }>;
    expect(new Date(provenance["contact.firstName"].confirmedAt).toISOString()).toBe(currentTime.toISOString());
    expect(provenance["contact.lastName"]).toEqual((original.provenance as Record<string, unknown>)["contact.lastName"]);
    expect(await paths(value.id)).toEqual(["contact.lastName"]);
    expect((await fixture.admin.query("select to_jsonb(s) value from parent_private.family_profile_request_sources s where request_id=$1 and request_version=$2 order by application_path,profile_path", [value.id, staleVersion])).rows).toEqual(oldSources);
    await save(value, await version(value.id), await paths(value.id));
    expect((await fixture.admin.query("select parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1", [value.id])).rows[0].allowed).toBe(true);
    expect((await fixture.admin.query("select details from parent_private.family_profiles where owner_id=$1", [owner])).rows[0].details).toBeNull();
    expect((await fixture.admin.query("select * from public.parent_wic_application_details where id=$1", [original.id])).rows[0]).toEqual(original);
  });
  it("acknowledges the exact committed declaration after source closure and version changes without renewing it again", async () => {
    const value = await start(); await clear(); const base = await version(value.id), confirmed = await paths(value.id), key = randomUUID();
    const id = await save(value, base, confirmed, key), original = await saved(value.id);
    await fixture.admin.query("update public.parent_requests set version=version+1 where id=$1", [value.id]);
    await fixture.admin.query("update parent_private.processing_controls set family_profile_enabled=false,wic_details_enabled=false");
    expect(await save(value, base, confirmed, key)).toBe(id); expect(await saved(value.id)).toEqual(original);
    await expect(save(value, base, confirmed.slice(1), key)).rejects.toMatchObject({ code: "40001" });
  });
  it("does not resume a paused request or its cancelled job when stale WIC answers are reaffirmed", async () => {
    const value = await start(); await fixture.admin.query("update public.parent_requests set status='paused' where id=$1", [value.id]); await clear();
    await save(value, await version(value.id), await paths(value.id));
    expect((await fixture.admin.query("select status,next_run_at,parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1", [value.id])).rows[0]).toEqual({ status: "paused", next_run_at: null, allowed: false });
    expect((await fixture.admin.query("select state from public.parent_jobs where request_id=$1", [value.id])).rows.every(row => row.state === "cancelled")).toBe(true);
  });
  it("rejects fresh, absent, duplicate and foreign declarations and keeps revoked or closed work stopped", async () => {
    const value = await start();
    await expect(save(value, await version(value.id), ["contact.firstName"])).rejects.toMatchObject({ code: "23514" });
    await clear();
    for (const confirmed of [["mother.status"], ["contact.firstName", "contact.firstName"], ["contact"], ["intake.zip"]]) await expect(save(value, await version(value.id), confirmed)).rejects.toMatchObject({ code: "23514" });
    await expect(query("select public.parent_save_application_with_family_profile('wic_application',$1,$2,$3,$4,$5,null,true,false,$6)", [value.id, await version(value.id), JSON.stringify(value.details), WIC_APPLICATION_NOTICE_VERSION, randomUUID(), ["contact.firstName"]], randomUUID())).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [value.id]);
    await expect(save(value, await version(value.id), ["contact.firstName"])).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update parent_private.processing_controls set wic_details_enabled=false");
    await expect(save(value, await version(value.id), ["contact.firstName"])).rejects.toMatchObject({ code: "42501" });
  });
  it("never renews household routing ZIP through a private WIC declaration", async () => {
    const value = await start(true), original = (await fixture.admin.query("select intake_confirmed_at from public.parent_requests where id=$1", [value.id])).rows[0]; await clear();
    await save(value, await version(value.id), ["contact.firstName", "contact.lastName", "contact.zip"]);
    expect(await paths(value.id)).toEqual(["intake.zip"]);
    expect((await fixture.admin.query("select intake_confirmed_at from public.parent_requests where id=$1", [value.id])).rows[0]).toEqual(original);
    expect((await fixture.admin.query("select parent_private.current_grant(id,version) allowed from public.parent_requests where id=$1", [value.id])).rows[0].allowed).toBe(false);
    await expect(save(value, await version(value.id), ["intake.zip"])).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects a confirmation whose named value was changed or removed", async () => {
    const value = await start(); await clear();
    (value.details as { contact: { firstName?: string } }).contact.firstName = "Changed";
    await expect(save(value, await version(value.id), ["contact.firstName"])).rejects.toMatchObject({ code: "23514" });
    delete (value.details as { contact: { firstName?: string } }).contact.firstName;
    await expect(save(value, await version(value.id), ["contact.firstName"])).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["cancelled", "closed", "expired", "purpose_closed", "account_closed"])("denies new declarations for %s work without changing prior evidence", async state => {
    const value = await start(); await clear(); const before = await saved(value.id), base = await version(value.id);
    if (state === "cancelled" || state === "closed") await fixture.admin.query("update public.parent_requests set status=$2 where id=$1", [value.id, state]);
    if (state === "expired") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1", [value.id]);
    if (state === "purpose_closed") await fixture.admin.query("update parent_private.processing_controls set wic_details_enabled=false");
    if (state === "account_closed") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [owner]);
    await expect(save(value, base, ["contact.firstName"])).rejects.toMatchObject({ code: state === "cancelled" || state === "closed" ? "40001" : "42501" });
    expect(await saved(value.id)).toEqual(before);
  });
  it("keeps confirmation-aware internals inaccessible to every application role", async () => {
    for (const role of ["anon", "authenticated", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker", "parent_snap_finalizer", "parent_utility_protected"]) {
      const result = await fixture.admin.query("select has_function_privilege($1,'parent_private.save_wic_application_details(uuid,integer,jsonb,text,uuid,boolean,text[])','EXECUTE') allowed", [role]);
      expect(result.rows[0].allowed).toBe(false);
    }
  });
});
