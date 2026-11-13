import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const payload = Buffer.from("SYNTHETIC_NONPDF_SQL_QUEUE_FIXTURE"), digest = createHash("sha256").update(payload).digest("hex");
type Scope = { owner: string; session: string; request: string; version: number; snapshot: string; hash: string; packet: string; authorization: string; job: string };
describe.skipIf(!modulePath)("durable exact SNAP capture on existing jobs (explicit fake Vault)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    for (const statement of ["create schema vault", "create schema extensions",
      "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
      "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$"])
      await fixture.admin.query(statement);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  const q = async (sql: string, values: unknown[] = []) => (await fixture.admin.query(sql, values)).rows;
  async function tx<T>(work: () => Promise<T>) {
    await q("begin"); try { const value = await work(); await q("commit"); return value; } catch (error) { await q("rollback"); throw error; }
  }
  async function role(name: string, sql: string, values: unknown[] = [], scope?: Scope) {
    await q(`set local role ${name}`);
    await q("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: name, sub: scope?.owner, session_id: scope?.session, amr: [{ method: "otp" }] })]);
    const value = await q(sql, values); await q("reset role"); return value;
  }
  async function setup(): Promise<Scope> {
    // Explicit synthetic legacy route, independent of the default-disabled provider capabilities.
    await q(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      values('snap-pa','submit',true,true,true,'synthetic-pending-route','synthetic route fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',array['applicant_signature_printed_page_1','rights_certification_printed_page_5'],clock_timestamp()+interval '1 hour')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,permission_reference=excluded.permission_reference,
        allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until`);
    await q(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic queue only',approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1,
      snap_protected_enabled=true,snap_protected_approval_reference='synthetic only',snap_protected_approved_until=now()+interval '1 day',
      snap_protected_policy_version='synthetic-policy',snap_protected_retention_policy_version='synthetic-retention',snap_protected_max_retention_seconds=3600`, [SNAP_APPLICATION_NOTICE_VERSION]);
    const s = { owner: randomUUID(), session: randomUUID(), packet: randomUUID() } as Scope;
    await q("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [s.owner, `${s.owner}@example.invalid`]);
    await q("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [s.session, s.owner]);
    s.request = (await tx(() => role("authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })), JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: new Date(Date.now() + 86400000).toISOString() })), randomUUID()], s)))[0].id as string;
    s.snapshot = (await tx(() => role("authenticated", "select public.parent_save_snap_application_details($1,1,$2,$3,$4) id", [s.request, JSON.stringify(fixtureSnapApplication(new Date())), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s)))[0].id as string;
    const j = (await q("select id,request_version from public.parent_jobs where request_id=$1", [s.request]))[0]; s.job = j.id as string; s.version = j.request_version as number;
    s.hash = ((await q("select parent_private.snap_application_binding($1,$2,$3) b", [s.request, s.version, s.snapshot]))[0].b as { snapshotHash: string }).snapshotHash;
    await authorize(s); return s;
  }
  async function authorize(s: Scope) {
    const result = (await tx(() => role("authenticated", "select public.parent_authorize_snap_final_packet($1,$2,$3,$4,$5,$6,$7,'synthetic-policy','synthetic-retention',$8,true) a", [s.request, s.version, s.snapshot, s.hash, s.packet, digest, payload.length, fixtureSnapApplication().household!.map(p => p.id)], s)))[0].a as { intent: { authorizationId: string } };
    s.authorization = result.intent.authorizationId;
  }
  async function stage(s: Scope) {
    return tx(async () => {
      await role("parent_snap_finalizer", "select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8)", [s.authorization, s.request, s.version, s.snapshot, s.hash, digest, payload.length, s.packet]);
      await role("parent_snap_finalizer", "select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,$5,$6,$7)", [s.packet, s.request, s.version, s.authorization, Buffer.alloc(12), Buffer.alloc(16), Buffer.alloc(payload.length)]);
    });
  }
  const job = async (s: Scope) => (await q("select * from public.parent_jobs where id=$1", [s.job]))[0];
  async function lease(s: Scope) {
    const token = randomUUID(); await q("update public.parent_jobs set state='leased',lease_token=$2,lease_until=clock_timestamp()+interval '5 minutes',lease_started_at=clock_timestamp(),attempts=attempts+1 where id=$1", [s.job, token]); return token;
  }
  async function pending(s: Scope, token: string, actor = "parent_worker") { return (await tx(() => role(actor, "select parent_private.parent_get_snap_pending_capture($1,$2) value", [s.job, token])))[0].value as { packetId: string; state: string; intent: { packetId: string; contentSha256: string; byteLength: number } | null; deadline: string }; }
  async function result(s: Scope, token: string, state: string | null, reason: string | null, actor = "parent_snap_finalizer") { return tx(() => role(actor, "select parent_private.parent_record_snap_capture_result($1,$2,$3,$4,$5)", [s.job, token, s.packet, state, reason])); }

  it("publishes the exact chosen pointer and wake in the same encrypted seal transaction", async () => {
    const s = await setup(); await q("update public.parent_jobs set state='waiting',run_at='infinity' where id=$1", [s.job]); await stage(s);
    const stored = await job(s); expect(stored).toMatchObject({ state: "queued", snap_packet_id: s.packet, snap_capture_state: "pending", snap_capture_reason: null });
    expect(Date.parse(stored.run_at as string)).toBeLessThanOrEqual(Date.now());
    const value = await pending(s, await lease(s)); expect(value).toMatchObject({ packetId: s.packet, state: "pending", intent: { packetId: s.packet, contentSha256: digest, byteLength: payload.length } });
    expect(JSON.stringify(value)).not.toMatch(/keyBase64|ciphertext|Private Canary|Synthetic Street|leaseToken/);
    expect(Date.parse(value.deadline)).toBeGreaterThan(Date.now());
  });
  it("rolls pointer, key and packet back when sealing cannot finish", async () => {
    const s = await setup(); await q("update public.parent_jobs set attempts=48 where id=$1", [s.job]);
    await expect(stage(s)).rejects.toMatchObject({ code: "42501" });
    expect((await job(s)).snap_packet_id).toBeNull(); expect(await q("select 1 from parent_private.snap_final_packets where id=$1", [s.packet])).toHaveLength(0);
  });
  it("never substitutes a second authorized file at the same version, even after raw-byte purge", async () => {
    const s = await setup(); await stage(s); const original = s.packet;
    const next = { ...s, packet: randomUUID() }; await authorize(next); await expect(stage(next)).rejects.toMatchObject({ code: "23514" });
    await q("delete from parent_private.snap_final_packets where id=$1", [original]);
    await expect(stage(next)).rejects.toMatchObject({ code: "23514" }); expect((await job(s)).snap_packet_id).toBe(original);
    expect(await pending(s, await lease(s))).toMatchObject({ packetId: original, state: "unavailable", intent: null });
  });
  it.each(["waiting", "failed", "done"])("retains a late capture through the exact old lease's %s transition once", async state => {
    const s = await setup(), token = await lease(s); await stage(s);
    expect(await job(s)).toMatchObject({ state: "leased", lease_token: token, snap_capture_wake_lease_token: token });
    await q("update public.parent_jobs set state=$2,lease_token=null,lease_until=null where id=$1", [s.job, state]);
    expect(await job(s)).toMatchObject({ state: "queued", snap_capture_wake_lease_token: null });
    await lease(s); await q("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null where id=$1", [s.job]);
    expect((await job(s)).state).toBe("waiting");
  });
  it.each(["different_lease", "new_version", "budget", "purpose", "unknown"])("does not spin or resume a %s boundary", async kind => {
    const s = await setup(); await lease(s); await stage(s);
    if (kind === "different_lease") await q("update public.parent_jobs set snap_capture_wake_lease_token=$2 where id=$1", [s.job, randomUUID()]);
    if (kind === "new_version") await q("update public.parent_jobs set request_version=request_version+1 where id=$1", [s.job]);
    if (kind === "budget") await q("update public.parent_jobs set attempts=48 where id=$1", [s.job]);
    if (kind === "purpose") await q("update parent_private.processing_controls set snap_protected_enabled=false");
    if (kind === "unknown") await q("update public.parent_jobs set last_error='delivery_unknown' where id=$1", [s.job]);
    await q("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null where id=$1", [s.job]);
    expect((await job(s)).state).toBe("waiting"); if (kind === "new_version") expect((await job(s)).snap_packet_id).toBeNull();
  });
  it.each(["parent_worker", "authenticated", "anon", "service_role"])("does not let %s manufacture check outcomes", async actor => {
    const s = await setup(); await stage(s); await expect(result(s, await lease(s), "needs_parent", "page_1_unreadable", actor)).rejects.toMatchObject({ code: "42501" });
  });
  it("cannot manufacture a checked receipt from structurally stored bytes", async () => {
    const s = await setup(); await stage(s); await expect(result(s, await lease(s), "checked", null)).rejects.toMatchObject({ code: "42501" });
  });
  it("records checked only after an explicit synthetic trusted receipt and canonical binding, then preserves it exactly", async () => {
    const s = await setup(); await stage(s); const token = await lease(s);
    const acts = ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"];
    await q(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      values('snap-pa','submit',true,true,true,'synthetic-queue','fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',$1,now()+interval '1 hour')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until`, [acts]);
    // Explicit fixture metadata only: no PDF content, identity or handwriting was verified by this SQL test.
    const verification = (await q(`insert into parent_private.snap_final_packet_verifications(packet_id,snapshot_id,snapshot_hash,content_sha256,validator_version,source,baseline_certification_regions,required_personal_acts,expires_at)
      select $1,id,$2,$3,'pa600fs-final-content-2026-11-04.v1',source,$4,$4,clock_timestamp()+interval '1 minute' from public.parent_snap_application_details where id=$5 returning id`, [s.packet, s.hash, digest, acts, s.snapshot]))[0].id;
    await tx(() => role("parent_snap_finalizer", "select parent_private.parent_prepare_snap_final_operation($1,$2,$3,$4,$5)", [s.packet, s.request, s.version, s.authorization, verification]));
    await result(s, token, "checked", null); const saved = await job(s);
    expect(saved).toMatchObject({ state: "leased", lease_token: token, snap_capture_state: "checked", snap_capture_reason: null, snap_capture_wake_lease_token: null });
    await result(s, token, "checked", null); expect(await job(s)).toEqual(saved);
    expect(await q("select 1 from public.parent_events where request_id=$1 and kind='snap_application.private_check'", [s.request])).toHaveLength(1);
    await expect(result(s, token, "needs_parent", "page_1_unreadable")).rejects.toMatchObject({ code: "23514" });
    expect(await job(s)).toEqual(saved);
  });
  it.each([[null, null], ["needs_parent", null], ["needs_parent", "check_unavailable"], ["service_unavailable", "page_1_unreadable"], ["checked", "PRIVATE-CANARY"]])("rejects malformed check metadata %j without persisting it", async (state, reason) => {
    const s = await setup(); await stage(s); await expect(result(s, await lease(s), state, reason)).rejects.toMatchObject({ code: "23514" }); expect((await job(s)).snap_capture_state).toBe("pending");
  });
  it("persists only a narrow personal recovery reason and consumes the lease wake without clearing its live lease", async () => {
    const s = await setup(), token = await lease(s); await stage(s); await result(s, token, "needs_parent", "page_1_unreadable");
    expect(await job(s)).toMatchObject({ state: "leased", lease_token: token, snap_capture_state: "needs_parent", snap_capture_reason: "page_1_unreadable", snap_capture_wake_lease_token: null });
    await q("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null where id=$1", [s.job]); expect((await job(s)).state).toBe("waiting");
  });
  it("rechecks lease, purpose and exact packet before exposing metadata or recording a result", async () => {
    const s = await setup(); await stage(s); const token = await lease(s);
    await expect(pending(s, randomUUID())).rejects.toMatchObject({ code: "42501" });
    await expect(result({ ...s, packet: randomUUID() }, token, "needs_parent", "page_1_unreadable")).rejects.toMatchObject({ code: "42501" });
    await q("update parent_private.processing_controls set snap_protected_enabled=false");
    expect(await pending(s, token)).toMatchObject({ packetId: s.packet, state: "unavailable", intent: null });
    await expect(result(s, token, "needs_parent", "page_1_unreadable")).rejects.toMatchObject({ code: "42501" });
  });
  it("recovers the exact chosen pointer as the owner after the page closes, without choosing another intent", async () => {
    const s = await setup(); await stage(s);
    const saved = (await tx(() => role("authenticated", "select public.parent_get_snap_current_capture($1,$2) value", [s.request, s.version], s)))[0].value;
    expect(saved).toEqual({ packetId: s.packet, requestVersion: s.version, state: "pending", reason: null });
    const other = await setup(); await expect(tx(() => role("authenticated", "select public.parent_get_snap_current_capture($1,$2)", [s.request, s.version], other))).rejects.toMatchObject({ code: "42501" });
  });
  it("replaces only after a recorded version correction and reuses every original answer and evidence date", async () => {
    const s = await setup(); await stage(s);
    const original = (await q("select intake,facts,mandate from public.parent_requests where id=$1", [s.request]))[0];
    const snapshot = (await q("select to_jsonb(s) value from public.parent_snap_application_details s where id=$1", [s.snapshot]))[0].value;
    const replace = () => tx(() => role("authenticated", "select public.parent_replace_snap_personal_pages($1,$2,$3) version", [s.request, s.version, s.packet], s));
    expect((await replace())[0].version).toBe(s.version + 1);
    const after = await job(s); expect(after).toMatchObject({ request_version: s.version + 1, snap_packet_id: null, snap_capture_state: null, state: "queued" });
    expect((await replace())[0].version).toBe(s.version + 1); expect(await job(s)).toEqual(after);
    expect((await q("select intake,facts,mandate from public.parent_requests where id=$1", [s.request]))[0]).toEqual(original);
    expect((await q("select to_jsonb(s) value from public.parent_snap_application_details s where id=$1", [s.snapshot]))[0].value).toEqual(snapshot);
    await expect(tx(() => role("authenticated", "select public.parent_get_snap_final_packet_authorization($1,$2,$3)", [s.request, s.packet, s.version], s))).rejects.toMatchObject({ code: "42501" });
    const next = { ...s, version: s.version + 1, packet: randomUUID() }; await authorize(next); await stage(next);
    expect((await job(s)).snap_packet_id).toBe(next.packet);
    expect(await q("select 1 from public.parent_events where request_id=$1 and kind='snap_application.personal_pages_replaced'", [s.request])).toHaveLength(1);
  });
  it("cannot turn an attempted or uncertain initial filing into a replacement application", async () => {
    const s = await setup(); await stage(s);
    await q(`insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,idempotency_key,permission_version,executed_at)
      values($1,$2,'snap_new','snap-pa','submit','{"zip":"19104"}',encode(sha256(convert_to('{"zip": "19104"}','UTF8')),'hex'),array['household'],$3,'synthetic-attempt',clock_timestamp())`, [s.request, s.version, randomUUID()]);
    await expect(tx(() => role("authenticated", "select public.parent_replace_snap_personal_pages($1,$2,$3)", [s.request, s.version, s.packet], s))).rejects.toMatchObject({ code: "23514" });
    expect((await job(s)).snap_packet_id).toBe(s.packet);
  });
  it("rejects a foreign or stale replacement without changing current work", async () => {
    const s = await setup(); await stage(s); const other = await setup();
    await expect(tx(() => role("authenticated", "select public.parent_replace_snap_personal_pages($1,$2,$3)", [s.request, s.version, s.packet], other))).rejects.toMatchObject({ code: "42501" });
    await expect(tx(() => role("authenticated", "select public.parent_replace_snap_personal_pages($1,$2,$3)", [s.request, s.version, randomUUID()], s))).rejects.toMatchObject({ code: "40001" });
    await expect(tx(() => role("authenticated", "select public.parent_replace_snap_personal_pages($1,$2,$3)", [s.request, 2147483647, s.packet], s))).rejects.toMatchObject({ code: "23514" });
    expect((await job(s)).snap_packet_id).toBe(s.packet);
  });
  it.each(["read", "replace"])("rechecks an expired personal session against the wall clock before a %s", async action => {
    const s = await setup(); await stage(s); const before = await job(s);
    await expect(tx(async () => {
      await q("update auth.sessions set not_after=now()+interval '10 milliseconds' where id=$1", [s.session]);
      await new Promise(resolve => setTimeout(resolve, 30));
      expect((await q("select now()<not_after transaction_current,clock_timestamp()>not_after actually_expired from auth.sessions where id=$1", [s.session]))[0]).toEqual({ transaction_current: true, actually_expired: true });
      return role("authenticated", action === "read" ? "select public.parent_get_snap_current_capture($1,$2)" : "select public.parent_replace_snap_personal_pages($1,$2,$3)", action === "read" ? [s.request, s.version] : [s.request, s.version, s.packet], s);
    })).rejects.toMatchObject({ code: "42501" });
    expect(await job(s)).toEqual(before);
  });
});
