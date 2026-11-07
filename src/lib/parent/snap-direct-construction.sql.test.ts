import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const version = "pa600fs-direct-completion-2026-11-05.v1";
const acts = ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"];
const payload = Buffer.from("SYNTHETIC_NONPDF_SQL_CONSTRUCTION_ONLY"), contentHash = createHash("sha256").update(payload).digest("hex");
type Scope = { owner: string; request: string; version: number; snapshot: string; snapshotHash: string; packet: string; authorization: string; acquisition: string };
const contextSql = "select parent_private.parent_get_snap_direct_context($1,$2,$3,$4,$5,$6,$7,$8) value";
const recordSql = "select parent_private.parent_record_snap_direct_construction($1,$2,$3,$4) value";
const readSql = "select parent_private.parent_read_snap_direct_construction($1,$2,$3,$4) value";

describe.skipIf(!modulePath)("closed SNAP construction SQL (non-PDF bytes and non-cryptographic Vault double only)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    // No PDF/content/handwriting/origin or encryption proof: the actual DB transaction/ACLs alone are exercised.
    for (const sql of ["create schema vault", "create schema extensions",
      "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
      "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$",
      "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$"])
      await fixture.admin.query(sql);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function tx<T>(fn: () => Promise<T>) {
    await fixture.admin.query("begin");
    try { const result = await fn(); await fixture.admin.query("commit"); return result; }
    catch (error) { await fixture.admin.query("rollback"); throw error; }
  }
  async function role(actor: string, sql: string, values: unknown[] = [], owner?: string) {
    await fixture.admin.query("savepoint role_call");
    try {
      await fixture.admin.query(`set local role ${actor}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: actor, sub: owner, session_id: owner && sessions.get(owner), amr: [{ method: "otp" }] })]);
      const result = await fixture.admin.query(sql, values);
      await fixture.admin.query("reset role"); await fixture.admin.query("release savepoint role_call"); return result;
    } catch (error) { await fixture.admin.query("rollback to savepoint role_call"); await fixture.admin.query("release savepoint role_call"); throw error; }
  }
  const call = (actor: string, sql: string, values: unknown[] = [], owner?: string) => tx(() => role(actor, sql, values, owner));
  const tuple = (s: Scope) => [s.packet, s.request, s.version, s.authorization];
  const contextArgs = (s: Scope) => [s.authorization, s.request, s.version, s.snapshot, s.snapshotHash, contentHash, payload.length, s.packet];
  const context = (s: Scope, values = contextArgs(s)) => call("parent_snap_finalizer", contextSql, values);
  const read = (s: Scope, values = tuple(s)) => call("parent_snap_finalizer", readSql, values);
  const row = async (s: Scope) => (await fixture.admin.query("select to_jsonb(v) value from parent_private.snap_final_packet_verifications v where packet_id=$1", [s.packet])).rows[0]?.value;
  const counts = async () => (await fixture.admin.query("select (select count(*)::int from vault.secrets) keys,(select count(*)::int from parent_private.snap_final_packets) packets,(select count(*)::int from parent_private.snap_final_packet_verifications) receipts")).rows[0];
  async function setup(retention = 300, details = fixtureSnapApplication(new Date()), linked = true, reserve = true): Promise<Scope> {
    const owner = randomUUID(), session = randomUUID(); sessions.set(owner, session);
    // Synthetic route/method evidence only; no Pennsylvania acceptance or real delivery is asserted.
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until,snap_direct_completion_version,snap_direct_completion_evidence_reference)
      values('snap-pa','submit',true,true,true,'synthetic-construction-v1','synthetic route fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',$1,clock_timestamp()+interval '1 hour',$2,'synthetic method fixture only; NOT PA acceptance')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,permission_reference=excluded.permission_reference,
        allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until,
        snap_direct_completion_version=excluded.snap_direct_completion_version,snap_direct_completion_evidence_reference=excluded.snap_direct_completion_evidence_reference`, [acts, version]);
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic construction SQL only',approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1,
      snap_protected_enabled=true,snap_protected_approval_reference='synthetic only; no published policy',snap_protected_approved_until=now()+interval '1 day',
      snap_protected_policy_version='synthetic-policy-1',snap_protected_retention_policy_version='synthetic-retention-1',snap_protected_max_retention_seconds=$2`, [SNAP_APPLICATION_NOTICE_VERSION, retention]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    const request = (await call("authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })), JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"] })), randomUUID()], owner)).rows[0].id as string;
    const snapshot = (await call("authenticated", "select public.parent_save_snap_application_details($1,1,$2,$3,$4) id", [request, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], owner)).rows[0].id as string;
    const requestVersion = (await fixture.admin.query("select version from public.parent_requests where id=$1", [request])).rows[0].version as number;
    const snapshotHash = (await fixture.admin.query("select parent_private.snap_application_binding($1,$2)->>'snapshotHash' hash", [request, requestVersion])).rows[0].hash as string;
    const packet = randomUUID(), acquisition = randomUUID(), subjects = details.household!.filter(person => person.requestingSnap).map(person => person.id);
    if (linked) await call("authenticated", "select public.parent_authorize_snap_direct_acquisition($1,$2,$3,$4,$5,'synthetic-policy-1','synthetic-retention-1',$6,true,date_trunc('milliseconds',clock_timestamp()+interval '4 minutes'))", [request, requestVersion, snapshot, snapshotHash, acquisition, subjects], owner);
    const authorization = reserve ? (linked
      ? await call("authenticated", "select public.parent_authorize_snap_direct_packet($1,$2,$3,$4,$5,$6,$7,$8) value", [request, requestVersion, snapshot, snapshotHash, packet, contentHash, payload.length, acquisition], owner)
      : await call("authenticated", "select public.parent_authorize_snap_final_packet($1,$2,$3,$4,$5,$6,$7,'synthetic-policy-1','synthetic-retention-1',$8,true) value", [request, requestVersion, snapshot, snapshotHash, packet, contentHash, payload.length, subjects], owner)).rows[0].value.intent.authorizationId as string : randomUUID();
    return { owner, request, version: requestVersion, snapshot, snapshotHash, packet, authorization, acquisition };
  }
  async function begin(s: Scope) { await role("parent_snap_finalizer", "select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8)", contextArgs(s)); }
  async function seal(s: Scope) {
    await role("parent_snap_finalizer", "select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,decode(repeat('ab',12),'hex'),decode(repeat('ab',16),'hex'),decode(repeat('ab',$5),'hex'))", [...tuple(s), payload.length]);
  }
  async function stage(s: Scope, record = true) {
    return tx(async () => { await begin(s); await seal(s); return record ? (await role("parent_snap_finalizer", recordSql, tuple(s))).rows[0].value : undefined; });
  }
  const finishSql = "select parent_private.parent_finish_snap_direct_completion($1,$2,$3,$4,$5) id";
  const operationSql = "select parent_private.parent_read_snap_direct_operation($1,$2,$3,$4,$5) id";
  async function complete(s: Scope) {
    return tx(async () => {
      await begin(s); await seal(s);
      const construction = (await role("parent_snap_finalizer", recordSql, tuple(s))).rows[0].value;
      const operation = (await role("parent_snap_finalizer", finishSql, [...tuple(s), construction.verificationId])).rows[0].id;
      return { operation, construction };
    });
  }
  const discover = (s: Scope, values: unknown[] = [s.request, s.version, s.snapshot, s.snapshotHash], owner = s.owner) =>
    call("authenticated", "select public.parent_get_snap_current_direct_packet($1,$2,$3,$4) value", values, owner);
  const capture = (s: Scope) => call("authenticated", "select public.parent_get_snap_current_capture($1,$2) value", [s.request, s.version], s.owner);
  const replace = (s: Scope, packet = s.packet) => call("authenticated", "select public.parent_replace_snap_personal_pages($1,$2,$3) version", [s.request, s.version, packet], s.owner);
  const authorizePacket = (s: Scope, packet = s.packet, digest = contentHash) => call("authenticated", "select public.parent_authorize_snap_direct_packet($1,$2,$3,$4,$5,$6,$7,$8) value", [s.request, s.version, s.snapshot, s.snapshotHash, packet, digest, payload.length, s.acquisition], s.owner);

  it("returns NULL only for no registered direct intent, then rediscovers the exact intent and sealed pointer without writes", async () => {
    const s = await setup(300, fixtureSnapApplication(new Date()), true, false), before = await counts();
    expect((await discover(s)).rows[0].value).toBeNull(); expect((await capture(s)).rows[0].value).toBeNull(); expect(await counts()).toEqual(before);
    const first = (await authorizePacket(s)).rows[0].value; s.authorization = first.intent.authorizationId;
    expect((await discover(s)).rows[0].value).toEqual(first);
    expect((await capture(s)).rows[0].value).toEqual({ packetId: s.packet, requestVersion: s.version, state: "unavailable", reason: "permission_or_file_unavailable" });
    await expect(read(s)).rejects.toMatchObject({ code: "42501" }); expect(await counts()).toEqual(before);
    await stage(s); const stored = (await discover(s)).rows[0].value;
    expect(stored).toEqual({ ...first, state: "stored" }); expect((await capture(s)).rows[0].value).toMatchObject({ packetId: s.packet, state: "pending", reason: null });
    const recorded = await row(s); expect((await discover(s)).rows[0].value).toEqual(stored); expect(await row(s)).toEqual(recorded);
    expect(JSON.stringify(stored)).not.toMatch(/keyBase64|ciphertext|firstName|strokes|submissionReady/);
  });
  it("atomically makes the exact constructed packet checked and reviewable, without recording Submit or a personal-act claim", async () => {
    const s = await setup(); await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where request_id=$1", [s.request]);
    const result = await complete(s), args = [...tuple(s), result.construction.verificationId];
    expect((await call("parent_snap_finalizer", operationSql, args)).rows[0].id).toBe(result.operation);
    const review = (await call("authenticated", "select public.parent_get_snap_review($1,$2) value", [s.request, s.version], s.owner)).rows[0].value;
    expect(review).toMatchObject({ operationId: result.operation, state: "prepared", protectedPacketCurrent: true,
      protectedParentSubmitReady: true, personalActsComplete: false, snapSubmissionAuthorized: false,
      packet: { protectedSnapPacket: { packetId: s.packet, verificationId: result.construction.verificationId, contentSha256: contentHash } } });
    expect((await fixture.admin.query("select state,snap_capture_state,snap_capture_wake_lease_token from public.parent_jobs where request_id=$1", [s.request])).rows[0])
      .toEqual({ state: "queued", snap_capture_state: "checked", snap_capture_wake_lease_token: null });
    const before = await counts();
    await expect(call("parent_snap_finalizer", finishSql, args)).rejects.toMatchObject({ code: "42501" });
    expect((await call("parent_snap_finalizer", operationSql, args)).rows[0].id).toBe(result.operation); expect(await counts()).toEqual(before);
    expect((await fixture.admin.query("select 1 from parent_private.personal_act_evidence where operation_id=$1", [result.operation])).rows).toEqual([]);
    expect((await fixture.admin.query("select 1 from parent_private.snap_submission_authorizations where operation_id=$1", [result.operation])).rows).toEqual([]);
    expect((await fixture.admin.query("select 1 from public.parent_receipts where request_id=$1", [s.request])).rows).toEqual([]);
  });
  it("preserves an active worker lease, then wakes one fresh pass for the completed packet", async () => {
    const s = await setup(), token = randomUUID();
    await fixture.admin.query("update public.parent_jobs set state='leased',lease_token=$2,lease_started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '2 minutes' where request_id=$1", [s.request, token]);
    await complete(s);
    expect((await fixture.admin.query("select state,lease_token,snap_capture_wake_lease_token from public.parent_jobs where request_id=$1", [s.request])).rows[0])
      .toEqual({ state: "leased", lease_token: token, snap_capture_wake_lease_token: token });
    // Serial lost-wakeup schedule only; native concurrent locking is not established by this fixture.
    await fixture.admin.query("update public.parent_jobs set state='waiting',lease_token=null,lease_until=null,run_at='infinity' where request_id=$1", [s.request]);
    expect((await fixture.admin.query("select state,lease_token,snap_capture_wake_lease_token,snap_capture_state from public.parent_jobs where request_id=$1", [s.request])).rows[0])
      .toEqual({ state: "queued", lease_token: null, snap_capture_wake_lease_token: null, snap_capture_state: "checked" });
  });
  it("rolls the packet, key, construction and operation back if completion binding fails", async () => {
    const s = await setup(), before = await counts();
    await expect(tx(async () => {
      await begin(s); await seal(s); await role("parent_snap_finalizer", recordSql, tuple(s));
      await role("parent_snap_finalizer", finishSql, [...tuple(s), randomUUID()]);
    })).rejects.toMatchObject({ code: "42501" });
    expect(await counts()).toEqual(before); expect(await row(s)).toBeUndefined();
    expect((await fixture.admin.query("select 1 from public.parent_operations where request_id=$1", [s.request])).rows).toEqual([]);
    expect((await fixture.admin.query("select snap_packet_id,snap_capture_state from public.parent_jobs where request_id=$1", [s.request])).rows[0])
      .toEqual({ snap_packet_id: null, snap_capture_state: null });
  });
  it.each(["packet", "request", "version", "authorization", "verification", "not_checked", "method_closed", "revocation", "correction", "cancel", "expiry"])("rejects changed %s on read-only operation recovery without repairing it", async changed => {
    const s = await setup(), result = await complete(s), args = [...tuple(s), result.construction.verificationId];
    if (changed === "packet") args[0] = randomUUID();
    if (changed === "request") args[1] = randomUUID();
    if (changed === "version") args[2] = s.version + 1;
    if (changed === "authorization") args[3] = randomUUID();
    if (changed === "verification") args[4] = randomUUID();
    if (changed === "not_checked") await fixture.admin.query("update public.parent_jobs set snap_capture_state='pending' where request_id=$1", [s.request]);
    if (changed === "method_closed") await fixture.admin.query("update parent_private.provider_capabilities set snap_direct_completion_version=null,snap_direct_completion_evidence_reference=null where program_id='snap-pa' and action='submit'");
    if (changed === "revocation") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.acquisition]);
    if (changed === "correction") await call("authenticated", "select public.parent_save_snap_application_details($1,$2,$3,$4,$5)", [s.request, s.version, JSON.stringify({ ...fixtureSnapApplication(new Date()), bestTimeToCall: "Evenings" }), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    if (changed === "cancel") await call("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    if (changed === "expiry") await fixture.admin.query("update parent_private.processing_controls set snap_protected_approved_until=clock_timestamp()-interval '1 second'");
    const before = await counts(), proof = await row(s);
    await expect(call("parent_snap_finalizer", operationSql, args)).rejects.toMatchObject({ code: "42501" });
    expect(await counts()).toEqual(before); expect(await row(s)).toEqual(proof);
  });
  it.each(["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker"])("keeps continuation functions inaccessible to %s", async actor => {
    expect((await fixture.admin.query("select bool_or(has_function_privilege($1,p.oid,'EXECUTE')) allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='parent_private' and p.proname=any($2::text[])", [actor, ["parent_finish_snap_direct_completion", "parent_read_snap_direct_operation"]])).rows[0].allowed).toBe(false);
  });
  it.each(["version", "snapshot", "hash", "foreign_owner", "session"])("rejects %s current-intent discovery rather than claiming absence", async field => {
    const s = await setup(), values: unknown[] = [s.request, s.version, s.snapshot, s.snapshotHash]; let owner = s.owner;
    if (field === "version") values[1] = s.version + 1;
    if (field === "snapshot") values[2] = randomUUID();
    if (field === "hash") values[3] = "f".repeat(64);
    if (field === "foreign_owner") owner = (await setup()).owner;
    if (field === "session") await fixture.admin.query("delete from auth.sessions where id=$1", [sessions.get(s.owner)]);
    await expect(discover(s, values, owner)).rejects.toMatchObject({ code: "42501" });
  });
  it.each([contentHash, "f".repeat(64)])("rejects a competing packet UUID at the same version even for digest %s", async digest => {
    const s = await setup(), before = (await discover(s)).rows[0].value;
    await expect(authorizePacket(s, randomUUID(), digest)).rejects.toMatchObject({ code: "40001" });
    expect((await authorizePacket(s)).rows[0].value).toEqual(before); expect((await discover(s)).rows[0].value).toEqual(before);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_final_packet_authorizations where request_id=$1 and acquisition_authorization_id is not null", [s.request])).rows[0].n).toBe(1);
  });
  it("preserves a stored binary selection instead of reserving a competing direct file", async () => {
    const s = await setup(300, fixtureSnapApplication(new Date()), false); await stage(s, false);
    await call("authenticated", "select public.parent_authorize_snap_direct_acquisition($1,$2,$3,$4,$5,'synthetic-policy-1','synthetic-retention-1',$6,true,date_trunc('milliseconds',clock_timestamp()+interval '4 minutes'))", [s.request, s.version, s.snapshot, s.snapshotHash, s.acquisition, fixtureSnapApplication().household!.filter(person => person.requestingSnap).map(person => person.id)], s.owner);
    await expect(authorizePacket(s, randomUUID())).rejects.toMatchObject({ code: "40001" });
    expect((await capture(s)).rows[0].value).toMatchObject({ packetId: s.packet, state: "pending" });
  });
  it("fails the actual unique-index migration on ambiguous history instead of choosing or deleting an intent", async () => {
    const s = await setup(), ddl = readFileSync("supabase/migrations/20261105212440_parent_snap_direct_intent_recovery.sql", "utf8").match(/create unique index[\s\S]*?;/)![0];
    await expect(tx(async () => {
      await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.authorization]);
      await fixture.admin.query("drop index parent_private.parent_snap_one_direct_intent_per_version");
      await fixture.admin.query("insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'packet_id',gen_random_uuid()))).* from parent_private.snap_final_packet_authorizations a where id=$1", [s.authorization]);
      await fixture.admin.query(ddl);
    })).rejects.toMatchObject({ code: "23505" });
    expect((await discover(s)).rows[0].value.intent.packetId).toBe(s.packet);
  });
  it("denies ambiguous discovery and locator data even if a privileged fixture removes the unique index", async () => {
    const s = await setup();
    await expect(tx(async () => {
      await fixture.admin.query("drop index parent_private.parent_snap_one_direct_intent_per_version");
      await fixture.admin.query("insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'packet_id',gen_random_uuid()))).* from parent_private.snap_final_packet_authorizations a where id=$1", [s.authorization]);
      await expect(role("authenticated", "select public.parent_get_snap_current_direct_packet($1,$2,$3,$4)", [s.request, s.version, s.snapshot, s.snapshotHash], s.owner)).rejects.toMatchObject({ code: "23514" });
      await expect(role("authenticated", "select public.parent_get_snap_current_capture($1,$2)", [s.request, s.version], s.owner)).rejects.toMatchObject({ code: "23514" });
      throw new Error("synthetic ambiguity rollback");
    })).rejects.toThrow("synthetic ambiguity rollback");
  });
  it.each(["seal_first", "correction_first"])("keeps the exact pointer across the serial %s interleaving (not a native concurrency proof)", async order => {
    const s = await setup(), saved = (await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where id=$1", [s.snapshot])).rows[0].value;
    const permission = (await call("authenticated", "select public.parent_get_snap_direct_acquisition($1,$2,$3,$4) value", [s.request, s.version, s.snapshot, s.snapshotHash], s.owner)).rows[0].value;
    if (order === "seal_first") await stage(s);
    const version = (await replace(s)).rows[0].version as number;
    expect((await replace(s)).rows[0].version).toBe(version); await expect(replace(s, randomUUID())).rejects.toMatchObject({ code: "40001" });
    if (order === "correction_first") await expect(stage(s)).rejects.toMatchObject({ code: "42501" });
    await expect(discover(s)).rejects.toMatchObject({ code: "42501" });
    const next = { ...s, version, packet: randomUUID() }, registered = (await authorizePacket(next)).rows[0].value; next.authorization = registered.intent.authorizationId;
    expect(registered.consentedAt).toBe(permission.consentedAt); expect(registered.authorizationExpiresAt).toBe(permission.expiresAt);
    expect((await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where id=$1", [s.snapshot])).rows[0].value).toEqual(saved);
    await stage(next); expect((await capture(next)).rows[0].value.packetId).toBe(next.packet); expect((await discover(next)).rows[0].value.intent.packetId).toBe(next.packet);
  });
  it.each(["withdrawal", "expiry"])("recovers an unsealed %s locator under new legitimate permission without reviving or backdating old consent", async event => {
    const s = await setup(event === "expiry" ? 1 : 300), original = (await discover(s)).rows[0].value;
    if (event === "withdrawal") await call("authenticated", "select public.parent_revoke_snap_direct_acquisition($1,$2)", [s.request, s.acquisition], s.owner);
    else await delay(1100);
    await expect(discover(s)).rejects.toMatchObject({ code: "42501" });
    expect((await capture(s)).rows[0].value).toEqual({ packetId: s.packet, requestVersion: s.version, state: "unavailable", reason: "permission_or_file_unavailable" });
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=300");
    const acquisition = randomUUID(), subjects = fixtureSnapApplication().household!.filter(person => person.requestingSnap).map(person => person.id);
    const permission = (await call("authenticated", "select public.parent_authorize_snap_direct_acquisition($1,$2,$3,$4,$5,'synthetic-policy-1','synthetic-retention-1',$6,true,date_trunc('milliseconds',clock_timestamp()+interval '4 minutes')) value", [s.request, s.version, s.snapshot, s.snapshotHash, acquisition, subjects], s.owner)).rows[0].value;
    expect(Date.parse(permission.consentedAt)).toBeGreaterThanOrEqual(Date.parse(original.consentedAt)); expect(permission.acquisitionId).toBe(acquisition);
    await expect(authorizePacket({ ...s, acquisition }, randomUUID())).rejects.toMatchObject({ code: "40001" });
    const version = (await replace(s)).rows[0].version as number, next = { ...s, version, acquisition, packet: randomUUID() };
    expect((await discover(next)).rows[0].value).toBeNull();
    const registered = (await authorizePacket(next)).rows[0].value;
    expect(registered.consentedAt).toBe(permission.consentedAt); expect(registered.authorizationExpiresAt).toBe(permission.expiresAt);
    const old = (await fixture.admin.query("select revoked_at,consented_at,expires_at from parent_private.snap_final_packet_authorizations where id=$1", [s.acquisition])).rows[0];
    expect(new Date(old.consented_at).toISOString()).toBe(original.consentedAt);
    if (event === "withdrawal") expect(old.revoked_at).not.toBeNull(); else expect(new Date(old.expires_at).getTime()).toBeLessThan(Date.now());
  });
  it("keeps current-intent discovery private to authenticated owners with no PUBLIC grant", async () => {
    const s = await setup();
    for (const actor of ["anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])
      await expect(call(actor, "select public.parent_get_snap_current_direct_packet($1,$2,$3,$4)", [s.request, s.version, s.snapshot, s.snapshotHash], s.owner)).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select exists(select 1 from pg_proc p,aclexplode(p.proacl) a where p.oid='public.parent_get_snap_current_direct_packet(uuid,integer,uuid,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') allowed")).rows[0].allowed).toBe(false);
  });

  it("returns only exact DB-owned intent, saved snapshot and immutable preparation timestamp", async () => {
    const s = await setup(), result = (await context(s)).rows[0].value;
    const saved = (await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where id=$1", [s.snapshot])).rows[0].value;
    expect(Object.keys(result).sort()).toEqual(["context", "intent", "preparedAt", "snapshot", "state"]); expect(result.state).toBe("authorized");
    expect(result.snapshot).toEqual(saved); expect(result.preparedAt).toBe(new Date(saved.created_at).toISOString());
    expect(result.context).toEqual({ requestVersion: s.version, snapshotId: s.snapshot, snapshotHash: s.snapshotHash, source: saved.source, applyingSubjectIds: [saved.details.household[0].id] });
    expect(result.intent).toMatchObject({ ownerId: s.owner, packetId: s.packet, authorizationId: s.authorization, requestId: s.request, requestVersion: s.version, snapshotId: s.snapshot, snapshotHash: s.snapshotHash, contentSha256: contentHash, byteLength: payload.length });
    expect(result.intent).not.toHaveProperty("expiresAt"); expect(result).not.toHaveProperty("keyBase64");
    expect((await context(s)).rows[0].value).toEqual(result); expect(await row(s)).toBeUndefined();
  });
  it("denies standalone direct construction while retaining the legacy binary packet path", async () => {
    const s = await setup(300, fixtureSnapApplication(new Date()), false);
    await expect(discover(s)).rejects.toMatchObject({ code: "42501" });
    await expect(context(s)).rejects.toMatchObject({ code: "42501" });
    await expect(stage(s)).rejects.toMatchObject({ code: "42501" });
    await stage(s, false);
    expect((await call("parent_snap_finalizer", "select parent_private.parent_read_snap_final_packet($1,$2,$3,$4,$5,$6) value", [...tuple(s), s.snapshot, s.snapshotHash])).rows[0].value).toHaveProperty("ciphertext");
    await expect(read(s)).rejects.toMatchObject({ code: "42501" }); expect(await row(s)).toBeUndefined();
  });
  it("keeps the original acquisition consent and expiry unchanged through construction and recovery", async () => {
    const s = await setup(), before = (await fixture.admin.query("select to_jsonb(a) value from parent_private.snap_final_packet_authorizations a where id=any($1::uuid[]) order by id", [[s.authorization, s.acquisition]])).rows;
    const receipt = await stage(s); await context(s); await read(s);
    expect((await fixture.admin.query("select to_jsonb(a) value from parent_private.snap_final_packet_authorizations a where id=any($1::uuid[]) order by id", [[s.authorization, s.acquisition]])).rows).toEqual(before);
    const root = before.find(r => r.value.id === s.acquisition)!.value, child = before.find(r => r.value.id === s.authorization)!.value;
    expect(child.consented_at).toBe(root.consented_at); expect(child.expires_at).toBe(root.expires_at);
    expect(new Date(receipt.expiresAt).getTime()).toBeLessThanOrEqual(new Date(root.expires_at).getTime());
  });
  it("blocks generic metadata/key reads after the linked retention bound is shortened, while preserving binary reads", async () => {
    const binary = await setup(300, fixtureSnapApplication(new Date()), false), direct = await setup();
    await stage(binary, false); await stage(direct);
    const metadata = (s: Scope) => call("authenticated", "select public.parent_get_snap_final_packet_authorization($1,$2,$3) value", [s.request, s.packet, s.version], s.owner);
    const open = (s: Scope) => call("parent_snap_finalizer", "select parent_private.parent_read_snap_final_packet($1,$2,$3,$4,$5,$6) value", [...tuple(s), s.snapshot, s.snapshotHash]);
    expect((await metadata(direct)).rows[0].value.state).toBe("stored"); expect((await open(direct)).rows[0].value).toHaveProperty("keyBase64");
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=100");
    await expect(metadata(direct)).rejects.toMatchObject({ code: "42501" }); await expect(open(direct)).rejects.toMatchObject({ code: "42501" });
    expect((await metadata(binary)).rows[0].value.state).toBe("stored"); expect((await open(binary)).rows[0].value).toHaveProperty("keyBase64");
  });
  it("denies generic key access on a revoked root even if a privileged corruption fixture left its child unrevoked", async () => {
    const s = await setup(); await stage(s);
    await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.acquisition]);
    expect((await fixture.admin.query("select revoked_at from parent_private.snap_final_packet_authorizations where id=$1", [s.authorization])).rows[0].revoked_at).toBeNull();
    await expect(call("parent_snap_finalizer", "select parent_private.parent_read_snap_final_packet($1,$2,$3,$4,$5,$6) value", [...tuple(s), s.snapshot, s.snapshotHash])).rejects.toMatchObject({ code: "42501" });
  });
  it("rechecks linked authority before begin and seal without leaving packet/key writes behind", async () => {
    const s = await setup(), before = await counts();
    await expect(tx(async () => {
      await begin(s); await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=100");
      await expect(seal(s)).rejects.toMatchObject({ code: "42501" }); throw new Error("synthetic rollback after denied seal");
    })).rejects.toThrow("synthetic rollback after denied seal");
    expect(await counts()).toEqual(before);
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=100");
    await expect(tx(() => begin(s))).rejects.toMatchObject({ code: "42501" }); expect(await counts()).toEqual(before);
  });
  it.each(["withdrawn", "root_revoked_only", "expired", "foreign_root", "consent", "retention_bound", "reference"])("denies construction and stored recovery with %s acquisition authority", async event => {
    const s = await setup(); await stage(s); const receipt = await row(s), before = await counts();
    if (event === "withdrawn") await call("authenticated", "select public.parent_revoke_snap_direct_acquisition($1,$2)", [s.request, s.acquisition], s.owner);
    if (event === "root_revoked_only") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.acquisition]);
    if (event === "retention_bound") await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=100");
    if (["expired", "foreign_root", "consent", "reference"].includes(event)) {
      const child = (await fixture.admin.query("select to_jsonb(a) value from parent_private.snap_final_packet_authorizations a where id=$1", [s.authorization])).rows[0].value;
      // Privileged corruption fixture only: ordinary actors cannot mutate immutable authorization fields.
      if (event === "foreign_root") child.acquisition_authorization_id = (await setup()).acquisition;
      if (event === "consent") child.consented_at = new Date(new Date(child.consented_at).getTime() - 1).toISOString();
      if (event === "reference") child.consent_reference = `snap-direct-entry:${randomUUID()}`;
      await fixture.admin.query("alter table parent_private.snap_final_packet_authorizations disable trigger parent_snap_packet_authorization_immutable");
      try {
        if (event === "expired") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set expires_at=clock_timestamp()-interval '1 millisecond' where id=$1", [s.acquisition]);
        else await fixture.admin.query("update parent_private.snap_final_packet_authorizations set (acquisition_authorization_id,consented_at,consent_reference)=($2,$3,$4) where id=$1", [s.authorization, child.acquisition_authorization_id, child.consented_at, child.consent_reference]);
      } finally {
        await fixture.admin.query("alter table parent_private.snap_final_packet_authorizations enable trigger parent_snap_packet_authorization_immutable");
      }
    }
    await expect(context(s)).rejects.toMatchObject({ code: "42501" }); await expect(read(s)).rejects.toMatchObject({ code: "42501" });
    expect(await row(s)).toEqual(receipt); expect(await counts()).toEqual(before);
  });
  it.each(["authorization", "request", "version", "snapshot", "snapshotHash", "contentHash", "size", "packet"])("rejects a changed context %s", async field => {
    const s = await setup(), values = contextArgs(s), index = ["authorization", "request", "version", "snapshot", "snapshotHash", "contentHash", "size", "packet"].indexOf(field);
    values[index] = field === "version" ? s.version + 1 : field === "size" ? payload.length + 1 : field.endsWith("Hash") ? "f".repeat(64) : randomUUID();
    await expect(context(s, values)).rejects.toMatchObject({ code: "42501" });
  });
  it("creates the receipt only by the finalizer RPC, replays without renewal and reads after COMMIT", async () => {
    const s = await setup();
    const receipt = await tx(async () => {
      await begin(s); expect((await role("parent_snap_finalizer", contextSql, contextArgs(s))).rows[0].value.state).toBe("authorized");
      await expect(role("parent_snap_finalizer", recordSql, tuple(s))).rejects.toMatchObject({ code: "42501" });
      expect(await row(s)).toBeUndefined(); await seal(s); expect((await role("parent_snap_finalizer", contextSql, contextArgs(s))).rows[0].value.state).toBe("stored");
      const first = (await role("parent_snap_finalizer", recordSql, tuple(s))).rows[0].value, before = await row(s);
      expect((await role("parent_snap_finalizer", recordSql, tuple(s))).rows[0].value).toEqual(first);
      expect((await role("parent_snap_finalizer", readSql, tuple(s))).rows[0].value).toEqual(first); expect(await row(s)).toEqual(before); return first;
    });
    expect(receipt).toMatchObject({ packetId: s.packet, snapshotId: s.snapshot, snapshotHash: s.snapshotHash, contentSha256: contentHash, validatorVersion: version, requiredPersonalActs: acts });
    expect(Object.keys(receipt).sort()).toEqual(["contentSha256", "expiresAt", "packetId", "requiredPersonalActs", "snapshotHash", "snapshotId", "source", "validatorVersion", "verificationId", "verifiedAt"]);
    expect(JSON.stringify(receipt)).not.toMatch(/keyBase64|ciphertext|firstName|identityOrSignatureVerified|submissionReady/);
    expect((await read(s)).rows[0].value).toEqual(receipt);
    expect((await context(s)).rows[0].value.state).toBe("stored");
    await expect(call("parent_snap_finalizer", recordSql, tuple(s))).rejects.toMatchObject({ code: "42501" });
    expect((await read(s)).rows[0].value).toEqual(receipt);
    await expect(fixture.admin.query("update parent_private.snap_final_packet_verifications set verified_at=clock_timestamp() where packet_id=$1", [s.packet])).rejects.toMatchObject({ code: "23514" });
  });
  it("rolls packet, fake Vault key and real construction receipt back together", async () => {
    const s = await setup(), before = await counts();
    await expect(tx(async () => { await begin(s); await seal(s); await role("parent_snap_finalizer", recordSql, tuple(s)); expect(await row(s)).toBeDefined(); throw new Error("synthetic interruption"); })).rejects.toThrow("synthetic interruption");
    expect(await counts()).toEqual(before); await expect(read(s)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["revocation", "permission", "closure"])("rechecks %s after seal before writing in the same creation transaction", async event => {
    const s = await setup(), before = await counts();
    await expect(tx(async () => {
      await begin(s); await seal(s);
      if (event === "revocation") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.authorization]);
      if (event === "permission") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{allowedData}','[\"household\"]') where id=$1", [s.request]);
      if (event === "closure") await fixture.admin.query("update parent_private.processing_controls set snap_protected_enabled=false");
      await expect(role("parent_snap_finalizer", recordSql, tuple(s))).rejects.toMatchObject({ code: "42501" }); expect(await row(s)).toBeUndefined();
      throw new Error("synthetic rollback after denied writer");
    })).rejects.toThrow("synthetic rollback after denied writer");
    expect(await counts()).toEqual(before);
  });
  it("does not infer non-delivery or recreate work when exact reconciliation evidence is missing", async () => {
    const s = await setup(), before = await counts();
    await expect(read(s)).rejects.toMatchObject({ code: "42501" }); expect(await counts()).toEqual(before);
    await stage(s, false); await expect(read(s)).rejects.toMatchObject({ code: "42501" }); expect(await row(s)).toBeUndefined();
    await expect(call("parent_snap_finalizer", recordSql, tuple(s))).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["packet", "request", "version", "authorization"])("requires exact stored %s for both record and reconciliation", async field => {
    const s = await setup(); await stage(s); const values = tuple(s), index = ["packet", "request", "version", "authorization"].indexOf(field);
    values[index] = field === "version" ? s.version + 1 : randomUUID();
    for (const sql of [recordSql, readSql]) await expect(call("parent_snap_finalizer", sql, values)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker"])("denies all three private RPCs to %s", async actor => {
    const s = await setup(); await stage(s);
    const grants = (await fixture.admin.query("select has_function_privilege($1,p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='parent_private' and p.proname=any($2::text[])", [actor, ["parent_get_snap_direct_context", "parent_record_snap_direct_construction", "parent_read_snap_direct_construction"]])).rows;
    expect(grants).toHaveLength(3); expect(grants.every(value => value.allowed === false)).toBe(true);
    for (const [sql, values] of [[contextSql, contextArgs(s)], [recordSql, tuple(s)], [readSql, tuple(s)]] as const)
      await expect(call(actor, sql, [...values], s.owner)).rejects.toMatchObject({ code: "42501" });
  });
  it("has no PUBLIC execute grant and grants only the isolated role among ordinary actors", async () => {
    const functions = (await fixture.admin.query("select p.oid,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='parent_private' and p.proname=any($1::text[])", [["parent_get_snap_direct_context", "parent_record_snap_direct_construction", "parent_read_snap_direct_construction"]])).rows;
    expect(functions).toHaveLength(3);
    for (const fn of functions) {
      expect((await fixture.admin.query("select exists(select 1 from aclexplode($1::aclitem[]) where grantee=0 and privilege_type='EXECUTE') allowed", [fn.proacl])).rows[0].allowed).toBe(false);
      expect((await fixture.admin.query("select has_function_privilege('parent_snap_finalizer',$1::oid,'EXECUTE') allowed", [fn.oid])).rows[0].allowed).toBe(true);
    }
  });
  it("keeps raw verification/key tables inaccessible even to the finalizer", async () => {
    for (const table of ["parent_private.snap_final_packet_verifications", "parent_private.snap_final_packets", "vault.decrypted_secrets"])
      await expect(call("parent_snap_finalizer", `select * from ${table}`)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["correction", "revocation", "cancel", "prepare_permission", "income_permission", "account_closed", "processing_closed", "details_closed", "protected_closed", "policy_changed"])("stops construction context and reconciliation after %s", async event => {
    const s = await setup(); await stage(s);
    if (event === "correction") await call("authenticated", "select public.parent_save_snap_application_details($1,$2,$3,$4,$5)", [s.request, s.version, JSON.stringify({ ...fixtureSnapApplication(new Date()), bestTimeToCall: "Evenings" }), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    if (event === "revocation") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.authorization]);
    if (event === "cancel") await call("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    if (event === "prepare_permission") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{allowedActions}','[\"research\",\"submit\"]') where id=$1", [s.request]);
    if (event === "income_permission") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{allowedData}','[\"household\"]') where id=$1", [s.request]);
    if (event === "account_closed") await fixture.admin.query("update public.parent_accounts set status='disabled' where id=$1", [s.owner]);
    if (event.endsWith("closed") && event !== "account_closed") await fixture.admin.query(`update parent_private.processing_controls set ${event === "processing_closed" ? "enabled" : event === "details_closed" ? "snap_details_enabled" : "snap_protected_enabled"}=false`);
    if (event === "policy_changed") await fixture.admin.query("update parent_private.processing_controls set snap_protected_policy_version='different-policy'");
    await expect(context(s)).rejects.toMatchObject({ code: "42501" }); await expect(read(s)).rejects.toMatchObject({ code: "42501" });
  });
  it("uses wall-clock expiry even in an earlier transaction without renewing evidence", async () => {
    const s = await setup(1); await stage(s); const before = await row(s);
    await tx(async () => { await delay(1100); await expect(role("parent_snap_finalizer", contextSql, contextArgs(s))).rejects.toMatchObject({ code: "42501" }); await expect(role("parent_snap_finalizer", readSql, tuple(s))).rejects.toMatchObject({ code: "42501" }); });
    expect(await row(s)).toEqual(before);
  });
  it("derives ownership from the actual request rather than a forged authorization owner", async () => {
    const s = await setup(), other = await setup(), authorization = randomUUID(), packet = randomUUID();
    const original = (await fixture.admin.query("select to_jsonb(a) value from parent_private.snap_final_packet_authorizations a where id=$1", [s.authorization])).rows[0].value;
    await fixture.admin.query("delete from parent_private.snap_final_packet_authorizations where id=$1", [s.authorization]);
    await fixture.admin.query("insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,$1::jsonb)).*", [JSON.stringify({ ...original, id: authorization, packet_id: packet, owner_id: other.owner })]);
    await expect(context({ ...s, authorization, packet })).rejects.toMatchObject({ code: "42501" });
    await expect(discover(s)).rejects.toMatchObject({ code: "42501" }); await expect(capture(s)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["content_sha256", "snapshot_hash", "source", "validator_version", "required_personal_acts", "early_verified_at", "future_verified_at", "expires_at"])("rejects a forged mismatched construction receipt %s", async field => {
    const s = await setup(); await stage(s); const original = await row(s), forged = { ...original };
    if (field === "content_sha256" || field === "snapshot_hash") forged[field] = "f".repeat(64);
    if (field === "source") forged.source = {};
    if (field === "validator_version") forged.validator_version = "pa600fs-final-content-2026-11-04.v1";
    if (field === "required_personal_acts") forged.required_personal_acts = [...acts, "synthetic_other_actor"];
    if (field === "early_verified_at") forged.verified_at = new Date(Date.now() - 10000).toISOString();
    if (field === "future_verified_at") forged.verified_at = new Date(Date.now() + 10000).toISOString();
    if (field === "expires_at") forged.expires_at = new Date(Date.now() + 20000).toISOString();
    // Deliberate privileged corruption fixture only; successful receipts above are never inserted by the test.
    await fixture.admin.query("delete from parent_private.snap_final_packet_verifications where packet_id=$1", [s.packet]);
    await fixture.admin.query("insert into parent_private.snap_final_packet_verifications select (jsonb_populate_record(null::parent_private.snap_final_packet_verifications,$1::jsonb)).*", [JSON.stringify(forged)]);
    await expect(read(s)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["noncitizen", "representative", "household_continuation", "income_continuation"])("does not write construction evidence for the unresolved %s route", async route => {
    const details = fixtureSnapApplication(new Date());
    if (route === "noncitizen") details.household![0].citizen = false;
    if (route === "representative") details.authorizedRepresentative = { name: "Synthetic Representative" };
    if (route === "household_continuation") { details.household = Array.from({ length: 9 }, (_, i) => ({ ...details.household![0], id: randomUUID(), relationship: i ? "OTHER" : "SELF" })); details.householdSize = 9; }
    if (route === "income_continuation") details.income = { month: new Date().toISOString().slice(0, 7), hasIncome: true, entries: Array.from({ length: 6 }, () => ({ id: randomUUID(), personId: details.household![0].id, source: "Synthetic wages", amount: 1, frequency: "monthly" })) };
    const s = await setup(300, details, false), before = await counts();
    await expect(call("authenticated", "select public.parent_authorize_snap_direct_acquisition($1,$2,$3,$4,$5,'synthetic-policy-1','synthetic-retention-1',$6,true,date_trunc('milliseconds',clock_timestamp()+interval '4 minutes'))", [s.request, s.version, s.snapshot, s.snapshotHash, s.acquisition, details.household!.filter(person => person.requestingSnap).map(person => person.id)], s.owner)).rejects.toMatchObject({ code: "42501" });
    await expect(stage(s)).rejects.toMatchObject({ code: "42501" }); expect(await counts()).toEqual(before); expect(await row(s)).toBeUndefined();
  });
  it("cannot prepare a canonical direct operation without accepted-method evidence even with generic synthetic provider flags enabled", async () => {
    const s = await setup(), receipt = await stage(s);
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      values('snap-pa','submit',true,true,true,'synthetic-direct-test','fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',$1,now()+interval '1 hour')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until`, [acts]);
    await fixture.admin.query("update parent_private.provider_capabilities set snap_direct_completion_version=null,snap_direct_completion_evidence_reference=null where program_id='snap-pa' and action='submit'");
    await expect(call("parent_snap_finalizer", "select parent_private.parent_prepare_snap_final_operation($1,$2,$3,$4,$5)", [...tuple(s), receipt.verificationId])).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select operation_id from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0].operation_id).toBeNull();
    for (const table of ["parent_operations", "parent_receipts"]) expect((await fixture.admin.query(`select 1 from public.${table} where request_id=$1`, [s.request])).rows).toEqual([]);
    expect((await fixture.admin.query("select 1 from parent_private.personal_act_evidence e join public.parent_operations o on o.id=e.operation_id where o.request_id=$1", [s.request])).rows).toEqual([]);
  });
  it.each(["duration", "planning", "details", "protected", "root_revocation"] as const)("purges an unattempted linked packet and fake Vault key after its %s bound closes, with processing disabled", async boundary => {
    const s = await setup(); await stage(s);
    const packet = (await fixture.admin.query("select vault_secret_id,expires_at from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0];
    expect(new Date(packet.expires_at).getTime()).toBeGreaterThan(Date.now() + 10000);
    if (boundary === "duration") {
      await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=1"); await delay(1100);
    } else if (boundary === "root_revocation") {
      // Deliberate root-only fixture; ordinary withdrawal also revokes its linked child.
      await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.acquisition]);
    } else {
      const column = { planning: "approved_until", details: "snap_details_approved_until", protected: "snap_protected_approved_until" }[boundary]!;
      await fixture.admin.query(`update parent_private.processing_controls set ${column}=clock_timestamp()-interval '1 second'`);
    }
    await fixture.admin.query("update parent_private.processing_controls set enabled=false,snap_details_enabled=false,snap_protected_enabled=false");
    const result = (await call("parent_retention_worker", "select parent_private.parent_purge_snap_final_packets(100) n")).rows[0].n as number;
    expect(result).toBeGreaterThan(0); expect(result).toBeLessThanOrEqual(100);
    expect((await fixture.admin.query("select 1 from parent_private.snap_final_packets where id=$1", [s.packet])).rows).toEqual([]);
    expect((await fixture.admin.query("select 1 from vault.secrets where id=$1", [packet.vault_secret_id])).rows).toEqual([]);
    expect(await row(s)).toBeUndefined();
  });
  it("preserves the attempted-evidence hold when a linked retention duration is shortened", async () => {
    const s = await setup(), receipt = await stage(s);
    const operation = (await call("parent_snap_finalizer", "select parent_private.parent_prepare_snap_final_operation($1,$2,$3,$4,$5) id", [...tuple(s), receipt.verificationId])).rows[0].id;
    // Synthetic attempted state only: no parent Submit, real signature, provider action or agency receipt.
    await fixture.admin.query("update public.parent_operations set executed_at=clock_timestamp(),state='delivery_unknown' where id=$1", [operation]);
    const before = await row(s), packet = (await fixture.admin.query("select vault_secret_id,expires_at from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0];
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=1,enabled=false,snap_details_enabled=false,snap_protected_enabled=false"); await delay(1100);
    await call("parent_retention_worker", "select parent_private.parent_purge_snap_final_packets(100)");
    expect((await fixture.admin.query("select vault_secret_id,expires_at from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0]).toEqual(packet);
    expect((await fixture.admin.query("select 1 from vault.secrets where id=$1", [packet.vault_secret_id])).rows).toHaveLength(1);
    expect(await row(s)).toEqual(before);
  });
  it("does not apply a linked-only shortened bound to an unlinked legacy binary packet", async () => {
    const s = await setup(300, fixtureSnapApplication(new Date()), false); await stage(s, false);
    const packet = (await fixture.admin.query("select vault_secret_id,expires_at from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0];
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=1,enabled=false,snap_details_enabled=false,snap_protected_enabled=false"); await delay(1100);
    await call("parent_retention_worker", "select parent_private.parent_purge_snap_final_packets(100)");
    expect((await fixture.admin.query("select vault_secret_id,expires_at from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0]).toEqual(packet);
    expect((await fixture.admin.query("select 1 from vault.secrets where id=$1", [packet.vault_secret_id])).rows).toHaveLength(1);
  });
});
