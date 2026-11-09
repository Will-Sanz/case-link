import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
type Scope = { owner: string; request: string; version: number; snapshot: string; snapshotHash: string; packet: string; authorization: string; verification?: string };
const contentHash = createHash("sha256").update("SYNTHETIC_NONPDF_SQL_METADATA_ONLY").digest("hex");
const personalRegions = ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"];

describe.skipIf(!modulePath)("protected SNAP canonical operation binding SQL (synthetic verifier and Vault only)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    for (const sql of ["create schema vault", "create schema extensions", "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
      "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$",
      "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$"]) await fixture.admin.query(sql);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function tx<T>(fn: () => Promise<T>) {
    await fixture.admin.query("begin");
    try { const result = await fn(); await fixture.admin.query("commit"); return result; }
    catch (error) { await fixture.admin.query("rollback"); throw error; }
  }
  async function role(actor: string, sql: string, values: unknown[] = [], user?: string) {
    return tx(async () => {
      await fixture.admin.query(`set local role ${actor}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: actor, sub: user, session_id: user && sessions.get(user), amr: [{ method: "otp" }] })]);
      return fixture.admin.query(sql, values);
    });
  }
  async function candidate(scope: Omit<Scope, "packet" | "authorization" | "verification">): Promise<Scope> {
    const packet = randomUUID();
    const result = (await role("authenticated", "select public.parent_authorize_snap_final_packet($1,$2,$3,$4,$5,$6,11,'synthetic-policy-1','synthetic-retention-1',$7,true) value", [scope.request, scope.version, scope.snapshot, scope.snapshotHash, packet, contentHash, [fixtureSnapApplication().household![0].id]], scope.owner)).rows[0].value as { intent: { authorizationId: string } };
    const authorization = result.intent.authorizationId;
    await tx(async () => {
      await fixture.admin.query("set local role parent_snap_finalizer");
      await fixture.admin.query("select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,11,$7)", [authorization, scope.request, scope.version, scope.snapshot, scope.snapshotHash, contentHash, packet]);
      await fixture.admin.query("select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,decode(repeat('ab',12),'hex'),decode(repeat('ab',16),'hex'),decode(repeat('ab',11),'hex'))", [packet, scope.request, scope.version, authorization]);
    });
    return { ...scope, packet, authorization };
  }
  async function setup(verified = true, retentionSeconds = 300): Promise<Scope> {
    const owner = randomUUID(), session = randomUUID(); sessions.set(owner, session);
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic binding SQL only',approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1,
      snap_protected_enabled=true,snap_protected_approval_reference='synthetic only; no actual policy',snap_protected_approved_until=now()+interval '1 day',
      snap_protected_policy_version='synthetic-policy-1',snap_protected_retention_policy_version='synthetic-retention-1',snap_protected_max_retention_seconds=300`, [SNAP_APPLICATION_NOTICE_VERSION]);
    if (retentionSeconds !== 300) await fixture.admin.query(`update parent_private.processing_controls set approved_until=now()+interval '3 days',snap_details_approved_until=now()+interval '3 days',
      snap_protected_approved_until=now()+interval '3 days',snap_protected_max_retention_seconds=$1`, [retentionSeconds]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    const request = (await role("authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })), JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"],
      ...(retentionSeconds !== 300 ? { expiresAt: new Date(Date.now() + 3 * 86400000).toISOString() } : {}),
    })), randomUUID()], owner)).rows[0].id as string;
    const snapshot = (await role("authenticated", "select public.parent_save_snap_application_details($1,1,$2,$3,$4) id", [request, JSON.stringify(fixtureSnapApplication(new Date())), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], owner)).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [request])).rows[0].version as number;
    const snapshotHash = (await fixture.admin.query("select parent_private.snap_application_binding($1,$2)->>'snapshotHash' hash", [request, version])).rows[0].hash as string;
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      values('snap-pa','submit',true,true,true,'synthetic-protected-binding','fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',$1,now()+interval '1 hour')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until`, [personalRegions]);
    const scope = await candidate({ owner, request, snapshot, snapshotHash, version });
    if (verified) scope.verification = await receipt(scope);
    return scope;
  }
  // Explicit fixture receipt: this suite does not parse a PDF, verify answers or inspect handwriting.
  async function receipt(s: Scope, changes: Record<string, unknown> = {}) {
    const source = (await fixture.admin.query("select source from public.parent_snap_application_details where id=$1", [s.snapshot])).rows[0].source;
    return (await fixture.admin.query(`insert into parent_private.snap_final_packet_verifications
      select (jsonb_populate_record(null::parent_private.snap_final_packet_verifications,$1::jsonb)).* returning id`, [JSON.stringify({ id: randomUUID(), packet_id: s.packet, snapshot_id: s.snapshot, snapshot_hash: s.snapshotHash,
        content_sha256: contentHash, validator_version: "pa600fs-final-content-2026-11-04.v1", source, baseline_certification_regions: personalRegions, required_personal_acts: personalRegions,
        verified_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(), ...changes })])).rows[0].id as string;
  }
  const prepare = (s: Scope, changes: Partial<Scope> = {}, actor = "parent_snap_finalizer") => {
    const v = { ...s, ...changes }; return role(actor, "select parent_private.parent_prepare_snap_final_operation($1,$2,$3,$4,$5) id", [v.packet, v.request, v.version, v.authorization, v.verification]);
  };
  const operation = async (s: Scope) => (await fixture.admin.query("select * from public.parent_operations where id=(select operation_id from parent_private.snap_final_packets where id=$1)", [s.packet])).rows[0];
  async function submit(s: Scope, acts: string[] | null = personalRegions, owner = s.owner, changes: Record<string, unknown> = {}) {
    const o = await operation(s), value = { request: s.request, operation: o.id, version: s.version, hash: o.packet_hash, packet: s.packet, content: contentHash, ...changes };
    return role("authenticated", "select public.parent_authorize_snap_protected_submission($1,$2,$3,$4,$5,$6,$7) id", [value.request, value.operation, value.version, value.hash, value.packet, value.content, acts], owner);
  }
  async function claim(s: Scope) {
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where request_id<>$1", [s.request]);
    const job = (await role("parent_worker", "select parent_private.parent_claim_job(300) value")).rows[0].value as { jobId: string; leaseToken: string; request: { id: string } };
    expect(job.request.id).toBe(s.request); return job;
  }
  const reports = async (s: Scope) => (await fixture.admin.query("select * from parent_private.personal_act_evidence where operation_id=(select operation_id from parent_private.snap_final_packets where id=$1) order by act", [s.packet])).rows;
  const submitted = async (s: Scope) => (await fixture.admin.query("select * from parent_private.snap_submission_authorizations where operation_id=(select operation_id from parent_private.snap_final_packets where id=$1)", [s.packet])).rows;
  async function personalComplete(s: Scope) { return (await fixture.admin.query("select parent_private.personal_acts_complete(o) complete from public.parent_operations o where id=(select operation_id from parent_private.snap_final_packets where id=$1)", [s.packet])).rows[0].complete; }

  it("does not turn stored or structurally valid state into a trusted completed application", async () => {
    const s = await setup(false); await expect(prepare(s)).rejects.toMatchObject({ code: "42501" }); expect(await operation(s)).toBeUndefined();
  });
  it("atomically binds one immutable metadata-only canonical operation with the existing packet hash", async () => {
    const s = await setup(), id = (await prepare(s)).rows[0].id, o = await operation(s);
    expect(o.id).toBe(id); expect(o.artifact_id).toBeNull(); expect(o.state).toBe("prepared"); expect(o.executed_at).toBeNull();
    expect(o.packet).toEqual({ protectedSnapPacket: { packetId: s.packet, authorizationId: s.authorization, snapshotId: s.snapshot, snapshotHash: s.snapshotHash, contentSha256: contentHash, byteLength: 11, verificationId: s.verification } });
    expect(o.packet_hash).toBe((await fixture.admin.query("select encode(sha256(convert_to(packet::text,'UTF8')),'hex') hash from public.parent_operations where id=$1", [id])).rows[0].hash);
    expect(o.authorization_snapshot).toMatchObject({ artifactId: null, requestVersion: s.version, action: "submit" });
    expect(JSON.stringify(o)).not.toMatch(/firstName|dateOfBirth|street|ciphertext|vault_secret|keyBase64/);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.personal_act_evidence where operation_id=$1", [id])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_submission_authorizations where operation_id=$1", [id])).rows[0].n).toBe(0);
  });
  it("does not offer an owner review before a trusted canonical operation exists", async () => {
    const s = await setup(false);
    expect((await role("authenticated", "select public.parent_get_snap_review($1,$2) value", [s.request, s.version], s.owner)).rows[0].value).toBeNull();
  });
  it("removes only superseded SNAP Submit actions when the real saved-answer route changes the version", async () => {
    const s = await setup(); await prepare(s);
    const stale = { id: "old-snap-review", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Old review", explanation: "Synthetic" };
    const retained = [{ ...stale, id: "utility-step", need: "electricity" }, { ...stale, id: "snap-question", reason: "missing_fact", field: "snap_application_details" }, { id: "legacy-step", need: "food_now", reason: "personal_step" }];
    await fixture.admin.query("update public.parent_requests set required_actions=$2 where id=$1", [s.request, JSON.stringify([stale, ...retained])]);
    await fixture.admin.query("update public.parent_requests set version=version where id=$1", [s.request]);
    expect((await fixture.admin.query("select required_actions from public.parent_requests where id=$1", [s.request])).rows[0].required_actions).toEqual([stale, ...retained]);
    const changed = { ...fixtureSnapApplication(new Date()), bestTimeToCall: "Evenings" };
    await role("authenticated", "select public.parent_save_snap_application_details($1,$2,$3,$4,$5)", [s.request, s.version, JSON.stringify(changed), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    const current = (await fixture.admin.query("select version,required_actions from public.parent_requests where id=$1", [s.request])).rows[0];
    expect(current.version).toBe(s.version + 1); expect(current.required_actions).toEqual(retained);
    expect((await fixture.admin.query("select snap_packet_id from public.parent_jobs where request_id=$1", [s.request])).rows[0].snap_packet_id).toBeNull();
  });
  it("provides the exact owning-parent review reference without renewing stored evidence", async () => {
    const s = await setup(), id = (await prepare(s)).rows[0].id, before = await operation(s);
    const get = () => role("authenticated", "select public.parent_get_snap_review($1,$2) value", [s.request, s.version], s.owner);
    const first = (await get()).rows[0].value;
    expect(first).toMatchObject({ operationId: id, requestId: s.request, requestVersion: s.version, state: "prepared", packet: before.packet,
      packetHash: before.packet_hash, protectedPacketCurrent: true, protectedParentSubmitReady: true, personalActsComplete: false, snapSubmissionAuthorized: false });
    expect(first).not.toHaveProperty("created_at");
    expect(JSON.stringify(first)).not.toMatch(/firstName|dateOfBirth|street|ciphertext|keyBase64|vault_secret|parent_reported/);
    expect((await get()).rows[0].value).toEqual(first); expect(await operation(s)).toEqual(before);
    await submit(s);
    expect((await get()).rows[0].value).toMatchObject({ operationId: id, state: "prepared", personalActsComplete: true, snapSubmissionAuthorized: true });
  });
  it.each(["anon", "service_role", "parent_worker", "parent_snap_finalizer"])("denies review metadata to %s", async actor => {
    const s = await setup(); await prepare(s);
    await expect(role(actor, "select public.parent_get_snap_review($1,$2)", [s.request, s.version], s.owner)).rejects.toMatchObject({ code: "42501" });
  });
  it("denies another household's exact review and an actually expired session in an older transaction", async () => {
    const s = await setup(); await prepare(s); const other = await setup();
    await expect(role("authenticated", "select public.parent_get_snap_review($1,$2)", [s.request, s.version], other.owner)).rejects.toMatchObject({ code: "42501" });
    await expect(tx(async () => {
      await fixture.admin.query("update auth.sessions set not_after=now()+interval '10 milliseconds' where id=$1", [sessions.get(s.owner)]);
      await new Promise(resolve => setTimeout(resolve, 30));
      await fixture.admin.query("set local role authenticated");
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: "authenticated", sub: s.owner, session_id: sessions.get(s.owner), amr: [{ method: "otp" }] })]);
      return fixture.admin.query("select public.parent_get_snap_review($1,$2)", [s.request, s.version]);
    })).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["cancel", "purpose", "wrong_version"])("denies review after %s without renewing private evidence", async kind => {
    const s = await setup(); await prepare(s);
    if (kind === "cancel") await role("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    if (kind === "purpose") await fixture.admin.query("update parent_private.processing_controls set snap_protected_enabled=false");
    await expect(role("authenticated", "select public.parent_get_snap_review($1,$2)", [s.request, s.version + (kind === "wrong_version" ? 1 : 0)], s.owner)).rejects.toMatchObject({ code: "42501" });
  });
  it("replays exact binding without refreshing its operation or creating another event", async () => {
    const s = await setup(), first = (await prepare(s)).rows[0].id, before = await operation(s);
    expect((await prepare(s)).rows[0].id).toBe(first); expect(await operation(s)).toEqual(before);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_events where request_id=$1 and kind='snap_application.prepared'", [s.request])).rows[0].n).toBe(1);
    expect((await role("parent_snap_finalizer", "select parent_private.parent_bind_snap_final_packet($1,$2,$3,$4,$5) id", [s.packet, s.request, s.version, s.authorization, first])).rows[0].id).toBe(first);
  });
  it("does not select a newer candidate or permit another canonical packet at the same version", async () => {
    const s = await setup(); await prepare(s);
    await expect(candidate(s)).rejects.toMatchObject({ code: "23514", message: "this version already has a chosen SNAP packet" });
    await fixture.admin.query("delete from parent_private.snap_final_packets where id=$1", [s.packet]);
    await expect(candidate(s)).rejects.toMatchObject({ code: "23514", message: "this version already has a chosen SNAP packet" });
  });
  it("does not prepare a parallel canonical filing beside a preexisting ordinary submission", async () => {
    const s = await setup();
    await fixture.admin.query(`insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,idempotency_key,permission_version)
      values($1,$2,'snap_new','snap-pa','submit','{"zip":"19104"}',encode(sha256(convert_to('{"zip": "19104"}','UTF8')),'hex'),array['household'],$3,'synthetic-protected-binding')`, [s.request, s.version, randomUUID()]);
    await expect(prepare(s)).rejects.toMatchObject({ code: "23514" }); expect(await operation(s)).toBeUndefined();
  });
  it.each(["request", "version", "authorization", "packet", "verification"] as const)("denies a mismatched %s without partial operation binding", async field => {
    const s = await setup(); await expect(prepare(s, { [field]: field === "version" ? s.version + 1 : randomUUID() })).rejects.toMatchObject({ code: "42501" }); expect(await operation(s)).toBeUndefined();
  });
  it.each(["source", "snapshot_hash", "content_sha256", "future", "expired", "excess_expiry"])("rejects a stale or mismatched verifier receipt: %s", async variant => {
    const s = await setup(false), changes = variant === "source" ? { source: {} } : variant === "snapshot_hash" ? { snapshot_hash: "f".repeat(64) } : variant === "content_sha256" ? { content_sha256: "f".repeat(64) }
      : variant === "future" ? { verified_at: new Date(Date.now() + 10000).toISOString() } : variant === "expired" ? { verified_at: new Date(Date.now() - 2000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() }
        : { expires_at: new Date(Date.now() + 600000).toISOString() };
    s.verification = await receipt(s, changes); await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["enabled=false", "transport_verified=false", "requires_form=false", "required_acts=null", "allowed_fields='{}'", "field_categories='{}'",
    `field_categories='{"protectedSnapPacket":"household"}'`, "allowed_fields=array['protectedSnapPacket']", "verified_until=now()-interval '1 second'"])("honors provider permission %s", async assignment => {
    const s = await setup(); await fixture.admin.query(`update parent_private.provider_capabilities set ${assignment} where program_id='snap-pa' and action='submit'`);
    await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["correction", "cancel", "revocation", "policy"])("denies old canonical uses after %s", async kind => {
    const s = await setup();
    if (kind === "correction") await fixture.admin.query("update public.parent_requests set version=version+1 where id=$1", [s.request]);
    if (kind === "cancel") await role("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    if (kind === "revocation") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.authorization]);
    if (kind === "policy") await fixture.admin.query("update parent_private.processing_controls set snap_protected_enabled=false");
    await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["attempts=48", "state='cancelled'", "last_error='delivery_unknown'"])("does not prepare stranded or uncertain work: %s", async assignment => {
    const s = await setup(); await fixture.admin.query(`update public.parent_jobs set ${assignment} where request_id=$1`, [s.request]); await expect(prepare(s)).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps protected execution closed until genuine Submit and denies the ordinary artifact entry", async () => {
    const s = await setup(), id = (await prepare(s)).rows[0].id, o = await operation(s);
    await expect(role("authenticated", "select public.parent_authorize_snap_submission($1,$2,$3,$4,$5,$6)", [s.request, id, s.version, o.packet_hash, s.packet, contentHash], s.owner)).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where request_id<>$1", [s.request]);
    const claimed = (await role("parent_worker", "select parent_private.parent_claim_job(300) value")).rows[0].value as { jobId: string; leaseToken: string; request: { id: string } };
    expect(claimed.request.id).toBe(s.request);
    await expect(role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [id, claimed.jobId, claimed.leaseToken])).rejects.toMatchObject({ code: "42501", message: "the parent must choose Submit for this exact SNAP application" });
    await fixture.admin.query("update parent_private.provider_capabilities set requires_form=false where program_id='snap-pa' and action='submit'");
    await expect(role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [id, claimed.jobId, claimed.leaseToken])).rejects.toMatchObject({ code: "42501", message: "operation no longer executable" });
  });
  it("keeps verification metadata immutable and rejects invented validator/region contracts", async () => {
    const s = await setup(); await expect(fixture.admin.query("update parent_private.snap_final_packet_verifications set content_sha256=repeat('f',64) where id=$1", [s.verification])).rejects.toMatchObject({ code: "23514" });
    const first = await setup(false); await expect(receipt(first, { validator_version: "structural-only" })).rejects.toMatchObject({ code: "23514" });
    await expect(receipt(first, { baseline_certification_regions: [] })).rejects.toMatchObject({ code: "23514" });
  });
  it("records actual prior parent certifications with one exact Submit, then returns only protected metadata at begin", async () => {
    const s = await setup(), id = (await prepare(s)).rows[0].id, job = await claim(s);
    expect(await personalComplete(s)).toBe(false); expect(await reports(s)).toEqual([]);
    const before = (await role("parent_worker", "select parent_private.parent_get_operations($1,$2) value", [job.jobId, job.leaseToken])).rows[0].value as Array<Record<string, unknown>>;
    expect(before.find(row => row.id === id)).toMatchObject({ protectedPacketCurrent: true, protectedParentSubmitReady: true, personalActsComplete: false, snapSubmissionAuthorized: false });
    expect((await submit(s)).rows[0].id).toBe(id);
    const acts = await reports(s); expect(acts).toHaveLength(2);
    expect(acts.map(e => e.act).sort()).toEqual(personalRegions);
    for (const act of acts) expect(act).toMatchObject({ attribution: "parent_reported", verified_by: s.owner, reference: `parent-submit:${id}`, protected_packet_id: s.packet, protected_content_sha256: contentHash });
    expect(await personalComplete(s)).toBe(true);
    const projection = (await role("parent_worker", "select parent_private.parent_get_operations($1,$2) value", [job.jobId, job.leaseToken])).rows[0].value as Array<{ id: string; personalActsComplete: boolean; snapSubmissionAuthorized: boolean }>;
    expect(projection.find(o => o.id === id)).toMatchObject({ protectedPacketCurrent: true, protectedParentSubmitReady: true, personalActsComplete: true, snapSubmissionAuthorized: true });
    const begun = (await role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3) value", [id, job.jobId, job.leaseToken])).rows[0].value as { artifact: null; protectedPacket: { packetId: string } };
    expect(begun.artifact).toBeNull(); expect(begun.protectedPacket.packetId).toBe(s.packet);
    expect(JSON.stringify(begun)).not.toMatch(/firstName|dateOfBirth|street|ciphertext|vault_secret|keyBase64|object_path/);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_receipts where operation_id=$1", [id])).rows[0].n).toBe(0);
  });
  it("replays exact Submit without renewing acts, authorization, queue timestamps or events", async () => {
    const s = await setup(); await prepare(s); await submit(s);
    const before = { acts: await reports(s), auth: await submitted(s), job: (await fixture.admin.query("select * from public.parent_jobs where request_id=$1", [s.request])).rows,
      events: (await fixture.admin.query("select * from public.parent_events where request_id=$1 order by id", [s.request])).rows };
    await submit(s, [...personalRegions].reverse());
    expect({ acts: await reports(s), auth: await submitted(s), job: (await fixture.admin.query("select * from public.parent_jobs where request_id=$1", [s.request])).rows,
      events: (await fixture.admin.query("select * from public.parent_events where request_id=$1 order by id", [s.request])).rows }).toEqual(before);
  });
  it("keeps genuine unchanged handwritten acts valid with their exact packet beyond 24 hours without another attestation", async () => {
    const s = await setup(false, 172800), expiry = (await fixture.admin.query("select expires_at from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0].expires_at as Date;
    s.verification = await receipt(s, { expires_at: expiry.toISOString() }); await prepare(s); await submit(s);
    const before = { reports: await reports(s), authorizations: await submitted(s), expiry };
    expect((await fixture.admin.query(`select count(*)::int count,bool_and(e.expires_at=p.expires_at and e.expires_at>clock_timestamp()+interval '25 hours') valid_after_overnight
      from parent_private.personal_act_evidence e join parent_private.snap_final_packets p on p.operation_id=e.operation_id where p.id=$1`, [s.packet])).rows[0]).toEqual({ count: 2, valid_after_overnight: true });
    expect(await personalComplete(s)).toBe(true); await submit(s);
    expect({ reports: await reports(s), authorizations: await submitted(s), expiry: (await fixture.admin.query("select expires_at from parent_private.snap_final_packets where id=$1", [s.packet])).rows[0].expires_at }).toEqual(before);
  });
  it.each([null, [], [personalRegions[0]], [...personalRegions, personalRegions[0]], [...personalRegions, "invented_signature"]].map(acts => ({ acts })))("does not infer or invent missing personal steps from $acts", async ({ acts }) => {
    const s = await setup(); await prepare(s); await expect(submit(s, acts)).rejects.toMatchObject({ code: "23514" });
    expect(await reports(s)).toEqual([]); expect(await submitted(s)).toEqual([]);
  });
  it("requires source-baseline acts independently of an empty provider required-acts array", async () => {
    const s = await setup(); await prepare(s);
    await fixture.admin.query("update parent_private.provider_capabilities set required_acts='{}' where program_id='snap-pa' and action='submit'");
    expect(await personalComplete(s)).toBe(false); await expect(submit(s, [])).rejects.toMatchObject({ code: "23514" });
    await submit(s); expect(await personalComplete(s)).toBe(true);
  });
  it("does not treat missing per-packet applicability metadata as a complete personal-act contract", async () => {
    const s = await setup(false); s.verification = await receipt(s, { required_personal_acts: null }); await prepare(s);
    const job = await claim(s), rows = (await role("parent_worker", "select parent_private.parent_get_operations($1,$2) value", [job.jobId, job.leaseToken])).rows[0].value as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ protectedPacketCurrent: false, personalActsComplete: false });
    await expect(submit(s)).rejects.toMatchObject({ code: "42501" }); expect(await reports(s)).toEqual([]); expect(await submitted(s)).toEqual([]);
  });
  it("requires every applicable additional genuine act without making the parent an operator", async () => {
    const s = await setup(false), extra = "authorized_representative_designation_signature";
    s.verification = await receipt(s, { required_personal_acts: [...personalRegions, extra] }); const id = (await prepare(s)).rows[0].id;
    expect((await fixture.admin.query("select parent_private.snap_protected_parent_submit_ready(o) ready from public.parent_operations o where id=$1", [id])).rows[0].ready).toBe(false);
    await expect(submit(s)).rejects.toMatchObject({ code: "42501" }); expect(await reports(s)).toEqual([]);
    await expect(submit(s, [...personalRegions, extra])).rejects.toMatchObject({ code: "23514" });
    await expect(role("authenticated", "select public.parent_record_personal_act($1,$2,'synthetic-parent-cannot-verify',now())", [id, extra], s.owner)).rejects.toMatchObject({ code: "42501" });
    const verifier = randomUUID(), session = randomUUID(); sessions.set(verifier, session);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [verifier, `${verifier}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, verifier]);
    // One already-existing accepted trusted-evidence route is exercised; this is not a required operator product handoff.
    await fixture.admin.query(`insert into parent_private.trusted_memberships(user_id,request_id,operation_id,program_id,role,allowed_fields,can_verify_personal_acts,purpose,permission_reference,expires_at)
      values($1,$2,$3,'snap-pa','operator','{}',true,'synthetic applicable act proof','synthetic only',now()+interval '1 hour')`, [verifier, s.request, id]);
    await role("authenticated", "select public.parent_record_personal_act($1,$2,'synthetic-real-act-observation',now())", [id, extra], verifier);
    expect((await fixture.admin.query("select parent_private.snap_protected_parent_submit_ready(o) ready from public.parent_operations o where id=$1", [id])).rows[0].ready).toBe(true);
    await submit(s); expect(await personalComplete(s)).toBe(true); expect((await reports(s)).filter(row => row.attribution === "parent_reported")).toHaveLength(2);
  });
  it("does not count a forged parent report for an additional actor or required act", async () => {
    const s = await setup(false), extra = "authorized_representative_designation_signature";
    s.verification = await receipt(s, { required_personal_acts: [...personalRegions, extra] }); const id = (await prepare(s)).rows[0].id, o = await operation(s);
    await fixture.admin.query(`insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_by,verified_at,expires_at,attribution,protected_packet_id,protected_content_sha256)
      values($1,$2,$3,$4,$5,now(),now()+interval '1 minute','parent_reported',$6,$7)`, [id, extra, o.packet_hash, `parent-submit:${id}`, s.owner, s.packet, contentHash]);
    await expect(submit(s)).rejects.toMatchObject({ code: "42501" }); expect(await personalComplete(s)).toBe(false); expect(await submitted(s)).toEqual([]);
    expect((await fixture.admin.query("select parent_private.snap_protected_parent_submit_ready(o) ready from public.parent_operations o where id=$1", [id])).rows[0].ready).toBe(false);
    expect((await reports(s)).map(e => e.act)).toEqual([extra]);
  });
  it("contains a second-read authority change inside the parent-Submit readiness flag", async () => {
    const s = await setup(), id = (await prepare(s)).rows[0].id;
    const definition = (await fixture.admin.query("select pg_get_functiondef('parent_private.required_personal_acts(public.parent_operations)'::regprocedure) source")).rows[0].source as string;
    await fixture.admin.query("create sequence parent_private.synthetic_required_act_reads");
    try {
      await fixture.admin.query(definition.replace(/\bbegin\b/i, "begin if nextval('parent_private.synthetic_required_act_reads')=2 then raise exception 'synthetic second-read scope change' using errcode='42501'; end if;"));
      expect((await fixture.admin.query("select parent_private.snap_protected_parent_submit_ready(o) ready from public.parent_operations o where id=$1", [id])).rows[0].ready).toBe(false);
      expect((await fixture.admin.query("select last_value::int value from parent_private.synthetic_required_act_reads")).rows[0].value).toBe(2);
    } finally {
      await fixture.admin.query(definition); await fixture.admin.query("drop sequence parent_private.synthetic_required_act_reads");
    }
    expect((await fixture.admin.query("select parent_private.snap_protected_parent_submit_ready(o) ready from public.parent_operations o where id=$1", [id])).rows[0].ready).toBe(true);
  });
  it.each(["request", "operation", "version", "hash", "packet", "content"])("denies a changed exact Submit %s", async field => {
    const s = await setup(); await prepare(s);
    await expect(submit(s, personalRegions, s.owner, { [field]: field === "version" ? s.version + 1 : ["hash", "content"].includes(field) ? "f".repeat(64) : randomUUID() })).rejects.toMatchObject({ code: "42501" });
    expect(await reports(s)).toEqual([]); expect(await submitted(s)).toEqual([]);
  });
  it.each(["wrong_owner", "session_deleted", "account_closed", "cancel", "correction", "revocation", "permission"])("rechecks current authority before a protected Submit: %s", async kind => {
    const s = await setup(); await prepare(s); let owner = s.owner;
    if (kind === "wrong_owner") owner = (await setup()).owner;
    if (kind === "session_deleted") await fixture.admin.query("delete from auth.sessions where id=$1", [sessions.get(s.owner)]);
    if (kind === "account_closed") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [s.owner]);
    if (kind === "cancel") await role("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    if (kind === "correction") await fixture.admin.query("update public.parent_requests set version=version+1 where id=$1", [s.request]);
    if (kind === "revocation") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.authorization]);
    if (kind === "permission") await fixture.admin.query("update parent_private.provider_capabilities set permission_version='changed' where program_id='snap-pa' and action='submit'");
    await expect(submit(s, personalRegions, owner)).rejects.toMatchObject({ code: "42501" }); expect(await reports(s)).toEqual([]); expect(await submitted(s)).toEqual([]);
  });
  it.each(["attempts=48", "state='cancelled'", "last_error='delivery_unknown'"])("rolls back reports and authorization for unresumable Submit %s", async assignment => {
    const s = await setup(); await prepare(s); await fixture.admin.query(`update public.parent_jobs set ${assignment} where request_id=$1`, [s.request]);
    await expect(submit(s)).rejects.toMatchObject({ code: "23514" }); expect(await reports(s)).toEqual([]); expect(await submitted(s)).toEqual([]);
  });
  it.each(["waiting", "failed"])("resumes eligible %s work after the exact Submit without resetting attempts", async state => {
    const s = await setup(); await prepare(s); await fixture.admin.query("update public.parent_jobs set state=$2,run_at='infinity',attempts=7 where request_id=$1", [s.request, state]);
    await submit(s); expect((await fixture.admin.query("select state,attempts from public.parent_jobs where request_id=$1", [s.request])).rows[0]).toEqual({ state: "queued", attempts: 7 });
  });
  it.each(["wait", "fail"])("preserves a genuine Submit across its exact stale lease %s once without a later-lease loop", async kind => {
    const s = await setup(); await prepare(s); const job = await claim(s); await submit(s);
    const before = { acts: await reports(s), auth: await submitted(s) };
    const staleResult = (value: typeof job) => kind === "fail"
      ? role("parent_worker", "select parent_private.parent_fail_job($1,$2,'configuration_unavailable')", [value.jobId, value.leaseToken])
      : role("parent_worker", "select parent_private.parent_save_job_plan($1,$2,$3,$4,$5,null,'parent','parent_action_completed')", [value.jobId, value.leaseToken, s.version,
        JSON.stringify({ version: 1, routes: [{ need: "snap_new", programId: "snap-pa", state: "prepared" }] }), JSON.stringify([{ reason: "submission_review", resolver: "parent", resolved: false }])]);
    await staleResult(job); expect((await fixture.admin.query("select state,attempts from public.parent_jobs where request_id=$1", [s.request])).rows[0]).toEqual({ state: "queued", attempts: 1 });
    const later = await claim(s); await staleResult(later);
    expect((await fixture.admin.query("select state,attempts from public.parent_jobs where request_id=$1", [s.request])).rows[0]).toEqual({ state: kind === "fail" ? "failed" : "waiting", attempts: 2 });
    await expect(submit(s)).rejects.toMatchObject({ code: "23514" }); expect({ acts: await reports(s), auth: await submitted(s) }).toEqual(before);
  });
  it("can use the final eligible claim and replay an already-advanced exact Submit without renewing reports", async () => {
    const s = await setup(), id = (await prepare(s)).rows[0].id;
    await fixture.admin.query("update public.parent_jobs set state='waiting',attempts=47,run_at='infinity' where request_id=$1", [s.request]);
    await submit(s); const before = { acts: await reports(s), auth: await submitted(s) }, job = await claim(s);
    expect((await fixture.admin.query("select attempts from public.parent_jobs where request_id=$1", [s.request])).rows[0].attempts).toBe(48);
    expect((await submit(s)).rows[0].id).toBe(id);
    await role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [id, job.jobId, job.leaseToken]);
    await fixture.admin.query("update public.parent_jobs set state='done' where request_id=$1", [s.request]);
    expect((await submit(s)).rows[0].id).toBe(id); expect({ acts: await reports(s), auth: await submitted(s) }).toEqual(before);
  });
  it("does not transfer old personal reports or a Submit to an actual corrected snapshot and new canonical PDF", async () => {
    const s = await setup(); await prepare(s); await submit(s); const before = { acts: await reports(s), auth: await submitted(s) };
    const details = fixtureSnapApplication(new Date()); details.phone = "215-555-0102";
    const snapshot = (await role("authenticated", "select public.parent_save_snap_application_details($1,$2,$3,$4,$5) id", [s.request, s.version, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner)).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [s.request])).rows[0].version as number;
    const context = (await role("authenticated", "select public.parent_get_snap_capture_context($1,$2) value", [s.request, version], s.owner)).rows[0].value as { snapshotId: string; snapshotHash: string };
    expect(context.snapshotId).toBe(snapshot); await expect(submit(s)).rejects.toMatchObject({ code: "42501" });
    const next = await candidate({ ...s, version, snapshot, snapshotHash: context.snapshotHash }); next.verification = await receipt(next); await prepare(next);
    expect(await personalComplete(next)).toBe(false); expect(await submitted(next)).toEqual([]); expect(await reports(next)).toEqual([]);
    await submit(next); expect(await personalComplete(next)).toBe(true); expect({ acts: await reports(s), auth: await submitted(s) }).toEqual(before);
  });
  it.each(["sent", "agency_submitted", "failed"])("does not create another initial filing after an older-version %s attempt", async state => {
    const s = await setup(), id = (await prepare(s)).rows[0].id; await submit(s); const job = await claim(s);
    await role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [id, job.jobId, job.leaseToken]);
    // Explicit synthetic history only: no provider was contacted or agency receipt obtained.
    await fixture.admin.query("update public.parent_operations set state=$2 where id=$1", [id, state]);
    const details = fixtureSnapApplication(new Date()); details.phone = "215-555-0103";
    const snapshot = (await role("authenticated", "select public.parent_save_snap_application_details($1,$2,$3,$4,$5) id", [s.request, s.version, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner)).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [s.request])).rows[0].version as number;
    const context = (await role("authenticated", "select public.parent_get_snap_capture_context($1,$2) value", [s.request, version], s.owner)).rows[0].value as { snapshotHash: string };
    const next = await candidate({ ...s, snapshot, version, snapshotHash: context.snapshotHash }); next.verification = await receipt(next);
    await expect(prepare(next)).rejects.toMatchObject({ code: "23514", message: "an earlier initial SNAP filing requires reconciliation or an accepted follow-up route" });
    expect(await operation(next)).toBeUndefined();
  });
  it.each(["additional_act", "data_permission"])("uses current private routing and rechecks %s after Submit", async change => {
    const s = await setup(), id = (await prepare(s)).rows[0].id;
    await fixture.admin.query("update public.parent_requests set intake=jsonb_set(intake,'{zip}','\"19000\"'::jsonb) where id=$1", [s.request]);
    await submit(s);
    await fixture.admin.query(change === "additional_act"
      ? "update parent_private.provider_capabilities set required_acts=required_acts||'additional_required_personal_act'::text where program_id='snap-pa' and action='submit'"
      : "update parent_private.provider_capabilities set allowed_fields=array['protectedSnapPacket'] where program_id='snap-pa' and action='submit'");
    expect(await personalComplete(s)).toBe(false); const job = await claim(s);
    await expect(role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [id, job.jobId, job.leaseToken])).rejects.toMatchObject({ code: "42501" });
  });
  it("keeps durable background authority after normal sign-out but rejects new parent clicks", async () => {
    const s = await setup(), id = (await prepare(s)).rows[0].id; await submit(s); await fixture.admin.query("delete from auth.sessions where id=$1", [sessions.get(s.owner)]);
    await expect(submit(s)).rejects.toMatchObject({ code: "42501" });
    const job = await claim(s); expect((await role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3) value", [id, job.jobId, job.leaseToken])).rows[0].value).toMatchObject({ operationId: id });
  });
  it.each(["protected_packet_id", "protected_content_sha256", "verified_by", "reference", "expires_at"])("does not accept a mismatched or stale parent report %s at begin", async field => {
    const s = await setup(), id = (await prepare(s)).rows[0].id; await submit(s);
    const expression = field === "protected_content_sha256" ? "repeat('f',64)" : field === "reference" ? "'changed-reference'" : field === "expires_at" ? "now()-interval '1 second'" : field === "verified_by" ? "null" : "gen_random_uuid()";
    await fixture.admin.query(`update parent_private.personal_act_evidence set ${field}=${expression} where operation_id=$1`, [id]);
    expect(await personalComplete(s)).toBe(false); const job = await claim(s);
    await expect(role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [id, job.jobId, job.leaseToken])).rejects.toMatchObject({ code: "42501" });
  });
  it("never counts parent_reported evidence as a trusted personal act for an ordinary program", async () => {
    const s = await setup();
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,permission_version,permission_reference,required_acts,verified_until)
      values('philly-food','share','synthetic-report-isolation','synthetic only',array['signature'],now()+interval '1 hour')
      on conflict(program_id,action) do update set required_acts=array['signature']`);
    const id = (await fixture.admin.query(`insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,idempotency_key,permission_version)
      values($1,$2,'food_now','philly-food','share','{"zip":"19104"}',repeat('a',64),array['household'],$3,'synthetic-report-isolation') returning id`, [s.request, s.version, randomUUID()])).rows[0].id;
    await fixture.admin.query(`insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_by,verified_at,expires_at,attribution,protected_packet_id,protected_content_sha256)
      values($1,'signature',repeat('a',64),$2,$3,now(),now()+interval '1 hour','parent_reported',$4,$5)`, [id, `parent-submit:${id}`, s.owner, s.packet, contentHash]);
    expect((await fixture.admin.query("select parent_private.personal_acts_complete(o) value from public.parent_operations o where id=$1", [id])).rows[0].value).toBe(false);
  });
  it.each(["anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])("denies %s the parent protected Submit entry", async actor => {
    const s = await setup(), id = (await prepare(s)).rows[0].id, o = await operation(s);
    await expect(role(actor, "select public.parent_authorize_snap_protected_submission($1,$2,$3,$4,$5,$6,$7)", [s.request, id, s.version, o.packet_hash, s.packet, contentHash, personalRegions], s.owner)).rejects.toMatchObject({ code: "42501" });
  });
  it("does not grant ordinary runtimes direct access to the shared authorization or personal-act guards", async () => {
    for (const actor of ["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])
      for (const signature of ["parent_private.authorize_snap_submission(uuid,uuid,integer,text,uuid,uuid,text,text[])", "parent_private.personal_acts_complete(public.parent_operations)",
        "parent_private.required_personal_acts(public.parent_operations)", "parent_private.validate_operation_artifact(public.parent_operations)", "parent_private.operation_allowed(uuid,integer,text,text,text[],uuid[],jsonb,text)"])
        expect((await fixture.admin.query("select has_function_privilege($1,$2,'execute') allowed", [actor, signature])).rows[0].allowed).toBe(false);
  });
  it.each(["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker"])("denies %s the finalizer preparation entry", async actor => {
    const s = await setup(); await expect(prepare(s, {}, actor)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])("does not grant %s a verifier receipt writer or raw table access", async actor => {
    const s = await setup(); await expect(role(actor, "select * from parent_private.snap_final_packet_verifications")).rejects.toMatchObject({ code: "42501" });
    await expect(role(actor, "insert into parent_private.snap_final_packet_verifications select * from parent_private.snap_final_packet_verifications where id=$1", [s.verification])).rejects.toMatchObject({ code: "42501" });
  });
});
