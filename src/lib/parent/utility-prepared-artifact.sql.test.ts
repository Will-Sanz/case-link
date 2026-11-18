import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_APPLICATION_REFERENCE } from "./water-application-fields";
import { UTILITY_PROTECTED_INPUT_NOTICE_VERSION, utilityProtectedBindingSchema } from "./utility-protected-input-contract";
import { sealUtilityProtectedInput, utilityProtectedContentDigest, utilityProtectedAccountFingerprint } from "./utility-protected-input";
import { utilityPreparedAad, utilityPreparedBindingSchema, utilityProtectedOperationSchema } from "./utility-protected-operation";
import { runOneParentJob } from "./worker-runtime";
import { openUtilityPreparedArtifact, sealUtilityPreparedArtifact } from "./utility-prepared-artifact";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE, at = new Date("2026-11-13T22:21:00Z");
// SQL/crypto fixture only. The separate local water rehearsal generates and inspects actual PDF pages.
const bytes = new TextEncoder().encode("%PDF-1.7\nLOCAL TEST WATER DRAFT\nPRIVATE_WATER_ACCOUNT_AND_MEMBER_CANARY\n%%EOF"), hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
describe.skipIf(!modulePath)("private utility preparation artifacts against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string, inTransaction = false;
  type Case = Awaited<ReturnType<typeof setup>>;
  async function query(sql: string, values: unknown[] = [], role = "parent_utility_protected", actor = owner) {
    if (inTransaction) await fixture.admin.query("savepoint role_call");
    try {
      await fixture.admin.query(`set role ${role}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(role === "authenticated" ? { sub: actor, session_id: session, role, amr: [{ method: "otp" }] } : { role })]);
      const result = await fixture.admin.query(sql, values); await fixture.admin.query("reset role");
      if (inTransaction) await fixture.admin.query("release savepoint role_call"); return result;
    } catch (error) {
      if (inTransaction) { await fixture.admin.query("rollback to savepoint role_call"); await fixture.admin.query("release savepoint role_call"); }
      else await fixture.admin.query("reset role");
      throw error;
    }
  }
  async function setup() {
    const applicant = randomUUID(), source = randomUUID(), details = { journey: "new_application", existingApplication: "none_known", householdComplete: true,
      applicant: { id: applicant, name: "WaterPrivateCanary", dateOfBirth: "1990-01-01", grossMonthlyIncome: "1200.50", income: { state: "sources", sources: [{ id: source, kind: "employment" }] } },
      propertyAddress: "100 Synthetic Lane", householdMembers: [], childSupportReceived: "no", outsideIncomeSupport: "no" };
    const intake = fixtureIntake({ needs: ["water"], householdSize: null, incomeAmount: null, incomeFrequency: "unknown", utilityProviders: ["pwd"], accountAuthority: "self" });
    const mandate = fixtureMandate({ mode: "prepare_only", recipientIds: ["pwd-tap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"], expiresAt: "2026-11-14T22:21:00Z" });
    const request = (await query("select public.parent_start_water_application($1,$2,$3,$4,$5,true,true) id", [JSON.stringify(intake), JSON.stringify(mandate), JSON.stringify(details), WATER_APPLICATION_NOTICE_VERSION, randomUUID()], "authenticated")).rows[0].id as string;
    const snapshot = (await fixture.admin.query("select * from public.parent_water_application_details where request_id=$1", [request])).rows[0];
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where request_id<>$1", [request]);
    const job = (await query("select parent_private.parent_claim_job(120) value", [], "parent_worker")).rows[0].value;
    expect(job.request.id).toBe(request);
    const spec = { scope: { requestId: request, expectedVersion: 2, programId: "pwd-tap", snapshotId: snapshot.id, snapshotRevision: 1, snapshotHash: snapshot.consent_evidence.detailsSha256 }, inputs: [] as { inputId: string; authorizationId: string; validationId: string | null }[],
      inputSetHash: "",
      source: { kind: "local_test_issued_form", id: "caselink-local-water-issued-form", version: "local-test-v1", sha256: "b".repeat(64), rendererVersion: "local-water-test-v1" },
      expiresAt: "2026-11-13T22:40:00Z", contentSha256: hash(bytes), byteLength: bytes.length };
    const target = (await query("select parent_private.parent_get_utility_preparation_target($1,$2) value", [job.jobId, job.leaseToken], "parent_worker")).rows[0].value;
    spec.inputSetHash = target.inputSetHash;
    return { request, snapshot, applicant, source, job, spec };
  }
  async function begin(s: Case, spec = s.spec) { return (await query("select parent_private.parent_begin_utility_prepared_artifact($1,$2,$3) value", [s.job.jobId, s.job.leaseToken, JSON.stringify(spec)])).rows[0].value; }
  async function prepare(s: Case) {
    await fixture.admin.query("begin");
    inTransaction = true;
    try {
      const started = await begin(s), binding = utilityPreparedBindingSchema.parse(started.binding), key = Buffer.from(started.keyBase64, "base64");
      if (started.state === "pending") {
        const sealed = sealUtilityPreparedArtifact(bytes, key, binding, new Date());
        await query("select parent_private.parent_seal_utility_prepared_artifact($1,$2,$3,$4,$5,$6)", [s.job.jobId, s.job.leaseToken, binding.operation.packet.protectedUtilityPacket.packetId, sealed.iv, sealed.tag, sealed.ciphertext]);
      }
      await fixture.admin.query("commit"); key.fill(0); return binding;
    } catch (error) { await fixture.admin.query("rollback"); throw error; } finally { inTransaction = false; }
  }
  async function ownerRead(s: Case, packet: string, actor = owner) { return (await query("select parent_private.parent_read_utility_prepared_artifact($1,$2,$3) value", [packet, actor, s.request])).rows[0].value; }
  async function accountInput(s: Case) {
    const inputId = randomUUID(), raw = new TextEncoder().encode(JSON.stringify({ purpose: "account_access", accessCode: "123456789", zip: "19147" }));
    await fixture.admin.query("update parent_private.utility_protected_policies set max_retention_seconds=90 where program_id='pwd-tap'");
    const reference = (await query("select public.parent_authorize_utility_protected_input($1,$2,$3,$4,$5,$6,$7,'account_access',$8,'application/octet-stream',$9,$10,true,true,true) value",
      [s.request, 2, "pwd-tap", s.snapshot.id, 1, s.spec.scope.snapshotHash, inputId, JSON.stringify([{ subjectId: s.applicant, sourceId: null, field: "water_access_code" }]), raw.length, UTILITY_PROTECTED_INPUT_NOTICE_VERSION], "authenticated")).rows[0].value;
    await fixture.admin.query("begin");
    inTransaction = true;
    try {
      const value = (await query("select parent_private.parent_begin_utility_protected_input($1) value", [inputId])).rows[0].value, key = Buffer.from(value.keyBase64, "base64");
      const digest = utilityProtectedContentDigest(raw, key), binding = utilityProtectedBindingSchema.parse({ ...value.binding, contentDigest: digest }), sealed = sealUtilityProtectedInput(raw, key, binding, new Date());
      await query("select parent_private.parent_seal_utility_protected_input($1,$2,$3,$4,$5)", [inputId, digest, sealed.iv, sealed.tag, sealed.ciphertext]);
      const matching = (await query("select parent_private.parent_begin_utility_account_match($1) value", [inputId])).rows[0].value, matchKey = Buffer.from(matching.keyBase64, "base64");
      await query("select parent_private.parent_bind_utility_account($1,$2,$3)", [inputId, matching.keyId, utilityProtectedAccountFingerprint(matchKey, owner, "pwd-tap", JSON.stringify(["123456789", "19147"]))]); matchKey.fill(0);
      await fixture.admin.query("commit"); key.fill(0);
    } catch (error) { await fixture.admin.query("rollback"); throw error; } finally { inTransaction = false; }
    await fixture.admin.query("update parent_private.utility_protected_policies set max_retention_seconds=300 where program_id='pwd-tap'");
    s.spec.inputs = [{ inputId, authorizationId: reference.authorizationId, validationId: null }];
    s.spec.inputSetHash = (await query("select parent_private.parent_get_utility_preparation_target($1,$2) value", [s.job.jobId, s.job.leaseToken], "parent_worker")).rows[0].value.inputSetHash;
    return { inputId, reference };
  }
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); fixture = await createParentSqlFixture(modulePath!);
    // Explicit plaintext Vault double. Actual native Vault and credentials are verified separately by the root driver.
    for (const sql of ["create schema vault", "create schema extensions", "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
      "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$"])
      await fixture.admin.query(sql);
  });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.setSystemTime(at); owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '1 day',existing_accounts_enabled=true,water_details_enabled=true,water_details_approval_reference='synthetic only',water_details_approved_until=now()+interval '1 day',water_details_notice_version=$1", [WATER_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false");
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=true,approval_reference='synthetic local only',approved_until=now()+interval '1 hour',policy_version='local-test-policy-v1',retention_policy_version='local-test-retention-v1',max_retention_seconds=300,allowed_purposes=array['account_access','income_proof'],validator_versions=array['synthetic-validator-v1'],preparation_versions=array['local-water-test-v1'] where program_id='pwd-tap'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [session, owner]);
  });
  it("stays independently closed without an approved exact renderer and allocates no key or artifact", async () => {
    const s = await setup(); await fixture.admin.query("update parent_private.utility_protected_policies set preparation_versions='{}' where program_id='pwd-tap'");
    await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where request_id=$1", [s.request])).rows).toEqual([]);
  });
  async function requeue(s: Case) {
    await fixture.admin.query("update public.parent_jobs set state='queued',run_at=clock_timestamp(),lease_token=null,lease_until=null,lease_started_at=null where request_id=$1", [s.request]);
  }
  it("leases independently approved utility preparation without a model key and projects only private-history flags", async () => {
    const s = await setup(); await requeue(s);
    const job = (await query("select parent_private.parent_claim_job(120,true,false,true) value", [], "parent_worker")).rows[0].value;
    expect(job.request.id).toBe(s.request); expect(job.request.has_water_application_details).toBe(true);
    expect(job.request.has_peco_application_details).toBe(false); expect(job.request.has_pgw_application_details).toBe(false); expect(job.documents).toEqual([]);
    expect(JSON.stringify(job)).not.toMatch(/WaterPrivateCanary|propertyAddress|grossMonthlyIncome|keyBase64|ciphertext/);
  });
  it("leaves utility work queued for a configured utility worker when the no-model worker only has SNAP or neither port", async () => {
    const s = await setup(); await requeue(s);
    expect((await query("select parent_private.parent_claim_job(120,true) value", [], "parent_worker")).rows[0].value).toBeNull();
    expect((await query("select parent_private.parent_claim_job(120,true,false,false) value", [], "parent_worker")).rows[0].value).toBeNull();
    const job = (await query("select parent_private.parent_claim_job(120,true,false,true) value", [], "parent_worker")).rows[0].value;
    expect(job.request.id).toBe(s.request);
  });
  it.each(["policy", "renderer", "approval", "private_purpose", "ordinary_case", "attempt_budget", "paused"])("does not lease %s as deterministic private utility work", async kind => {
    const s = await setup(); await requeue(s);
    if (kind === "policy") await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false where program_id='pwd-tap'");
    if (kind === "renderer") await fixture.admin.query("update parent_private.utility_protected_policies set preparation_versions='{}' where program_id='pwd-tap'");
    if (kind === "approval") await fixture.admin.query("update parent_private.utility_protected_policies set approved_until=clock_timestamp()-interval '1 second' where program_id='pwd-tap'");
    if (kind === "private_purpose") await fixture.admin.query("update parent_private.processing_controls set water_details_enabled=false");
    if (kind === "ordinary_case") await fixture.admin.query("delete from public.parent_water_application_details where request_id=$1", [s.request]);
    if (kind === "attempt_budget") await fixture.admin.query("update public.parent_jobs set attempts=48 where request_id=$1", [s.request]);
    if (kind === "paused") await query("select public.parent_control_request($1,'pause')", [s.request], "authenticated");
    expect((await query("select parent_private.parent_claim_job(120,true,false,true) value", [], "parent_worker")).rows[0].value).toBeNull();
  });
  it("runs the same shared worker through restricted SQL, private encrypted seal and unknown-response reconciliation with no model or provider", async () => {
    const s = await setup(); await requeue(s);
    const privatePrepare = vi.fn(async (input: {jobId: string; leaseToken: string; inputSetHash: string}) => {
      s.job = { ...s.job, jobId: input.jobId, leaseToken: input.leaseToken }; s.spec.inputSetHash = input.inputSetHash;
      await prepare(s); throw new Error("PRIVATE_LOST_RESPONSE_CANARY");
    });
    const coordinate = vi.fn(), fetcher = vi.fn();
    expect(await runOneParentJob({ database: { query: (sql, values) => query(sql, values, "parent_worker") }, continuationOnly: true,
      brokerOrigin: "http://127.0.0.1:3310", brokerSecret: "synthetic-worker-broker-secret-32-characters", supabaseOrigin: "http://127.0.0.1:55321",
      protectedUtilityPreparation: { prepare: privatePrepare }, now: () => new Date(), coordinate, fetcher })).toEqual({ state: "saved" });
    expect(privatePrepare).toHaveBeenCalledTimes(1); expect(coordinate).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    const rows = (await fixture.admin.query("select * from public.parent_operations where request_id=$1", [s.request])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].action).toBe("prepare"); expect(rows[0].state).toBe("prepared");
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_|WaterPrivateCanary|propertyAddress|keyBase64|ciphertext/);
    const result = await ownerRead(s, rows[0].packet.protectedUtilityPacket.packetId), key = Buffer.from(result.keyBase64,"base64");
    expect(Buffer.from(openUtilityPreparedArtifact({binding:result.binding,iv:Buffer.from(result.iv,"base64"),tag:Buffer.from(result.tag,"base64"),ciphertext:Buffer.from(result.ciphertext,"base64")},key,new Date()))).toEqual(Buffer.from(bytes)); key.fill(0);
    const request = (await fixture.admin.query("select plan,required_actions from public.parent_requests where id=$1",[s.request])).rows[0];
    expect(request.plan.routes[0]).toMatchObject({state:"prepared",limitation:expect.stringContaining("CaseLink LOCAL TEST")}); expect(request.required_actions).toEqual([]);
    expect((await fixture.admin.query("select * from public.parent_form_artifacts where request_id=$1",[s.request])).rows).toEqual([]);
    expect((await fixture.admin.query("select * from public.parent_receipts where request_id=$1",[s.request])).rows).toEqual([]);
  });
  it("seals exact encrypted bytes and one existing-engine preparation operation without ordinary PII, files or receipts", async () => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket, result = await ownerRead(s, packet.packetId), key = Buffer.from(result.keyBase64, "base64");
    expect(Buffer.from(utilityPreparedAad(result.binding))).toEqual(Buffer.from(result.aad.replaceAll("\n", ""), "base64"));
    expect(Buffer.from(openUtilityPreparedArtifact({ binding: result.binding, iv: Buffer.from(result.iv, "base64"), tag: Buffer.from(result.tag, "base64"), ciphertext: Buffer.from(result.ciphertext, "base64") }, key, new Date()))).toEqual(Buffer.from(bytes)); key.fill(0);
    expect(packet.expiresAt).toBe("2026-11-13T22:26:00.000Z");
    const ordinary = (await query("select parent_private.parent_get_operations($1,$2) value", [s.job.jobId, s.job.leaseToken], "parent_worker")).rows[0].value;
    expect(utilityProtectedOperationSchema.parse({ ...binding.operation, protectedPacketCurrent: ordinary[0].protectedPacketCurrent }).protectedPacketCurrent).toBe(true);
    expect(JSON.stringify(ordinary)).not.toMatch(/PRIVATE_WATER|WaterPrivateCanary|100 Synthetic Lane|keyBase64|ciphertext|vault/);
    expect((await fixture.admin.query("select id from public.parent_form_artifacts where request_id=$1", [s.request])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from public.parent_receipts where request_id=$1", [s.request])).rows).toEqual([]);
  });
  it("rolls back an unsealed object and key instead of permitting a pending artifact to commit", async () => {
    const s = await setup(), before = (await fixture.admin.query("select count(*) n from vault.secrets")).rows[0].n;
    await fixture.admin.query("begin"); inTransaction = true; await begin(s);
    await expect(fixture.admin.query("commit")).rejects.toBeTruthy(); await fixture.admin.query("rollback");
    inTransaction = false;
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where request_id=$1", [s.request])).rows).toEqual([]);
    expect((await fixture.admin.query("select count(*) n from vault.secrets")).rows[0].n).toBe(before);
  });
  it("reconciles exact bytes/key once, preserves original expiry, and rejects a new file under the same preparation identity", async () => {
    const s = await setup(), first = await prepare(s); vi.setSystemTime(new Date(at.getTime() + 10000));
    s.spec.expiresAt = "2026-11-13T22:45:00Z"; expect(await prepare(s)).toEqual(first);
    s.spec.contentSha256 = "f".repeat(64); await expect(prepare(s)).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where request_id=$1", [s.request])).rows).toHaveLength(1);
  });
  it("finds actual current preparation metadata before unknown-response retry and never grants this private lookup to an ordinary worker", async () => {
    const s = await setup();
    expect((await query("select parent_private.parent_find_utility_prepared_operation($1,$2,$3) value", [s.job.jobId, s.job.leaseToken, s.spec.inputSetHash])).rows[0].value).toBeNull();
    const binding = await prepare(s);
    expect((await query("select parent_private.parent_find_utility_prepared_operation($1,$2,$3) value", [s.job.jobId, s.job.leaseToken, s.spec.inputSetHash])).rows[0].value).toEqual(binding.operation);
    await expect(query("select parent_private.parent_find_utility_prepared_operation($1,$2,$3)", [s.job.jobId, s.job.leaseToken, s.spec.inputSetHash], "parent_worker")).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["anon", "authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])("denies raw artifact/key access and sealing to %s", async role => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    await expect(query("select * from parent_private.utility_prepared_artifacts", [], role)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select parent_private.parent_read_utility_prepared_artifact($1,$2,$3)", [packet, owner, s.request], role)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select parent_private.parent_begin_utility_prepared_artifact($1,$2,$3)", [s.job.jobId, s.job.leaseToken, JSON.stringify(s.spec)], role)).rejects.toMatchObject({ code: "42501" });
  });
  it("denies a foreign owner/case and leaves no direct Vault or table access for the isolated group", async () => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    await expect(ownerRead(s, packet, randomUUID())).rejects.toMatchObject({ code: "42501" });
    await expect(ownerRead({ ...s, request: randomUUID() }, packet)).rejects.toMatchObject({ code: "42501" });
    await expect(query("select * from vault.decrypted_secrets")).rejects.toMatchObject({ code: "42501" });
    await expect(query("select * from parent_private.utility_prepared_artifacts")).rejects.toMatchObject({ code: "42501" });
  });
  it("caps the artifact at original protected-input consent expiry and blocks revoked inputs without relabeling validation", async () => {
    const s = await setup(), input = await accountInput(s), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket;
    expect(packet.expiresAt).toBe(new Date(input.reference.expiresAt).toISOString());
    expect(packet.inputs).toEqual([{ inputId: input.inputId, authorizationId: input.reference.authorizationId, validationId: null }]);
    await query("select public.parent_revoke_utility_protected_input($1,$2)", [s.request, input.inputId], "authenticated");
    await expect(ownerRead(s, packet.packetId)).rejects.toMatchObject({ code: "42501" });
  });
  it("allows paused unchanged owner inspection while strict processing is no longer current", async () => {
    const s = await setup(); await accountInput(s); const binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    await query("select public.parent_control_request($1,'pause')", [s.request], "authenticated");
    expect((await ownerRead(s, packet)).binding.operation).toEqual(binding.operation);
    const checked = (await query("select parent_private.parent_check_utility_prepared_artifact($1,$2,$3) value", [packet, owner, s.request])).rows[0].value;
    expect(checked.protectedPacketCurrent).toBe(false);
    await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
  });
  it("does not require a retained parent session for current authorized background preparation", async () => {
    const s = await setup(); await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 hour' where id=$1", [session]);
    expect((await prepare(s)).operation.action).toBe("prepare");
  });
  it("invalidates correction uses, purges the key/ciphertext, and retains only preparation metadata", async () => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    await query("select public.parent_save_water_application_details($1,2,$2,$3,$4,true,true)", [s.request, JSON.stringify({ ...s.snapshot.details, propertyAddress: "Corrected Synthetic Lane" }), WATER_APPLICATION_NOTICE_VERSION, randomUUID()], "authenticated");
    await expect(ownerRead(s, packet)).rejects.toMatchObject({ code: "42501" });
    expect((await query("select parent_private.parent_purge_utility_prepared_artifacts(100) n", [], "parent_retention_worker")).rows[0].n).toBeGreaterThan(0);
    const row = (await fixture.admin.query("select * from parent_private.utility_prepared_artifacts where id=$1", [packet])).rows[0];
    expect(row).toMatchObject({ state: "purged", ciphertext: null, vault_secret_id: null });
    expect(row.operation).toEqual(binding.operation); expect(JSON.stringify(row)).not.toContain("PRIVATE_WATER");
  });
  it.each(["global", "program", "protected", "policy", "mandate", "account", "cancel"])("blocks owner bytes and new preparation after %s authority closes", async condition => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    if (condition === "global") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (condition === "program") await fixture.admin.query("update parent_private.processing_controls set water_details_enabled=false");
    if (condition === "protected") await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false");
    if (condition === "policy") await fixture.admin.query("update parent_private.utility_protected_policies set policy_version='different'");
    if (condition === "mandate") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [s.request]);
    if (condition === "account") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [owner]);
    if (condition === "cancel") await query("select public.parent_control_request($1,'cancel')", [s.request], "authenticated");
    await expect(ownerRead(s, packet)).rejects.toMatchObject({ code: "42501" }); await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["sample", "official_water", "renderer", "job", "raw_input"])("rejects unsupported %s construction without leaving another artifact or operation", async change => {
    const s = await setup();
    if (change === "sample") s.spec.source.sha256 = WATER_APPLICATION_REFERENCE.sampleSha256;
    if (change === "official_water") s.spec.source.kind = "official_public_form";
    if (change === "renderer") s.spec.source.rendererVersion = "unreviewed-renderer";
    if (change === "job") s.spec.scope.requestId = randomUUID();
    if (change === "raw_input") s.spec.inputs = [{ inputId: randomUUID(), authorizationId: randomUUID(), validationId: null }];
    await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where request_id=$1", [s.request])).rows).toEqual([]);
  });
  it("cannot begin delivery or change a preparation operation into any transport or agency outcome", async () => {
    const s = await setup(), binding = await prepare(s);
    await expect(query("select parent_private.parent_begin_operation($1,$2,$3)", [binding.operation.operationId, s.job.jobId, s.job.leaseToken], "parent_worker")).rejects.toMatchObject({ code: "42501" });
    for (const state of ["executing", "delivery_unknown", "sent", "agency_submitted", "assistance_approved"])
      await expect(fixture.admin.query("update public.parent_operations set state=$2 where id=$1", [binding.operation.operationId, state])).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select state,executed_at from public.parent_operations where id=$1", [binding.operation.operationId])).rows[0]).toEqual({ state: "prepared", executed_at: null });
  });
  it("cascades artifact and Vault-key deletion with the request", async () => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    const keyId = (await fixture.admin.query("select vault_secret_id from parent_private.utility_prepared_artifacts where id=$1", [packet])).rows[0].vault_secret_id;
    await fixture.admin.query("delete from public.parent_requests where id=$1", [s.request]);
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where id=$1", [packet])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from vault.secrets where id=$1", [keyId])).rows).toEqual([]);
    expect((await fixture.admin.query("select id from auth.users where id=$1", [owner])).rows).toHaveLength(1);
  });
  it("invalidates a draft for a late captured scalar and preserves one fresh pass when its worker saves an old loaded plan", async () => {
    const s = await setup(), binding = await prepare(s), oldHash = s.spec.inputSetHash;
    await accountInput(s);
    expect(s.spec.inputSetHash).not.toBe(oldHash);
    expect((await fixture.admin.query("select state from public.parent_operations where id=$1", [binding.operation.operationId])).rows[0].state).toBe("invalidated");
    const pending = (await fixture.admin.query("select state,request_version,lease_token,utility_preparation_wake_lease_token from public.parent_jobs where id=$1", [s.job.jobId])).rows[0];
    expect(pending).toMatchObject({ state: "leased", request_version: 2, lease_token: s.job.leaseToken, utility_preparation_wake_lease_token: s.job.leaseToken });
    await query("select parent_private.parent_save_job_plan($1,$2,2,$3,'[]',null,'caselink','provider_capability_enabled')", [s.job.jobId, s.job.leaseToken, JSON.stringify({ version: 1, routes: [] })], "parent_worker");
    const queued = (await fixture.admin.query("select state,request_version,lease_token,utility_preparation_wake_lease_token from public.parent_jobs where id=$1", [s.job.jobId])).rows[0];
    expect(queued).toEqual({ state: "queued", request_version: 2, lease_token: null, utility_preparation_wake_lease_token: null });
    expect((await fixture.admin.query("select next_actor,next_trigger from public.parent_requests where id=$1", [s.request])).rows[0]).toEqual({ next_actor: "caselink", next_trigger: "route_review_required" });
    await expect(ownerRead(s, binding.operation.packet.protectedUtilityPacket.packetId)).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects a renderer's stale input observation and consumes a wake only after its actual current set is sealed", async () => {
    const s = await setup(), stale = structuredClone(s.spec);
    await accountInput(s); const currentHash = s.spec.inputSetHash;
    await expect(prepare({ ...s, spec: stale })).rejects.toMatchObject({ code: "42501" });
    const binding = await prepare(s);
    expect(binding.inputSetHash).toBe(currentHash);
    expect((await fixture.admin.query("select utility_preparation_wake_lease_token from public.parent_jobs where id=$1", [s.job.jobId])).rows[0].utility_preparation_wake_lease_token).toBeNull();
  });
  it("wakes for a newly trusted source-field validation but not its exact replay, without changing the request version", async () => {
    const s = await setup(); await accountInput(s); const inputId = randomUUID();
    const ref = (await query("select public.parent_authorize_utility_protected_input($1,2,'pwd-tap',$2,1,$3,$4,'income_proof',$5,'application/pdf',$6,$7,true,true,true) value",
      [s.request, s.snapshot.id, s.spec.scope.snapshotHash, inputId, JSON.stringify([{ subjectId: s.applicant, sourceId: s.source, field: "income" }]), bytes.length, UTILITY_PROTECTED_INPUT_NOTICE_VERSION], "authenticated")).rows[0].value;
    await fixture.admin.query("begin"); inTransaction = true;
    try {
      const opened = (await query("select parent_private.parent_begin_utility_protected_input($1) value", [inputId])).rows[0].value, key = Buffer.from(opened.keyBase64, "base64"), digest = utilityProtectedContentDigest(bytes, key);
      const sealed = sealUtilityProtectedInput(bytes, key, { ...opened.binding, contentDigest: digest }, new Date());
      await query("select parent_private.parent_seal_utility_protected_input($1,$2,$3,$4,$5)", [inputId, digest, sealed.iv, sealed.tag, sealed.ciphertext]); await fixture.admin.query("commit"); key.fill(0);
    } catch (error) { await fixture.admin.query("rollback"); throw error; } finally { inTransaction = false; }
    s.spec.inputs.push({ inputId, authorizationId: ref.authorizationId, validationId: null }); s.spec.inputs.sort((a, b) => a.inputId.localeCompare(b.inputId));
    s.spec.inputSetHash = (await query("select parent_private.parent_get_utility_preparation_target($1,$2) value", [s.job.jobId, s.job.leaseToken], "parent_worker")).rows[0].value.inputSetHash;
    const initial = await prepare(s), oldHash = s.spec.inputSetHash;
    // Explicit trusted-validator fixture; this does not parse a pay stub or assert its authenticity/completeness.
    const projection = { version: "synthetic-validator-v1", programId: "pwd-tap", subjectId: s.applicant, sourceId: s.source,
      proofKind: "pay_stub", originalSha256: hash(bytes), currency: "USD", grossCents: 120050, periodStart: "2026-10-15", periodEnd: "2026-11-13", issuedOn: "2026-11-13", payFrequency: "monthly", subjectMatch: "printed_name_matches_authorized_target",
      sourceEvidence: ["grossCents", "periodStart", "periodEnd", "issuedOn"].map((field, index) => ({ field, page: 1, line: index + 1, sourceText: "Synthetic financial source line" })) };
    const validation = (await query("select parent_private.parent_record_utility_protected_validation($1,'synthetic-validator-v1',$2,$3) value", [inputId, JSON.stringify(projection), ref.expiresAt])).rows[0].value;
    expect((await fixture.admin.query("select version from public.parent_requests where id=$1", [s.request])).rows[0].version).toBe(2);
    expect((await fixture.admin.query("select state from public.parent_operations where id=$1", [initial.operation.operationId])).rows[0].state).toBe("invalidated");
    s.spec.inputSetHash = (await query("select parent_private.parent_get_utility_preparation_target($1,$2) value", [s.job.jobId, s.job.leaseToken], "parent_worker")).rows[0].value.inputSetHash;
    expect(s.spec.inputSetHash).not.toBe(oldHash); s.spec.inputs.find(input => input.inputId === inputId)!.validationId = validation.validation.id;
    await prepare(s);
    await query("select parent_private.parent_record_utility_protected_validation($1,'synthetic-validator-v1',$2,$3)", [inputId, JSON.stringify(projection), ref.expiresAt]);
    expect((await fixture.admin.query("select utility_preparation_wake_lease_token from public.parent_jobs where id=$1", [s.job.jobId])).rows[0].utility_preparation_wake_lease_token).toBeNull();
  });
  it("retains an expired artifact tombstone and original expiry instead of refreshing its lifetime on retry", async () => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    vi.setSystemTime(new Date(at.getTime() + 301000));
    await query("select parent_private.parent_purge_utility_prepared_artifacts(100)", [], "parent_retention_worker");
    await expect(ownerRead(s, packet)).rejects.toMatchObject({ code: "42501" });
    s.job = (await query("select parent_private.parent_claim_job(120) value", [], "parent_worker")).rows[0].value;
    expect(s.job.request.id).toBe(s.request); s.spec.expiresAt = "2026-11-13T22:50:00Z";
    await expect(prepare(s)).rejects.toMatchObject({ code: "42501" });
    const retained = (await fixture.admin.query("select state,expires_at,ciphertext,vault_secret_id from parent_private.utility_prepared_artifacts where id=$1", [packet])).rows[0];
    expect(retained).toMatchObject({ state: "purged", ciphertext: null, vault_secret_id: null });
    expect(new Date(retained.expires_at).toISOString()).toBe(binding.operation.packet.protectedUtilityPacket.expiresAt);
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where request_id=$1", [s.request])).rows).toHaveLength(1);
  });
  it("rejects sealing after the real lease deadline inside an already-open transaction whose now() is still earlier", async () => {
    const s = await setup(); await fixture.admin.query("begin"); inTransaction = true;
    try {
      const started = await begin(s), binding = utilityPreparedBindingSchema.parse(started.binding), key = Buffer.from(started.keyBase64, "base64"), sealed = sealUtilityPreparedArtifact(bytes, key, binding, new Date()); key.fill(0);
      vi.setSystemTime(new Date(at.getTime() + 121000));
      const times = (await fixture.admin.query("select now() stable,clock_timestamp() actual")).rows[0];
      expect(new Date(times.stable).toISOString()).toBe(at.toISOString()); expect(new Date(times.actual).getTime()).toBeGreaterThan(at.getTime() + 120000);
      expect(Date.parse(binding.operation.packet.protectedUtilityPacket.expiresAt)).toBeGreaterThan(Date.now());
      await expect(query("select parent_private.parent_seal_utility_prepared_artifact($1,$2,$3,$4,$5,$6)", [s.job.jobId, s.job.leaseToken, binding.operation.packet.protectedUtilityPacket.packetId, sealed.iv, sealed.tag, sealed.ciphertext])).rejects.toMatchObject({ code: "42501" });
    } finally { await fixture.admin.query("rollback"); inTransaction = false; }
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where request_id=$1", [s.request])).rows).toEqual([]);
  });
  it("uses real lease time for begin, current metadata, target and recovery lookup inside an old transaction", async () => {
    const s = await setup(), binding = await prepare(s); await fixture.admin.query("begin"); inTransaction = true;
    try {
      vi.setSystemTime(new Date(at.getTime() + 121000));
      await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
      await expect(query("select parent_private.parent_get_utility_prepared_operation($1,$2,$3)", [s.job.jobId, s.job.leaseToken, binding.operation.packet.protectedUtilityPacket.packetId])).rejects.toMatchObject({ code: "42501" });
      await expect(query("select parent_private.parent_get_utility_preparation_target($1,$2)", [s.job.jobId, s.job.leaseToken])).rejects.toMatchObject({ code: "42501" });
      await expect(query("select parent_private.parent_find_utility_prepared_operation($1,$2,$3)", [s.job.jobId, s.job.leaseToken, s.spec.inputSetHash])).rejects.toMatchObject({ code: "42501" });
    } finally { await fixture.admin.query("rollback"); inTransaction = false; }
  });
  it("rejects a numeric hash before allocating an encrypted draft even when JSON numeric text has 64 digits", async () => {
    const s = await setup(); await fixture.admin.query("begin"); inTransaction = true;
    try {
      await expect(query("select parent_private.parent_begin_utility_prepared_artifact($1,$2,$3)", [s.job.jobId, s.job.leaseToken, JSON.stringify({ ...s.spec, contentSha256: 1e63 })])).rejects.toMatchObject({ code: "23514" });
    } finally { await fixture.admin.query("rollback"); inTransaction = false; }
    expect((await fixture.admin.query("select id from parent_private.utility_prepared_artifacts where request_id=$1", [s.request])).rows).toEqual([]);
  });
  it("does not erase an unexpired valid artifact or key when an authority check has a transient lock failure", async () => {
    const s = await setup(), binding = await prepare(s), packet = binding.operation.packet.protectedUtilityPacket.packetId;
    const original = (await fixture.admin.query("select pg_get_functiondef('parent_private.utility_prepared_authority(uuid,boolean)'::regprocedure) definition")).rows[0].definition as string;
    const before = (await fixture.admin.query("select state,vault_secret_id,ciphertext from parent_private.utility_prepared_artifacts where id=$1", [packet])).rows[0];
    const injected = original.replace(/\nbegin\n/i, `\nbegin\n  if p_packet='${packet}'::uuid then raise exception 'synthetic transient lock' using errcode='55P03'; end if;\n`);
    expect(injected).not.toBe(original);
    await fixture.admin.query(injected);
    try {
      await expect(query("select parent_private.parent_purge_utility_prepared_artifacts(100)", [], "parent_retention_worker")).rejects.toMatchObject({ code: "55P03" });
      expect((await fixture.admin.query("select state,vault_secret_id,ciphertext from parent_private.utility_prepared_artifacts where id=$1", [packet])).rows[0]).toEqual(before);
      expect((await fixture.admin.query("select id from vault.secrets where id=$1", [before.vault_secret_id])).rows).toHaveLength(1);
    } finally { await fixture.admin.query(original); }
    expect((await ownerRead(s, packet)).binding.operation).toEqual(binding.operation);
  });
});
