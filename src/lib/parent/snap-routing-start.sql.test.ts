import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { FAMILY_PROFILE_NOTICE_VERSION } from "./family-profile";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID, SNAP_SPANISH_APPLICATION_SOURCE } from "./snap-form-source";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const sourceAt = "2026-11-16T12:00:00.000Z", profileAt = "2026-11-17T12:00:00.000Z", at = "2026-11-18T12:00:00.000Z";
describe.skipIf(!modulePath)("ordinary routing and private SNAP start remain separate facts", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  async function query(sql: string, args: unknown[] = [], user = owner, role = "authenticated", token = session) {
    await fixture.admin.query(`set role ${role}`);
    try { await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: token, role, amr: [{ method: "otp" }] })]); return await fixture.admin.query(sql, args); }
    finally { await fixture.admin.query("reset role"); }
  }
  beforeAll(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(sourceAt); fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.setSystemTime(sourceAt); owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic routing only',approved_until=now()+interval '90 days',snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '90 days',snap_details_notice_version=$1,family_profile_enabled=true,family_profile_approval_reference='synthetic only',family_profile_approved_until=now()+interval '90 days',family_profile_notice_version=$2", [SNAP_APPLICATION_NOTICE_VERSION, FAMILY_PROFILE_NOTICE_VERSION]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')", [session, owner]);
    await query("select public.parent_ensure_account()");
  });
  async function setup(home = "19104", profile = false) {
    const source = (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["food_now"], zip: "19129", utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: ["philly-food"], allowedActions: ["research", "prepare"], allowedData: ["household"], expiresAt: "2026-12-01T00:00:00Z" })), randomUUID()])).rows[0].id as string;
    vi.setSystemTime(profileAt);
    const family = profile ? { expectedOwnerId: owner, revision: 1, fields: [{ applicationPath: "zip", profilePaths: ["homeAddress.zip"] }], options: { useHomeAddress: true } } : null;
    if (profile) await query("select public.parent_save_family_profile($1,0,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify({ primaryPerson: { id: randomUUID() }, homeAddress: { street: "1 Synthetic Street", city: "Philadelphia", state: "PA", zip: home, county: "Philadelphia" } }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    vi.setSystemTime(at);
    return { source, sourceVersion: 1, family, key: randomUUID(), template: null as string | null,
      intake: fixtureIntake({ needs: ["food_now", "snap_new"], zip: "19129", utilityProviders: [], householdSize: null }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["share-community-fridge-19129", "snap-pa"], allowedActions: ["research", "prepare"], allowedData: ["household", "income"], expiresAt: "2026-11-25T12:00:00Z" }),
      details: { zip: home, language: "en", applicant: { firstName: "Synthetic" } } };
  }
  type Input = Awaited<ReturnType<typeof setup>>;
  async function start(s: Input) { return (await query("select public.parent_start_snap_application_with_routing($1,$2,$3,$4,$5,$6,$7,$8,$9) id",
    [JSON.stringify(s.intake), JSON.stringify(s.mandate), JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, s.key, s.source, s.sourceVersion, s.family ? JSON.stringify(s.family) : null, s.template])).rows[0].id as string; }
  const row = async (id: string) => (await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [id])).rows[0].value;
  const snapshots = async (id: string) => (await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where request_id=$1 order by revision", [id])).rows.map(r => r.value);
  it("preserves installed definitions, owners and grants outside the12 exact reviewed replacements", async () => {
    const migration = readFileSync("supabase/migrations/20261118192417_parent_snap_ordinary_routing_reuse.sql", "utf8"), edits = [...migration.matchAll(/\('([^']+)', \$old\$([\s\S]*?)\$old\$, \$new\$([\s\S]*?)\$new\$\)/g)];
    expect(edits).toHaveLength(12);
    const signatures = [...new Set(edits.map(edit => edit[1]))], installed = new Map<string, { definition: string; proowner: number; proacl: unknown }>();
    const metadata = async (signature: string) => (await fixture.admin.query("select pg_get_functiondef(p.oid) definition,p.proowner,p.proacl from pg_proc p where p.oid=$1::regprocedure", [signature])).rows[0];
    for (const signature of signatures) installed.set(signature, await metadata(signature));
    const originals = new Map([...installed].map(([signature, value]) => [signature, value.definition]));
    for (const edit of [...edits].reverse()) {
      const definition = originals.get(edit[1])!; expect(definition.split(edit[3])).toHaveLength(2); originals.set(edit[1], definition.replace(edit[3], edit[2]));
    }
    for (const definition of originals.values()) await fixture.admin.query(definition);
    const patch = migration.slice(migration.indexOf("do $migration$")); await fixture.admin.query(patch);
    for (const signature of signatures) expect(await metadata(signature)).toEqual(installed.get(signature));
    await expect(fixture.admin.query(patch)).rejects.toThrow("SNAP routing compatibility target changed");
    for (const signature of signatures) expect(await metadata(signature)).toEqual(installed.get(signature));
    for (const role of ["anon", "authenticated", "service_role", "parent_worker", "parent_retention_worker", "parent_snap_sender"]) for (const helper of ["snap_routing_start_hash", "independent_snap_routing"])
      expect((await fixture.admin.query("select has_function_privilege($1,$2,'execute') allowed", [role, `parent_private.${helper}(uuid)`])).rows[0].allowed).toBe(false);
    for (const role of ["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_utility_protected"])
      expect((await fixture.admin.query("select has_function_privilege($1,'public.parent_start_snap_application_with_routing(jsonb,jsonb,jsonb,text,uuid,uuid,integer,jsonb,text)','execute') allowed", [role])).rows[0].allowed).toBe(role === "authenticated");
  });
  it.each([false, true])("keeps different routing/home ZIP values and their original dates (profile=%s)", async profile => {
    const s = await setup("19104", profile), id = await start(s), r = await row(id), snapshot = (await snapshots(id))[0];
    expect(r.intake.zip).toBe("19129"); expect(snapshot.details.zip).toBe("19104"); expect(new Date(r.intake_confirmed_at.zip).toISOString()).toBe(sourceAt);
    expect(new Date(snapshot.provenance.zip.confirmedAt).toISOString()).toBe(profile ? profileAt : at);
    expect(r.intake_reuse.zip).toMatchObject({ sourceRequestId: s.source, sourceVersion: 1 });
    expect((await fixture.admin.query("select parent_private.current_grant($1,$2) allowed", [id, r.version])).rows[0].allowed).toBe(true);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_jobs where request_id=$1", [id])).rows[0].n).toBe(1);
    const evidence = (await fixture.admin.query("select evidence from public.parent_events where request_id=$1 and kind='request.started'", [id])).rows[0].evidence;
    expect(Object.keys(evidence).sort()).toEqual(["expiresAt", "mandateVersion", "snapRoutingStartHash"]);
    expect(evidence.snapRoutingStartHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([false, true])("does not collapse equal ZIP values into one provenance source (profile=%s)", async profile => {
    const s = await setup("19129", profile), id = await start(s), r = await row(id), saved = (await snapshots(id))[0];
    expect(new Date(r.intake_confirmed_at.zip).toISOString()).toBe(sourceAt);
    expect(new Date(saved.provenance.zip.confirmedAt).toISOString()).toBe(profile ? profileAt : at);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.family_profile_request_sources where request_id=$1 and application_path='intake.zip'", [id])).rows[0].n).toBe(0);
  });
  it("preserves the ordinary date even through the existing source-aware profile start", async () => {
    const s = await setup("19129", true);
    const id = (await query("select public.parent_start_application_with_family_profile('snap_application',$1,$2,$3,$4,$5,$6,false,false,$7,$8) id", [JSON.stringify(s.intake), JSON.stringify(s.mandate), JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, s.key, JSON.stringify(s.family), s.source, 1])).rows[0].id;
    expect(new Date((await row(id)).intake_confirmed_at.zip).toISOString()).toBe(sourceAt);
  });
  it("restores transaction-local document choice after success and a rejected private write", async () => {
    const s = await setup(); s.template = SNAP_ES_TEMPLATE_ID;
    await fixture.admin.query("select set_config('caselink.snap_document_template',$1,false)", [SNAP_EN_TEMPLATE_ID]);
    const choice = async () => (await fixture.admin.query("select current_setting('caselink.snap_document_template',true) choice")).rows[0].choice;
    try {
      const id = await start(s); expect((await snapshots(id))[0].source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE); expect(await choice()).toBe(SNAP_EN_TEMPLATE_ID);
      await expect(start({ ...s, key: randomUUID(), details: { ...s.details, zip: "invalid" } })).rejects.toMatchObject({ code: "23514" });
      expect(await choice()).toBe(SNAP_EN_TEMPLATE_ID);
    } finally { await fixture.admin.query("select set_config('caselink.snap_document_template','',false)"); }
  });
  it("acknowledges an exact historical receipt after private correction, routing expiry and profile clear without changing any current state", async () => {
    const s = await setup("19104", true); s.template = SNAP_ES_TEMPLATE_ID;
    const id = await start(s), current = await row(id);
    await query("select public.parent_save_application_with_family_profile('snap_application',$1,$2,$3,$4,$5,null)", [id, current.version, JSON.stringify({ ...s.details, bestTimeToCall: "Morning" }), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()]);
    await query("select public.parent_clear_family_profile($1,1,$2)", [owner, randomUUID()]);
    await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}','\"2026-01-01T12:00:00Z\"') where id=$1", [s.source]);
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false,family_profile_enabled=false");
    const work = async () => (await fixture.admin.query("select to_jsonb(j) value from public.parent_jobs j where request_id=$1", [id])).rows;
    const events = async () => (await fixture.admin.query("select to_jsonb(e) value from public.parent_events e where request_id=$1 order by id", [id])).rows;
    const before = { request: await row(id), snapshots: await snapshots(id), work: await work(), events: await events() };
    expect(await start(s)).toBe(id); expect({ request: await row(id), snapshots: await snapshots(id), work: await work(), events: await events() }).toEqual(before);
    expect(before.snapshots[0].source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);
  });
  it.each(["details", "source", "source_version", "template", "profile", "mandate"])("rejects changed %s with the same start key", async kind => {
    const s = await setup(), id = await start(s), before = await row(id);
    if (kind === "details") s.details.zip = "19103";
    if (kind === "source") s.source = randomUUID();
    if (kind === "source_version") s.sourceVersion++;
    if (kind === "template") s.template = SNAP_EN_TEMPLATE_ID;
    if (kind === "profile") Object.assign(s, { family: { expectedOwnerId: owner, revision: 1, fields: [{ applicationPath: "zip", profilePaths: ["homeAddress.zip"] }] } });
    if (kind === "mandate") s.mandate.allowedData = ["household"];
    await expect(start(s)).rejects.toMatchObject({ code: "PT409" }); expect(await row(id)).toEqual(before);
  });
  it.each(["ordinary", "reused", "snap", "source", "profile"])("rejects crossing a marked start through the legacy %s entry", async kind => {
    const s = await setup("19104", kind === "profile"), id = await start(s), before = await snapshots(id);
    const args = [JSON.stringify(s.intake), JSON.stringify(s.mandate), s.key];
    const call = kind === "ordinary" ? query("select public.parent_start_request($1,$2,$3)", args)
      : kind === "reused" ? query("select public.parent_start_request_with_reused_zip($1,$2,$3,$4,1)", [...args, s.source])
      : kind === "snap" ? query("select public.parent_start_snap_application($1,$2,$3,$4,$5)", [args[0], args[1], JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, s.key])
      : kind === "source" ? query("select public.parent_start_snap_application_source($1,$2,$3,$4,$5,$6)", [args[0], args[1], JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, s.key, SNAP_EN_TEMPLATE_ID])
      : query("select public.parent_start_application_with_family_profile('snap_application',$1,$2,$3,$4,$5,$6,false,false,$7,1)", [args[0], args[1], JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, s.key, JSON.stringify(s.family), s.source]);
    await expect(call).rejects.toMatchObject({ code: "PT409" }); expect(await snapshots(id)).toEqual(before);
  });
  it("fails an unavailable source or invalid private draft atomically without a request, packet or job", async () => {
    const s = await setup(), before = (await fixture.admin.query("select count(*)::int n from public.parent_requests")).rows[0].n;
    await expect(start({ ...s, sourceVersion: 2 })).rejects.toMatchObject({ code: "P0001", message: "parent_reuse_source_changed" });
    await expect(start({ ...s, details: { ...s.details, zip: "invalid" } })).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests")).rows[0].n).toBe(before);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests where start_key=$1", [s.key])).rows[0].n).toBe(0);
  });
  it("does not let later private/profile ZIP corrections replace independently routed current intake", async () => {
    const s = await setup("19104", true), id = await start(s), before = await row(id);
    await query("select public.parent_save_application_with_family_profile('snap_application',$1,$2,$3,$4,$5,null)", [id, before.version, JSON.stringify({ ...s.details, zip: "19103" }), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()]);
    const saved = await row(id); expect(saved.intake.zip).toBe("19129"); expect(saved.intake_reuse).toEqual(before.intake_reuse); expect(saved.intake_confirmed_at.zip).toBe(before.intake_confirmed_at.zip);
  });
  it("automatically applies a corrected private profile home without replacing or renewing ordinary routing", async () => {
    const s = await setup("19104", true), id = await start(s), before = await row(id);
    const profile = (await query("select public.parent_get_family_profile() value")).rows[0].value.profile;
    const correctedAt = "2026-11-18T13:00:00.000Z"; vi.setSystemTime(correctedAt);
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)", [owner, JSON.stringify({ ...profile.details, homeAddress: { ...profile.details.homeAddress, zip: "19103" } }), FAMILY_PROFILE_NOTICE_VERSION, randomUUID()]);
    const current = await row(id), latest = (await snapshots(id)).at(-1)!;
    expect(latest.details.zip).toBe("19103"); expect(new Date(latest.provenance.zip.confirmedAt).toISOString()).toBe(correctedAt);
    expect(current.intake.zip).toBe("19129"); expect(current.intake_reuse).toEqual(before.intake_reuse); expect(current.intake_confirmed_at.zip).toBe(before.intake_confirmed_at.zip);
    expect(await start(s)).toBe(id);
  });
  it.each(["source_expired", "source_withdrawn", "foreign_source", "account_hold", "purpose_closed", "legacy_key"])("does not start against invalid current %s authority", async kind => {
    const s = await setup(), before = (await fixture.admin.query("select count(*)::int n from public.parent_requests")).rows[0].n;
    if (kind === "source_expired") await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}','\"2026-01-01T12:00:00Z\"') where id=$1", [s.source]);
    if (kind === "source_withdrawn") await query("select public.parent_control_request($1,'cancel')", [s.source]);
    if (kind === "foreign_source") {
      const foreignOwner = randomUUID(), foreignSession = randomUUID();
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [foreignOwner, `${foreignOwner}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')", [foreignSession, foreignOwner]);
      s.source = (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(s.intake), JSON.stringify(s.mandate), randomUUID()], foreignOwner, "authenticated", foreignSession)).rows[0].id;
    }
    if (kind === "account_hold") await fixture.admin.query("update public.parent_accounts set status='security_hold' where id=$1", [owner]);
    if (kind === "purpose_closed") await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    if (kind === "legacy_key") s.key = (await fixture.admin.query("select start_key from public.parent_requests where id=$1", [s.source])).rows[0].start_key;
    await expect(start(s)).rejects.toMatchObject({ code: ["source_expired", "source_withdrawn", "foreign_source"].includes(kind) ? "P0001" : kind === "legacy_key" ? "PT409" : "42501" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests")).rows[0].n).toBe(before + (kind === "foreign_source" ? 1 : 0));
  });
});
