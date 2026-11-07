import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const contentHash = createHash("sha256").update("SYNTHETIC_NONPDF_DELIVERY_METADATA_ONLY").digest("hex");
const personalActs = ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"];
const permissionVersion = "synthetic-delivery-v1";
type Scope = { owner: string; request: string; version: number; snapshot: string; snapshotHash: string; packet: string; authorization: string; operation: string; intent: Record<string, unknown> };

describe.skipIf(!modulePath)("closed SNAP delivery SQL (synthetic Vault, non-PDF bytes and verification receipt only)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    for (const sql of ["create schema vault", "create schema extensions", "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
      "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$",
      "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$"]) await fixture.admin.query(sql);
  });
  beforeEach(async () => {
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null");
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function tx<T>(fn: () => Promise<T>) {
    await fixture.admin.query("begin");
    try { const value = await fn(); await fixture.admin.query("commit"); return value; }
    catch (error) { await fixture.admin.query("rollback"); throw error; }
  }
  async function role(actor: string, sql: string, values: unknown[] = [], owner?: string) {
    return tx(async () => {
      await fixture.admin.query(`set local role ${actor}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: actor, sub: owner, session_id: owner && sessions.get(owner), amr: [{ method: "otp" }] })]);
      return fixture.admin.query(sql, values);
    });
  }
  async function setup(withRoute = true): Promise<Scope> {
    await fixture.admin.query("delete from parent_private.snap_delivery_destinations");
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic delivery SQL only',approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1,
      snap_protected_enabled=true,snap_protected_approval_reference='synthetic only; NOT actual provider acceptance',snap_protected_approved_until=now()+interval '1 day',
      snap_protected_policy_version='synthetic-policy-1',snap_protected_retention_policy_version='synthetic-retention-1',snap_protected_max_retention_seconds=300`, [SNAP_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      values('snap-pa','submit',true,true,true,$1,'synthetic route fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',$2,now()+interval '1 hour')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,permission_reference=excluded.permission_reference,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until`, [permissionVersion, personalActs]);
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,verified_until)
      values('snap-pa','follow_up',true,true,false,$1,'synthetic follow-up fixture only',array['statusReference'],'{"statusReference":"household"}',now()+interval '1 hour')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,permission_reference=excluded.permission_reference,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,verified_until=excluded.verified_until`, [permissionVersion]);
    const owner = randomUUID(), session = randomUUID(); sessions.set(owner, session);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    const request = (await role("authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })), JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"] })), randomUUID()], owner)).rows[0].id as string;
    const snapshot = (await role("authenticated", "select public.parent_save_snap_application_details($1,1,$2,$3,$4) id", [request, JSON.stringify(fixtureSnapApplication(new Date())), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], owner)).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [request])).rows[0].version as number;
    const snapshotHash = (await fixture.admin.query("select parent_private.snap_application_binding($1,$2)->>'snapshotHash' hash", [request, version])).rows[0].hash as string;
    const packet = randomUUID();
    const authorization = ((await role("authenticated", "select public.parent_authorize_snap_final_packet($1,$2,$3,$4,$5,$6,11,'synthetic-policy-1','synthetic-retention-1',$7,true) value", [request, version, snapshot, snapshotHash, packet, contentHash, [fixtureSnapApplication().household![0].id]], owner)).rows[0].value as { intent: { authorizationId: string } }).intent.authorizationId;
    await tx(async () => {
      await fixture.admin.query("set local role parent_snap_finalizer");
      await fixture.admin.query("select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,11,$7)", [authorization, request, version, snapshot, snapshotHash, contentHash, packet]);
      await fixture.admin.query("select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,decode(repeat('ab',12),'hex'),decode(repeat('ab',16),'hex'),decode(repeat('ab',11),'hex'))", [packet, request, version, authorization]);
    });
    // This fixture receipt establishes only SQL authority tests; it does not verify a PDF, signature or DHS acceptance.
    const source = (await fixture.admin.query("select source from public.parent_snap_application_details where id=$1", [snapshot])).rows[0].source;
    const verification = (await fixture.admin.query(`insert into parent_private.snap_final_packet_verifications
      select (jsonb_populate_record(null::parent_private.snap_final_packet_verifications,$1::jsonb)).* returning id`, [JSON.stringify({ id: randomUUID(), packet_id: packet, snapshot_id: snapshot, snapshot_hash: snapshotHash,
        content_sha256: contentHash, validator_version: "pa600fs-final-content-2026-11-04.v1", source, baseline_certification_regions: personalActs, required_personal_acts: personalActs,
        verified_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() })])).rows[0].id;
    const operation = (await role("parent_snap_finalizer", "select parent_private.parent_prepare_snap_final_operation($1,$2,$3,$4,$5) id", [packet, request, version, authorization, verification])).rows[0].id as string;
    const o = (await fixture.admin.query("select * from public.parent_operations where id=$1", [operation])).rows[0];
    await role("authenticated", "select public.parent_authorize_snap_protected_submission($1,$2,$3,$4,$5,$6,$7)", [request, operation, version, o.packet_hash, packet, contentHash, personalActs], owner);
    const job = await claim(request);
    await role("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [operation, job.jobId, job.leaseToken]);
    const intent = { jobId: job.jobId, leaseToken: job.leaseToken, operationId: operation, requestId: request, requestVersion: version, idempotencyKey: o.idempotency_key, packetHash: o.packet_hash, protectedPacket: (o.packet as Record<string, unknown>).protectedSnapPacket };
    if (withRoute) await destination();
    return { owner, request, version, snapshot, snapshotHash, packet, authorization, operation, intent };
  }
  async function claim(request: string) {
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where request_id<>$1 and state<>'leased'", [request]);
    const job = (await role("parent_worker", "select parent_private.parent_claim_job(300) value")).rows[0].value as { jobId: string; leaseToken: string; request: { id: string } };
    expect(job.request.id).toBe(request); return job;
  }
  async function destination(id = "synthetic-philadelphia", zip = "19104") {
    await fixture.admin.query(`insert into parent_private.snap_delivery_destinations(id,version,enabled,permission_version,project_id,service_id,from_number,to_number,zip_codes,evidence_reference,verified_until)
      values($1,'synthetic-v1',true,$2,'synthetic-project','synthetic-service','+12155550100','+12155550101',array[$3],'fixture only; NOT government destination or accepted route',now()+interval '1 hour')`, [id, permissionVersion, zip]);
  }
  const reserve = async (s: Scope, intent: unknown = s.intent) => (await role("parent_snap_sender", "select parent_private.parent_reserve_snap_delivery($1) value", [JSON.stringify(intent)])).rows[0].value as Record<string, unknown>;
  const recheck = async (s: Scope, intent = s.intent) => (await role("parent_snap_sender", "select parent_private.parent_recheck_snap_delivery($1) value", [JSON.stringify(intent)])).rows[0].value as Record<string, unknown>;
  const resume = async (s: Scope, intent = s.intent) => (await role("parent_snap_sender", "select parent_private.parent_resume_snap_delivery($1) value", [JSON.stringify(intent)])).rows[0].value as Record<string, unknown>;
  const read = async (s: Scope, intent = s.intent) => (await role("parent_snap_sender", "select parent_private.parent_read_snap_delivery($1) value", [JSON.stringify(intent)])).rows[0].value as Record<string, unknown> | null;
  const record = async (s: Scope, providerId: string | null, status: string, intent = s.intent) => (await role("parent_snap_sender", "select parent_private.parent_record_snap_delivery($1,$2,$3) value", [JSON.stringify(intent), providerId, status])).rows[0].value as Record<string, unknown>;
  const ledger = async (s: Scope) => (await fixture.admin.query("select * from parent_private.snap_delivery_intents where operation_id=$1", [s.operation])).rows[0];
  async function freshIntent(s: Scope): Promise<Record<string, unknown>> {
    await fixture.admin.query("update public.parent_jobs set state='queued',run_at=clock_timestamp(),lease_token=null,lease_until=null where id=$1", [s.intent.jobId]);
    const job = await claim(s.request); return { ...s.intent, jobId: job.jobId, leaseToken: job.leaseToken };
  }

  it("ships empty, disabled by access, and callable only by the dedicated non-login sender", async () => {
    expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_delivery_destinations")).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select rolcanlogin,rolinherit from pg_roles where rolname='parent_snap_sender'")).rows[0]).toEqual({ rolcanlogin: false, rolinherit: false });
    for (const actor of ["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer", "parent_snap_sender"]) {
      for (const signature of ["parent_reserve_snap_delivery(jsonb)", "parent_resume_snap_delivery(jsonb)", "parent_recheck_snap_delivery(jsonb)", "parent_read_snap_delivery(jsonb)", "parent_record_snap_delivery(jsonb,text,text)"])
        expect((await fixture.admin.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [actor, `parent_private.${signature}`])).rows[0].allowed).toBe(actor === "parent_snap_sender");
      expect((await fixture.admin.query("select has_table_privilege($1,'parent_private.snap_delivery_intents','SELECT') allowed", [actor])).rows[0].allowed).toBe(false);
    }
  });
  it("lets only the ordinary worker read the existing SNAP job limit without resetting or renewing authority", async () => {
    const s = await setup();
    await fixture.admin.query("update public.parent_jobs set attempts=48 where id=$1", [s.intent.jobId]);
    const snapshot = async () => (await fixture.admin.query(`select
      (select to_jsonb(j) from public.parent_jobs j where id=$1) job,
      (select mandate from public.parent_requests where id=$2) mandate,
      (select to_jsonb(a) from parent_private.snap_submission_authorizations a where operation_id=$3) authorization`, [s.intent.jobId, s.request, s.operation])).rows[0];
    const before = await snapshot();
    expect((await role("parent_worker", "select parent_private.parent_get_snap_delivery_job_attempts($1,$2) value", [s.intent.jobId, s.intent.leaseToken])).rows[0].value).toBe(48);
    expect(await snapshot()).toEqual(before);
    for (const actor of ["anon", "authenticated", "service_role", "parent_snap_sender", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])
      expect((await fixture.admin.query("select has_function_privilege($1,'parent_private.parent_get_snap_delivery_job_attempts(uuid,uuid)','EXECUTE') allowed", [actor])).rows[0].allowed).toBe(false);
  });
  it.each(["old lease", "wrong job", "closed processing"])("denies delivery work-limit reads with %s", async kind => {
    const s = await setup();
    const job = kind === "wrong job" ? (await setup()).intent.jobId : s.intent.jobId;
    if (kind === "old lease") await freshIntent(s);
    if (kind === "closed processing") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    await expect(role("parent_worker", "select parent_private.parent_get_snap_delivery_job_attempts($1,$2)", [job, s.intent.leaseToken])).rejects.toMatchObject({ code: "42501" });
  });
  it("does not expose delivery scheduling counts for an active job without the SNAP-new need", async () => {
    const s = await setup();
    const request = (await role("authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["electricity"] })), JSON.stringify(fixtureMandate({ recipientIds: ["peco-cap"] })), randomUUID()], s.owner)).rows[0].id as string;
    const job = await claim(request);
    await expect(role("parent_worker", "select parent_private.parent_get_snap_delivery_job_attempts($1,$2)", [job.jobId, job.leaseToken])).rejects.toMatchObject({ code: "42501" });
  });
  it("keeps dispatch closed without an exactly matched verified destination", async () => {
    const s = await setup(false);
    await expect(reserve(s)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toBeUndefined();
    await destination("wrong-zip", "19103");
    await expect(reserve(s)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toBeUndefined();
    await destination(); await destination("ambiguous-second-route");
    await expect(reserve(s)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toBeUndefined();
  });
  it.each([null, [], "not-an-object", true])("rejects non-object intent %j before reading any packet", async intent => {
    const s = await setup(); await expect(reserve(s, intent)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toBeUndefined();
  });
  it.each(["19000", "1910", "191040", "19104,other"])("rejects invalid destination ZIP registry entry %s", async zip => {
    await expect(destination(`invalid-${randomUUID()}`, zip)).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["jobId", "leaseToken", "operationId", "requestId", "requestVersion", "idempotencyKey", "packetHash", "protectedPacket", "extra"])("rejects changed intent %s before reserving or returning encrypted bytes", async field => {
    const s = await setup(), value = { ...s.intent, [field]: field === "requestVersion" ? s.version + 1 : field === "protectedPacket" ? { ...(s.intent.protectedPacket as object), contentSha256: "f".repeat(64) } : randomUUID() };
    await expect(reserve(s, value)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toBeUndefined();
  });
  it.each(["submit", "cross-owner Submit", "future Submit", "personal acts", "content verification", "receipt authority", "grant", "lease", "provider permission", "processing"])("rechecks current %s before the first reservation", async kind => {
    const s = await setup();
    if (kind === "submit") await fixture.admin.query("delete from parent_private.snap_submission_authorizations where operation_id=$1", [s.operation]);
    if (kind === "cross-owner Submit") {
      const other = randomUUID(); await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [other, `${other}@example.invalid`]);
      await fixture.admin.query("update parent_private.snap_submission_authorizations set authorized_by=$2 where operation_id=$1", [s.operation, other]);
    }
    if (kind === "future Submit") await fixture.admin.query("update parent_private.snap_submission_authorizations set authorized_at=clock_timestamp()+interval '1 minute' where operation_id=$1", [s.operation]);
    if (kind === "personal acts") await fixture.admin.query("delete from parent_private.personal_act_evidence where operation_id=$1", [s.operation]);
    if (kind === "content verification") await fixture.admin.query("delete from parent_private.snap_final_packet_verifications where packet_id=$1", [s.packet]);
    if (kind === "receipt authority") await fixture.admin.query("delete from parent_private.receipt_authority where operation_id=$1", [s.operation]);
    if (kind === "grant") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=$1", [s.request]);
    if (kind === "lease") await fixture.admin.query("update public.parent_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [s.intent.jobId]);
    if (kind === "provider permission") await fixture.admin.query("update parent_private.provider_capabilities set permission_version='changed' where program_id='snap-pa' and action='submit'");
    if (kind === "processing") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    await expect(reserve(s)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toBeUndefined();
  });
  it.each(["mode", "allowedActions", "recipientIds", "allowedData"])("fails closed for missing or null mandate %s", async field => {
    for (const remove of [false, true]) {
      const s = await setup();
      await fixture.admin.query("update public.parent_requests set mandate=case when $2 then mandate-$3 else jsonb_set(mandate,array[$3],'null'::jsonb) end where id=$1", [s.request, remove, field]);
      await expect(reserve(s)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toBeUndefined();
    }
  });
  it("returns the encrypted envelope once, replays metadata only, and authorizes one dispatch recheck", async () => {
    const s = await setup(), first = await reserve(s), before = await ledger(s);
    expect(first.state).toBe("dispatch_allowed"); expect(first.envelope).toBeTruthy();
    expect(first.attempt).toMatchObject({ operationId: s.operation, packetId: s.packet, contentSha256: contentHash, pageCount: 12, providerId: null, providerStatus: "UNKNOWN", dispatchAuthorizedAt: null, destinationId: "synthetic-philadelphia" });
    expect(JSON.stringify(first.attempt)).not.toMatch(/ciphertext|keyBase64|firstName|street|dateOfBirth|vault_secret/);
    const replay = await reserve(s); expect(replay).toEqual({ state: "reconcile_only", attempt: first.attempt }); expect(await ledger(s)).toEqual(before);
    const metadata = await read(s);
    expect(metadata).toMatchObject({ ...(first.attempt as object), expiresAt: expect.any(String) });
    expect(JSON.stringify(metadata)).not.toMatch(/envelope|ciphertext|keyBase64/);
    expect(Date.parse(metadata!.expiresAt as string)).toBeLessThanOrEqual(new Date((await fixture.admin.query("select lease_until from public.parent_jobs where id=$1", [s.intent.jobId])).rows[0].lease_until as string).getTime());
    expect(await ledger(s)).toEqual(before);
    const dispatch = await recheck(s);
    expect(dispatch).toEqual({ ...(first.attempt as object), dispatchAuthorizedAt: expect.any(String) });
    expect(Date.parse(dispatch.dispatchAuthorizedAt as string)).toBeGreaterThanOrEqual(Date.parse(dispatch.attemptedAt as string));
    const authorized = await ledger(s); expect(new Date(authorized.dispatch_authorized_at as string).toISOString()).toBe(dispatch.dispatchAuthorizedAt);
    await expect(recheck(s)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toEqual(authorized);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_delivery_intents where operation_id=$1", [s.operation])).rows[0].n).toBe(1);
  });
  it.each(["executing", "delivery_unknown"])("recovers a committed pre-dispatch reservation initially %s without resetting the attempt", async state => {
    const s = await setup(), original = await reserve(s);
    await fixture.admin.query("update public.parent_operations set state=$2 where id=$1", [s.operation, state]);
    const originalOperation = (await fixture.admin.query("select * from public.parent_operations where id=$1", [s.operation])).rows[0], before = await ledger(s);
    const intent = await freshIntent(s); expect(intent.leaseToken).not.toBe(s.intent.leaseToken);
    const operation = (await fixture.admin.query("select * from public.parent_operations where id=$1", [s.operation])).rows[0];
    expect(operation).toMatchObject({ state: "delivery_unknown", executed_at: originalOperation.executed_at, packet: originalOperation.packet, packet_hash: originalOperation.packet_hash });
    expect(await read(s, intent)).toMatchObject({ dispatchAuthorizedAt: null, providerId: null, providerStatus: "UNKNOWN" });
    const recovered = await resume(s, intent);
    expect(recovered).toEqual(original);
    const after = await ledger(s);
    expect(after).toEqual({ ...before, intent, reserved_lease_token: intent.leaseToken, updated_at: expect.any(Date) });
    expect((await fixture.admin.query("select * from public.parent_operations where id=$1", [s.operation])).rows[0]).toEqual(operation);
    expect((await fixture.admin.query("select lease_token,packet_hash from parent_private.receipt_authority where operation_id=$1", [s.operation])).rows[0])
      .toEqual({ lease_token: intent.leaseToken, packet_hash: intent.packetHash });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_delivery_intents where operation_id=$1", [s.operation])).rows[0].n).toBe(1);
    await expect(recheck(s)).rejects.toMatchObject({ code: "42501" });
    expect(await recheck(s, intent)).toEqual({ ...(original.attempt as object), dispatchAuthorizedAt: expect.any(String) });
    await expect(resume(s, intent)).rejects.toMatchObject({ code: "42501" });
  });
  it("keeps serial resume interleavings safe and authorizes exactly one dispatch without another operation or envelope after dispatch", async () => {
    const s = await setup(), original = await reserve(s), first = await freshIntent(s);
    expect(await resume(s, first)).toEqual(original); expect(await resume(s, first)).toEqual(original);
    const second = await freshIntent(s); expect(await resume(s, second)).toEqual(original);
    await expect(recheck(s, first)).rejects.toMatchObject({ code: "42501" });
    await recheck(s, second); const dispatched = await ledger(s);
    await expect(recheck(s, second)).rejects.toMatchObject({ code: "42501" });
    await expect(resume(s, second)).rejects.toMatchObject({ code: "42501" });
    const later = await freshIntent(s); await expect(resume(s, later)).rejects.toMatchObject({ code: "42501" });
    expect(await ledger(s)).toEqual(dispatched);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1 and action='submit'", [s.request])).rows[0].n).toBe(1);
  });
  it.each(["expired reservation", "expired grant", "expired protected purpose", "expired lease", "correction", "cancel", "revoked permission", "missing Submit", "missing personal act", "route change", "ambiguous route", "provider ID", "provider status", "wrong version"])("denies pre-dispatch resume after %s without returning bytes or rebinding the ledger", async kind => {
    const s = await setup(); await reserve(s); const intent = await freshIntent(s);
    if (kind === "expired reservation") await fixture.admin.query("update parent_private.snap_delivery_intents set dispatch_expires_at=clock_timestamp()-interval '1 second' where operation_id=$1", [s.operation]);
    if (kind === "expired grant") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=$1", [s.request]);
    if (kind === "expired protected purpose") await fixture.admin.query("update parent_private.processing_controls set snap_protected_approved_until=clock_timestamp()-interval '1 second'");
    if (kind === "expired lease") await fixture.admin.query("update public.parent_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [intent.jobId]);
    if (kind === "correction") await role("authenticated", "select public.parent_save_snap_application_details($1,$2,$3,$4,$5)", [s.request, s.version, JSON.stringify({ ...fixtureSnapApplication(new Date()), bestTimeToCall: "Evenings" }), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    if (kind === "cancel") await role("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    if (kind === "revoked permission") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.authorization]);
    if (kind === "missing Submit") await fixture.admin.query("delete from parent_private.snap_submission_authorizations where operation_id=$1", [s.operation]);
    if (kind === "missing personal act") await fixture.admin.query("delete from parent_private.personal_act_evidence where operation_id=$1", [s.operation]);
    if (kind === "route change") await fixture.admin.query("update parent_private.snap_delivery_destinations set version='changed'");
    if (kind === "ambiguous route") await destination("new-resume-ambiguity");
    if (kind === "provider ID") await fixture.admin.query("update parent_private.snap_delivery_intents set provider_id='synthetic-unexpected-id' where operation_id=$1", [s.operation]);
    if (kind === "provider status") await fixture.admin.query("update parent_private.snap_delivery_intents set provider_status='QUEUED' where operation_id=$1", [s.operation]);
    if (kind === "wrong version") intent.requestVersion = s.version + 1;
    const before = await ledger(s); await expect(resume(s, intent)).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toEqual(before);
  });
  it.each(["disabled", "expired", "permission", "address", "version", "zip"])("stops dispatch if destination %s changes after reservation", async kind => {
    const s = await setup(); await reserve(s);
    const changes: Record<string, string> = { disabled: "enabled=false", expired: "verified_until=clock_timestamp()-interval '1 second'", permission: "permission_version='changed'", address: "to_number='+12155550199'", version: "version='changed'", zip: "zip_codes=array['19103']" };
    await fixture.admin.query(`update parent_private.snap_delivery_destinations set ${changes[kind]}`);
    await expect(recheck(s)).rejects.toMatchObject({ code: "42501" }); expect((await ledger(s)).dispatch_authorized_at).toBeNull();
  });
  it("stops dispatch when another matching ZIP destination appears after reservation", async () => {
    const s = await setup(); await reserve(s); await destination("newly-ambiguous-route");
    await expect(recheck(s)).rejects.toMatchObject({ code: "42501" }); expect((await ledger(s)).dispatch_authorized_at).toBeNull();
  });
  it.each(["cancel", "expired mandate", "correction", "revoked private permission"])("stops reserved dispatch after %s", async kind => {
    const s = await setup(); await reserve(s);
    if (kind === "cancel") await role("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    if (kind === "expired mandate") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=$1", [s.request]);
    if (kind === "correction") await role("authenticated", "select public.parent_save_snap_application_details($1,$2,$3,$4,$5)", [s.request, s.version, JSON.stringify({ ...fixtureSnapApplication(new Date()), bestTimeToCall: "Evenings" }), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    if (kind === "revoked private permission") await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1", [s.authorization]);
    await expect(recheck(s)).rejects.toMatchObject({ code: "42501" }); expect((await ledger(s)).dispatch_authorized_at).toBeNull();
  });
  it("binds a provider ID and terminal transport result without creating an agency receipt", async () => {
    const s = await setup(); await reserve(s);
    await expect(record(s, "synthetic-provider-id", "QUEUED")).rejects.toMatchObject({ code: "42501" });
    await recheck(s); await expect(record(s, null, "COMPLETED")).rejects.toMatchObject({ code: "42501" });
    await expect(record(s, "synthetic-provider-id", "INVENTED")).rejects.toMatchObject({ code: "42501" });
    expect(await record(s, "synthetic-provider-id", "QUEUED")).toMatchObject({ providerId: "synthetic-provider-id", providerStatus: "QUEUED" });
    await expect(record(s, "another-provider-id", "IN_PROGRESS")).rejects.toMatchObject({ code: "42501" });
    await record(s, "synthetic-provider-id", "IN_PROGRESS"); await record(s, "synthetic-provider-id", "COMPLETED");
    const terminal = await ledger(s); await record(s, null, "UNKNOWN"); expect(await ledger(s)).toEqual(terminal);
    await expect(record(s, "synthetic-provider-id", "FAILURE")).rejects.toMatchObject({ code: "42501" }); expect(await ledger(s)).toEqual(terminal);
    expect((await fixture.admin.query("select state from public.parent_operations where id=$1", [s.operation])).rows[0].state).toBe("executing");
    expect((await fixture.admin.query("select count(*)::int n from public.parent_receipts where operation_id=$1", [s.operation])).rows[0].n).toBe(0);
  });
  it("never binds one carrier job to two CaseLink operations", async () => {
    const first = await setup(); await reserve(first); await recheck(first); await record(first, "synthetic-unique-provider-id", "QUEUED");
    const second = await setup(); await reserve(second); await recheck(second);
    await expect(record(second, "synthetic-unique-provider-id", "QUEUED")).rejects.toMatchObject({ code: "42501" });
    expect((await ledger(second)).provider_id).toBeNull(); expect((await ledger(first)).provider_id).toBe("synthetic-unique-provider-id");
  });
  it("records one attributed carrier-failure notice without an agency denial, receipt or repeated attempt", async () => {
    const s = await setup(); await reserve(s); await recheck(s);
    await record(s, "synthetic-failed-provider-id", "IN_PROGRESS");
    const events = async () => (await fixture.admin.query("select kind,actor,summary,evidence from public.parent_events where request_id=$1 and kind='snap_delivery.carrier_failed'", [s.request])).rows;
    expect(await events()).toEqual([]);
    await record(s, "synthetic-failed-provider-id", "FAILURE"); const terminal = await ledger(s), failure = await events();
    expect(failure).toEqual([{ kind: "snap_delivery.carrier_failed", actor: "caselink",
      summary: "The fax service reported a failed transmission. Some pages may have arrived; agency receipt is still unconfirmed.",
      evidence: { operationId: s.operation, source: "provider_api", reference: "sinch-fax:synthetic-failed-provider-id", transportStatus: "FAILURE" },
    }]);
    await record(s, "synthetic-failed-provider-id", "FAILURE"); await record(s, null, "UNKNOWN");
    expect(await events()).toEqual(failure); expect(await ledger(s)).toEqual(terminal);
    expect((await fixture.admin.query("select state,evidence from public.parent_operations where id=$1", [s.operation])).rows[0]).toMatchObject({ state: "executing" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_receipts where operation_id=$1", [s.operation])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_delivery_intents where operation_id=$1", [s.operation])).rows[0].n).toBe(1);
    expect(await reserve(s)).toMatchObject({ state: "reconcile_only" });
    await expect(recheck(s)).rejects.toMatchObject({ code: "42501" });
  });
  it("recovers metadata after raw-packet deletion using a fresh follow-up lease, without another envelope or signature", async () => {
    const s = await setup(); await reserve(s); await recheck(s); await record(s, "synthetic-recovery-id", "QUEUED");
    const attempts = (await fixture.admin.query("select count(*)::int n from parent_private.snap_delivery_intents where operation_id=$1", [s.operation])).rows[0].n;
    await fixture.admin.query("update public.parent_operations set state='delivery_unknown' where id=$1", [s.operation]);
    await fixture.admin.query("delete from parent_private.snap_final_packets where id=$1", [s.packet]);
    await fixture.admin.query("update public.parent_jobs set state='queued',run_at=clock_timestamp(),lease_token=null,lease_until=null where id=$1", [s.intent.jobId]);
    const job = await claim(s.request), intent = { ...s.intent, jobId: job.jobId, leaseToken: job.leaseToken };
    await expect(read(s)).rejects.toMatchObject({ code: "42501" });
    expect(await read(s, intent)).toMatchObject({ operationId: s.operation, packetId: s.packet, providerId: "synthetic-recovery-id", providerStatus: "QUEUED" });
    expect(JSON.stringify(await read(s, intent))).not.toMatch(/envelope|ciphertext|keyBase64|signature|firstName/);
    await expect(reserve(s, intent)).rejects.toMatchObject({ code: "42501" }); await expect(recheck(s, intent)).rejects.toMatchObject({ code: "42501" });
    expect(await record(s, "synthetic-recovery-id", "COMPLETED", intent)).toMatchObject({ providerStatus: "COMPLETED" });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_delivery_intents where operation_id=$1", [s.operation])).rows[0].n).toBe(attempts);
    await fixture.admin.query("update parent_private.provider_capabilities set enabled=false where program_id='snap-pa' and action='follow_up'");
    await expect(read(s, intent)).rejects.toMatchObject({ code: "42501" });
  });
});
