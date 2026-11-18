import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { PECO_APPLICATION_NOTICE_VERSION } from "./peco-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION } from "./water-application-fields";
import { PGW_APPLICATION_NOTICE_VERSION } from "./pgw-application-fields";
import { UTILITY_PROTECTED_INPUT_NOTICE_VERSION, utilityProtectedBindingSchema, utilityProtectedInputAad, utilityProtectedInputReferenceSchema } from "./utility-protected-input-contract";
import { openUtilityProtectedInput, sealUtilityProtectedInput, utilityProtectedAccountFingerprint, utilityProtectedContentDigest } from "./utility-protected-input";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE, at = new Date("2026-11-13T22:10:00Z");
type Scope = { owner: string; session: string; request: string; version: number; snapshot: string; hash: string; subject: string; source: string };
describe.skipIf(!modulePath)("utility protected input PostgreSQL boundaries (explicit non-cryptographic Vault double)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  async function tx<T>(action: () => Promise<T>) { await fixture.admin.query("begin"); try { const result = await action(); await fixture.admin.query("commit"); return result; } catch (error) { await fixture.admin.query("rollback"); throw error; } }
  async function role(s: Scope, role: string, sql: string, values: unknown[] = []) {
    await fixture.admin.query("savepoint call_role");
    try {
      await fixture.admin.query(`set local role ${role}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: s.owner, session_id: s.session, role, amr: [{ method: "otp" }] })]);
      const result = await fixture.admin.query(sql, values); await fixture.admin.query("reset role"); await fixture.admin.query("release savepoint call_role"); return result;
    } catch (error) { await fixture.admin.query("rollback to savepoint call_role"); await fixture.admin.query("release savepoint call_role"); throw error; }
  }
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); fixture = await createParentSqlFixture(modulePath!);
    // Fake keys are plaintext in this fixture; native Vault remains a separate required proof.
    for (const sql of ["create schema vault", "create schema extensions", "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
      "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$"])
      await fixture.admin.query(sql);
  });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  async function setup(documents = true): Promise<Scope> {
    const s: Scope = { owner: randomUUID(), session: randomUUID(), request: "", snapshot: "", hash: "", version: 2, subject: randomUUID(), source: randomUUID() };
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic protected SQL test',approved_until=now()+interval '1 day',existing_accounts_enabled=true,peco_details_enabled=true,peco_details_approval_reference='synthetic only',peco_details_approved_until=now()+interval '1 day',peco_details_notice_version=$1", [PECO_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [s.owner, `${s.owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [s.session, s.owner]);
    s.request = (await tx(() => role(s, "authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["electricity"], utilityProviders: ["peco"], accountAuthority: "self" })),
      JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: ["peco-cap"], allowedActions: ["research", "prepare"], allowedData: documents ? ["household", "income", "utility", "documents"] : ["household", "income", "utility"], expiresAt: new Date(at.getTime() + 86400000).toISOString() })), randomUUID()]))).rows[0].id as string;
    s.snapshot = (await tx(() => role(s, "authenticated", "select public.parent_save_peco_application_details($1,1,$2,$3,$4,true,true) id", [s.request, JSON.stringify({ accountNumber: "9000000001", applicant: { id: s.subject, firstName: "PrivateCanary", lastName: "Example", dateOfBirth: "1990-01-01", income: { state: "sources", sources: [{ id: s.source, kind: "employment" }] } } }), PECO_APPLICATION_NOTICE_VERSION, randomUUID()]))).rows[0].id as string;
    s.hash = (await fixture.admin.query("select consent_evidence->>'detailsSha256' hash from public.parent_peco_application_details where id=$1", [s.snapshot])).rows[0].hash as string;
    return s;
  }
  async function enable() { await fixture.admin.query("update parent_private.utility_protected_policies set enabled=true,approval_reference='synthetic local only, no policy activation',approved_until=now()+interval '1 hour',policy_version='synthetic-1',retention_policy_version='synthetic-1',max_retention_seconds=300,allowed_purposes=array['income_proof'],validator_versions=array['synthetic-validator-1'] where program_id='peco-cap'"); }
  const authorize = (s: Scope, input = randomUUID(), changes: { purpose?: string; targets?: unknown; consent?: boolean; subject?: boolean; account?: boolean } = {}) => tx(() => role(s, "authenticated", "select public.parent_authorize_utility_protected_input($1,$2,'peco-cap',$3,1,$4,$5,$6,$7,'application/pdf',25,$8,$9,$10,$11) value",
    [s.request, s.version, s.snapshot, s.hash, input, changes.purpose ?? "income_proof", JSON.stringify(changes.targets ?? [{ subjectId: s.subject, sourceId: s.source, field: "income" }]), UTILITY_PROTECTED_INPUT_NOTICE_VERSION, changes.consent ?? true, changes.subject ?? true, changes.account ?? true]));
  const payload = Buffer.from("SYNTHETIC PRIVATE BYTES!!");
  async function seal(s: Scope, inputId: string, data = payload) {
      const start = (await role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_input($1) value", [inputId])).rows[0].value as { binding: object; keyBase64: string };
      const key = Buffer.from(start.keyBase64, "base64"), binding = utilityProtectedBindingSchema.parse({ ...start.binding, contentDigest: utilityProtectedContentDigest(data, key) });
      const sealed = sealUtilityProtectedInput(data, key, binding, at);
      const saved = (await role(s, "parent_utility_protected", "select parent_private.parent_seal_utility_protected_input($1,$2,$3,$4,$5) value", [inputId, binding.contentDigest, sealed.iv, sealed.tag, sealed.ciphertext])).rows[0].value;
      expect(saved).toEqual(binding); key.fill(0); return binding;
  }
  const store = (s: Scope, inputId: string) => tx(() => seal(s, inputId));
  const identifierBytes = (value = "FICTIONAL-PGW-OLD") => Buffer.from(JSON.stringify({ purpose: "required_identifier", type: "passport", value }));
  async function setupPgw() {
    const s = await setup(), customer = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set pgw_details_enabled=true,pgw_details_approval_reference='synthetic only',pgw_details_approved_until=now()+interval '1 day',pgw_details_notice_version=$1", [PGW_APPLICATION_NOTICE_VERSION]);
    s.request = (await tx(() => role(s, "authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["gas"], utilityProviders: ["pgw"], accountAuthority: "self" })),
      JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: ["pgw-crp"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"], expiresAt: new Date(at.getTime() + 86400000).toISOString() })), randomUUID()]))).rows[0].id as string;
    s.snapshot = (await tx(() => role(s, "authenticated", "select public.parent_save_pgw_application_details($1,1,$2,$3,$4,true,true) id", [s.request, JSON.stringify({ accountNumber: "9000000001", customer: { id: customer, firstName: "Fictional", lastName: "Customer" }, householdMembers: [{ id: s.subject, firstName: "Fictional", lastName: "Member", dateOfBirth: "2015-01-01" }] }), PGW_APPLICATION_NOTICE_VERSION, randomUUID()]))).rows[0].id as string;
    s.hash = (await fixture.admin.query("select consent_evidence->>'detailsSha256' hash from public.parent_pgw_application_details where id=$1", [s.snapshot])).rows[0].hash as string;
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '1 hour',policy_version='synthetic-1',retention_policy_version='synthetic-1',max_retention_seconds=300,allowed_purposes=array['required_identifier'] where program_id='pgw-crp'");
    return { ...s, customer };
  }
  const authorizePgw = (s: Scope, input: string, replaces?: string, targets = [{ subjectId: s.subject, sourceId: null, field: "pgw_household_identifier" }]) => tx(() => role(s, "authenticated",
    `select public.${replaces ? "parent_authorize_utility_identifier_replacement" : "parent_authorize_utility_protected_input"}($1,$2,'pgw-crp',$3,1,$4,$5,'required_identifier',$6,'application/octet-stream',$7,$8,true,true,true${replaces ? ",$9" : ""}) value`,
    [s.request, s.version, s.snapshot, s.hash, input, JSON.stringify(targets), identifierBytes().length, UTILITY_PROTECTED_INPUT_NOTICE_VERSION, ...(replaces ? [replaces] : [])]));
  async function readPgw(s: Scope, input: string) {
    const value = (await tx(() => role(s, "parent_utility_protected", "select parent_private.parent_read_utility_protected_input($1,false) value", [input]))).rows[0].value as { binding: unknown; keyBase64: string; iv: string; tag: string; ciphertext: string };
    const bytes = openUtilityProtectedInput({ binding: value.binding, iv: Buffer.from(value.iv, "base64"), tag: Buffer.from(value.tag, "base64"), ciphertext: Buffer.from(value.ciphertext, "base64") }, Buffer.from(value.keyBase64, "base64"), at);
    try { return JSON.parse(Buffer.from(bytes).toString()); } finally { bytes.fill(0); }
  }
  it("replaces only the exact PGW member identifier after a successful new seal, preserving the old original until then", async () => {
    const s = await setupPgw(), old = randomUUID(), next = randomUUID(); await authorizePgw(s, old); await tx(() => seal(s, old, identifierBytes()));
    const replacement = (await authorizePgw(s, next, old)).rows[0].value;
    expect(replacement).toMatchObject({ inputId: next, state: "authorized" }); expect(await readPgw(s, old)).toHaveProperty("value", "FICTIONAL-PGW-OLD");
    expect((await authorizePgw(s, next, old)).rows[0].value).toEqual(replacement);
    await expect(authorizePgw(s, next)).rejects.toMatchObject({ code: "PT409" });
    await tx(() => seal(s, next, identifierBytes("FICTIONAL-PGW-NEW")));
    expect(await readPgw(s, next)).toHaveProperty("value", "FICTIONAL-PGW-NEW");
    await expect(readPgw(s, old)).rejects.toMatchObject({ code: "42501" });
    expect((await authorizePgw(s, next, old)).rows[0].value).toMatchObject({ inputId: next, state: "stored" });
    expect((await fixture.admin.query("select version from public.parent_requests where id=$1", [s.request])).rows[0].version).toBe(s.version);
  });
  it("rolls back an incomplete replacement and its temporary key without revoking the old value", async () => {
    const s = await setupPgw(), old = randomUUID(), next = randomUUID(); await authorizePgw(s, old); await tx(() => seal(s, old, identifierBytes())); await authorizePgw(s, next, old);
    const count = (await fixture.admin.query("select count(*)::int n from vault.secrets")).rows[0].n;
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_input($1)", [next]))).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select count(*)::int n from vault.secrets")).rows[0].n).toBe(count);
    expect(await readPgw(s, old)).toHaveProperty("value", "FICTIONAL-PGW-OLD");
    expect((await authorizePgw(s, next, old)).rows[0].value).toMatchObject({ state: "authorized" });
    await tx(() => seal(s, next, identifierBytes("FICTIONAL-PGW-NEW"))); expect(await readPgw(s, next)).toHaveProperty("value", "FICTIONAL-PGW-NEW");
  });
  it("serializes competing replacement intents so a later seal cannot silently replace the newly chosen value", async () => {
    const s = await setupPgw(), old = randomUUID(), first = randomUUID(), second = randomUUID(); await authorizePgw(s, old); await tx(() => seal(s, old, identifierBytes()));
    await authorizePgw(s, first, old); await authorizePgw(s, second, old);
    await tx(() => seal(s, first, identifierBytes("FICTIONAL-PGW-NEW")));
    await expect(tx(() => seal(s, second, identifierBytes("FICTIONAL-PGW-ALT")))).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.utility_protected_inputs where input_id=$1", [second])).rows[0].n).toBe(0);
    expect(await readPgw(s, first)).toHaveProperty("value", "FICTIONAL-PGW-NEW");
    await expect(authorizePgw(s, second, old)).rejects.toMatchObject({ code: "PT409" });
  });
  it("blocks competing initial captures, customer identity collection, foreign targets and replacement-intent changes", async () => {
    const s = await setupPgw(), old = randomUUID(), parallel = randomUUID(); await authorizePgw(s, old); await authorizePgw(s, parallel); await tx(() => seal(s, old, identifierBytes()));
    await expect(tx(() => seal(s, parallel, identifierBytes("FICTIONAL-PGW-ALT")))).rejects.toMatchObject({ code: "PT409" });
    await expect(authorizePgw(s, randomUUID())).rejects.toMatchObject({ code: "PT409" });
    await expect(authorizePgw(s, randomUUID(), old, [{ subjectId: s.customer, sourceId: null, field: "pgw_household_identifier" }])).rejects.toMatchObject({ code: "42501" });
    const next = randomUUID(); await authorizePgw(s, next, old);
    await expect(authorizePgw(s, next, randomUUID())).rejects.toMatchObject({ code: "PT409" });
    await expect(authorizePgw(s, randomUUID(), old, [{ subjectId: randomUUID(), sourceId: null, field: "pgw_household_identifier" }])).rejects.toMatchObject({ code: "42501" });
    for (const name of ["authenticated", "anon", "service_role", "parent_worker", "parent_utility_protected", "parent_retention_worker"])
      await expect(tx(() => role(s, name, "select * from parent_private.utility_identifier_capture_intents"))).rejects.toMatchObject({ code: "42501" });
    await expect(tx(() => role(s, "authenticated", "select parent_private.authorize_utility_protected_input_base($1,2,'pgw-crp',$2,1,$3,$4,'required_identifier',$5,'application/octet-stream',$6,$7,true,true,true)", [s.request, s.snapshot, s.hash, randomUUID(), JSON.stringify([{ subjectId: s.subject, sourceId: null, field: "pgw_household_identifier" }]), identifierBytes().length, UTILITY_PROTECTED_INPUT_NOTICE_VERSION]))).rejects.toMatchObject({ code: "42501" });
  });
  it("revokes the replaced original and all of its compatible reused copies while preserving the new lineage", async () => {
    const s = await setupPgw(), old = randomUUID(), copy = randomUUID(), next = randomUUID(); await authorizePgw(s, old); await tx(() => seal(s, old, identifierBytes()));
    await tx(() => role(s, "authenticated", "select public.parent_correct_request($1,$2,2)", [s.request, JSON.stringify(fixtureIntake({ needs: ["gas"], utilityProviders: ["pgw"], accountAuthority: "self", zip: "19105" }))])); s.version = 3;
    await tx(async () => { await role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_rebind($1,$2,3,$3,1,$4)", [old, copy, s.snapshot, s.hash]); await seal(s, copy, identifierBytes()); });
    await authorizePgw(s, next, copy); await tx(() => seal(s, next, identifierBytes("FICTIONAL-PGW-NEW")));
    for (const input of [old, copy]) await expect(readPgw(s, input)).rejects.toMatchObject({ code: "42501" });
    expect(await readPgw(s, next)).toHaveProperty("value", "FICTIONAL-PGW-NEW");
    const rows = (await fixture.admin.query("select input_id,revoked_at is not null revoked from parent_private.utility_protected_authorizations where request_id=$1 order by input_id", [s.request])).rows;
    expect(rows.filter(row => row.revoked).map(row => row.input_id).sort()).toEqual([old, copy].sort());
  });
  it("does not background-recopy an obsolete PGW identifier when a current exact-person value already exists", async () => {
    const s = await setupPgw(), old = randomUUID(), current = randomUUID(); await authorizePgw(s, old); await tx(() => seal(s, old, identifierBytes()));
    await tx(() => role(s, "authenticated", "select public.parent_correct_request($1,$2,2)", [s.request, JSON.stringify(fixtureIntake({ needs: ["gas"], utilityProviders: ["pgw"], accountAuthority: "self", zip: "19105" }))])); s.version = 3;
    await authorizePgw(s, current); await tx(() => seal(s, current, identifierBytes("FICTIONAL-PGW-NEW")));
    await fixture.admin.query("update public.parent_jobs set state='cancelled',lease_token=null,lease_until=null where request_id<>$1", [s.request]);
    const lease = (await tx(() => role(s, "parent_worker", "select parent_private.parent_claim_job(120) value"))).rows[0].value as { jobId: string; leaseToken: string };
    const candidates = (await tx(() => role(s, "parent_utility_protected", "select parent_private.parent_get_utility_reuse_candidates($1,$2,$3,3,'pgw-crp',$4,1,$5) value", [lease.jobId, lease.leaseToken, s.request, s.snapshot, s.hash]))).rows[0].value;
    expect(candidates).toEqual([]); expect(await readPgw(s, current)).toHaveProperty("value", "FICTIONAL-PGW-NEW");
  });
  it("defaults closed independently of SNAP/WIC, and requires document scope and all exact consent evidence", async () => {
    const s = await setup(); await fixture.admin.query("update parent_private.processing_controls set snap_protected_enabled=true,wic_details_enabled=true");
    await expect(authorize(s)).rejects.toMatchObject({ code: "42501" }); await enable();
    for (const flag of ["consent", "subject", "account"]) await expect(authorize(s, randomUUID(), { [flag]: false })).rejects.toMatchObject({ code: "42501" });
    const ref = utilityProtectedInputReferenceSchema.parse((await authorize(s)).rows[0].value); expect(ref).toMatchObject({ ownerId: s.owner, requestId: s.request, state: "authorized", validation: null });
    expect(Date.parse(ref.expiresAt) - Date.parse(ref.consentedAt)).toBe(300000);
    const noDocuments = await setup(false); await enable(); await expect(authorize(noDocuments)).rejects.toMatchObject({ code: "42501" });
  });
  it("binds exact current snapshot/person/source, rejects cross-source pairs and unsupported identity-image collection", async () => {
    const s = await setup(); await enable();
    for (const targets of [[{ subjectId: randomUUID(), sourceId: s.source, field: "income" }], [{ subjectId: s.subject, sourceId: randomUUID(), field: "income" }], [{ subjectId: s.subject, sourceId: null, field: "income" }]])
      await expect(authorize(s, randomUUID(), { targets })).rejects.toMatchObject({ code: "42501" });
    await expect(authorize(s, randomUUID(), { purpose: "identity_proof" })).rejects.toMatchObject({ code: "42501" });
    const id = randomUUID(), first = (await authorize(s, id)).rows[0].value; expect((await authorize(s, id)).rows[0].value).toEqual(first);
    await expect(authorize({ ...s, hash: "a".repeat(64) })).rejects.toMatchObject({ code: "42501" });
  });
  it("seals atomically with exact SQL/Node AAD and never exposes plaintext/keys to ordinary roles or routine data", async () => {
    const s = await setup(); await enable(); const id = randomUUID(); await authorize(s, id); const binding = await store(s, id);
    const value = (await tx(() => role(s, "parent_utility_protected", "select parent_private.parent_read_utility_protected_input($1,true) value", [id]))).rows[0].value as { binding: unknown; keyBase64: string; aad: string; iv: string; tag: string; ciphertext: string };
    const listSql = "select parent_private.parent_list_utility_protected_inputs($1,$2,'peco-cap',$3,1,$4) value", listArgs = [s.request, s.version, s.snapshot, s.hash];
    expect((await tx(() => role(s, "parent_utility_protected", listSql, listArgs))).rows[0].value).toEqual([expect.objectContaining({ inputId: id, state: "stored", validation: null })]);
    await expect(tx(() => role(s, "parent_utility_protected", listSql, [s.request, s.version, s.snapshot, "f".repeat(64)]))).rejects.toMatchObject({ code: "42501" });
    expect(Buffer.from(value.aad, "base64")).toEqual(Buffer.from(utilityProtectedInputAad(binding)));
    const bytes = openUtilityProtectedInput({ binding: value.binding, iv: Buffer.from(value.iv, "base64"), tag: Buffer.from(value.tag, "base64"), ciphertext: Buffer.from(value.ciphertext, "base64") }, Buffer.from(value.keyBase64, "base64"), at);
    expect(Buffer.from(bytes)).toEqual(payload); bytes.fill(0);
    const ordinary = (await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [s.request])).rows[0].value;
    expect(JSON.stringify(ordinary)).not.toMatch(/PrivateCanary|SYNTHETIC PRIVATE|keyBase64|contentDigest/);
    for (const roleName of ["authenticated", "anon", "service_role", "parent_worker", "parent_storage_broker", "parent_snap_finalizer", "parent_retention_worker"]) {
      await expect(tx(() => role(s, roleName, "select * from parent_private.utility_protected_inputs"))).rejects.toMatchObject({ code: "42501" });
      await expect(tx(() => role(s, roleName, "select parent_private.parent_read_utility_protected_input($1,false)", [id]))).rejects.toMatchObject({ code: "42501" });
      await expect(tx(() => role(s, roleName, listSql, listArgs))).rejects.toMatchObject({ code: "42501" });
    }
    const metadata = (await tx(() => role(s, "authenticated", "select public.parent_get_utility_protected_inputs($1) value", [s.request]))).rows[0].value;
    expect(JSON.stringify(metadata)).not.toMatch(/PrivateCanary|SYNTHETIC PRIVATE|keyBase64|contentDigest|ciphertext|mediaType/);
  });
  it("rejects pending commit, altered sealed rows and retained-cookie writes after purpose closure", async () => {
    const s = await setup(); await enable(); const id = randomUUID(); await authorize(s, id);
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_input($1)", [id]))).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.utility_protected_inputs where input_id=$1", [id])).rows[0].n).toBe(0);
    await store(s, id); await expect(fixture.admin.query("update parent_private.utility_protected_inputs set ciphertext='x' where input_id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false where program_id='peco-cap'");
    await expect(authorize(s, id)).rejects.toMatchObject({ code: "42501" });
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_read_utility_protected_input($1,false)", [id]))).rejects.toMatchObject({ code: "42501" });
    expect((await tx(() => role(s, "authenticated", "select public.parent_get_utility_protected_inputs($1) value", [s.request]))).rows[0].value).toHaveLength(1);
  });
  it("invalidates correction/revocation uses and purges keys independently of closed processing controls", async () => {
    const s = await setup(); await enable(); const id = randomUUID(); await authorize(s, id); await store(s, id);
    const keyId = (await fixture.admin.query("select vault_secret_id id from parent_private.utility_protected_inputs where input_id=$1", [id])).rows[0].id;
    await tx(() => role(s, "authenticated", "select public.parent_revoke_utility_protected_input($1,$2)", [s.request, id]));
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [s.request])).rows[0].version;
    await tx(() => role(s, "authenticated", "select public.parent_revoke_utility_protected_input($1,$2)", [s.request, id]));
    expect((await fixture.admin.query("select version from public.parent_requests where id=$1", [s.request])).rows[0].version).toBe(version);
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_read_utility_protected_input($1,true)", [id]))).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    // Global retention also erases expired inputs from earlier fixtures in this database.
    expect((await tx(() => role(s, "parent_retention_worker", "select parent_private.parent_purge_utility_protected_inputs(100) n"))).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await fixture.admin.query("select count(*)::int n from vault.secrets where id=$1", [keyId])).rows[0].n).toBe(0);
    expect((await tx(() => role(s, "parent_retention_worker", "select parent_private.parent_purge_utility_protected_inputs(100) n"))).rows[0].n).toBe(0);
  });
  it("gives the owner only exact named targets, permits paused capture and hides capture when the purpose closes", async () => {
    const s = await setup(); await enable();
    const workspace = () => tx(() => role(s, "authenticated", "select public.parent_get_utility_protected_workspace($1,$2) value", [s.request, s.version]));
    expect((await workspace()).rows[0].value).toMatchObject({ collectionEnabled: true, programId: "peco-cap", programLabel: "PECO CAP", scope: { snapshotId: s.snapshot, snapshotHash: s.hash },
      targets: [{ purpose: "income_proof", target: { subjectId: s.subject, sourceId: s.source, field: "income" }, displayName: "PrivateCanary Example", sourceLabel: "employment", available: true }] });
    await fixture.admin.query("update public.parent_requests set status='paused' where id=$1", [s.request]);
    expect((await workspace()).rows[0].value).toMatchObject({ collectionEnabled: true }); await authorize(s);
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_get_utility_protected_context($1,$2,'peco-cap',$3,1,$4)", [s.request, s.version, s.snapshot, s.hash]))).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false where program_id='peco-cap'");
    expect((await workspace()).rows[0].value).toMatchObject({ collectionEnabled: false, scope: null, targets: [], references: [{ state: "authorized" }] });
  });
  it("rechecks the actual capture session at raw writes while durable isolated processing uses its own current mandate", async () => {
    const s = await setup(); await enable(); const input = randomUUID(); await authorize(s, input);
    await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [s.session]);
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_input($1)", [input]))).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update auth.sessions set not_after=now()+interval '1 hour' where id=$1", [s.session]); await store(s, input);
    await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [s.session]);
    await expect(tx(() => role(s, "authenticated", "select public.parent_check_utility_protected_input($1,$2)", [s.request, input]))).rejects.toMatchObject({ code: "42501" });
    expect((await tx(() => role(s, "parent_utility_protected", "select parent_private.parent_read_utility_protected_input($1,true) value", [input]))).rows[0].value).toMatchObject({ binding: { inputId: input } });
  });
  it("rebinds unchanged fresh protected information after an unrelated correction without extending consent or carrying validation, and revokes the whole lineage", async () => {
    const s = await setup(); await enable(); const oldId = randomUUID(); const original = (await authorize(s, oldId)).rows[0].value as { consentedAt: string; expiresAt: string }; await store(s, oldId);
    const projection = { version: "synthetic-validator-1", programId: "peco-cap", subjectId: s.subject, sourceId: s.source, proofKind: "pay_stub", originalSha256: "b".repeat(64), currency: "USD", grossCents: 150000,
      periodStart: "2026-11-01", periodEnd: "2026-11-07", issuedOn: "2026-11-08", payFrequency: "weekly", subjectMatch: "printed_name_matches_authorized_target",
      sourceEvidence: ["grossCents", "periodStart", "periodEnd", "issuedOn"].map((field, index) => ({ field, page: 1, line: index + 1, sourceText: "Synthetic closed financial field" })) };
    await tx(() => role(s, "parent_utility_protected", "select parent_private.parent_record_utility_protected_validation($1,'synthetic-validator-1',$2,$3)", [oldId, JSON.stringify(projection), original.expiresAt]));
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_record_utility_protected_validation($1,'synthetic-validator-1',$2,$3)", [oldId, JSON.stringify({ ...projection, proofKind: null }), original.expiresAt]))).rejects.toMatchObject({ code: "42501" });
    const previous = (await fixture.admin.query("select details from public.parent_peco_application_details where id=$1", [s.snapshot])).rows[0].details as object;
    s.snapshot = (await tx(() => role(s, "authenticated", "select public.parent_save_peco_application_details($1,2,$2,$3,$4,true,true) id", [s.request, JSON.stringify({ ...previous, address: { street: "2 Corrected Lane" } }), PECO_APPLICATION_NOTICE_VERSION, randomUUID()]))).rows[0].id as string;
    s.version = 3; s.hash = (await fixture.admin.query("select consent_evidence->>'detailsSha256' hash from public.parent_peco_application_details where id=$1", [s.snapshot])).rows[0].hash as string;
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_read_utility_protected_input($1,true)", [oldId]))).rejects.toMatchObject({ code: "42501" });
    const newId = randomUUID();
    const beginRebind = () => role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_rebind($1,$2,$3,$4,2,$5) value", [oldId, newId, s.version, s.snapshot, s.hash]);
    await tx(async () => { expect((await beginRebind()).rows[0].value).toMatchObject({ targetInputId: newId }); await seal(s, newId); });
    const history = (await tx(() => role(s, "authenticated", "select public.parent_get_utility_protected_inputs($1) value", [s.request]))).rows[0].value as Record<string, unknown>[];
    expect(history.find(ref => ref.inputId === oldId)).toMatchObject({ state: "superseded" });
    expect(history.find(ref => ref.inputId === newId)).toMatchObject({ state: "stored", consentedAt: original.consentedAt, expiresAt: original.expiresAt, validation: null, snapshotId: s.snapshot, requestVersion: 3 });
    await tx(beginRebind);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.utility_protected_authorizations where input_id=$1", [newId])).rows[0].n).toBe(1);
    await fixture.admin.query("insert into parent_private.utility_protected_authorizations select (jsonb_populate_record(null::parent_private.utility_protected_authorizations,to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'input_id',gen_random_uuid()))).* from parent_private.utility_protected_authorizations a cross join generate_series(1,254) where a.input_id=$1", [oldId]);
    await tx(beginRebind); // Existing exact retry still reconciles after the limit is reached.
    await expect(tx(() => role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_rebind($1,$2,$3,$4,2,$5)", [oldId, randomUUID(), s.version, s.snapshot, s.hash]))).rejects.toMatchObject({ code: "23514" });
    await fixture.admin.query("delete from parent_private.utility_protected_authorizations where request_id=$1 and input_id<>all($2::uuid[])", [s.request, [oldId, newId]]);
    await tx(() => role(s, "authenticated", "select public.parent_revoke_utility_protected_input($1,$2)", [s.request, newId]));
    expect((await fixture.admin.query("select count(*)::int n from parent_private.utility_protected_authorizations where input_id=any($1::uuid[]) and revoked_at is not null", [[oldId, newId]])).rows[0].n).toBe(2);
    await expect(tx(beginRebind)).rejects.toMatchObject({ code: "42501" });
  });
  it("matches supplied water accounts privately without extending key life, rejects silent account substitution, and binds proofs to that account", async () => {
    const s = await setup();
    await fixture.admin.query("update parent_private.processing_controls set water_details_enabled=true,water_details_approval_reference='synthetic only',water_details_approved_until=now()+interval '1 day',water_details_notice_version=$1", [WATER_APPLICATION_NOTICE_VERSION]);
    s.request = (await tx(() => role(s, "authenticated", "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["water"], utilityProviders: ["pwd"], accountAuthority: "self" })),
      JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: ["pwd-tap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"], expiresAt: new Date(at.getTime() + 86400000).toISOString() })), randomUUID()]))).rows[0].id as string;
    s.snapshot = (await tx(() => role(s, "authenticated", "select public.parent_save_water_application_details($1,1,$2,$3,$4,true,true) id", [s.request, JSON.stringify({ applicant: { id: s.subject, name: "WaterCanary Example", income: { state: "sources", sources: [{ id: s.source, kind: "employment" }] } }, existingApplication: "saved", propertyAddress: "1 Synthetic Lane" }), WATER_APPLICATION_NOTICE_VERSION, randomUUID()]))).rows[0].id as string;
    s.hash = (await fixture.admin.query("select consent_evidence->>'detailsSha256' hash from public.parent_water_application_details where id=$1", [s.snapshot])).rows[0].hash as string;
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '1 hour',policy_version='synthetic-1',retention_policy_version='synthetic-1',max_retention_seconds=300,allowed_purposes=array['account_access','income_proof','application_recovery','residency_proof'] where program_id='pwd-tap'");
    const accountBytes = (code: string) => Buffer.from(JSON.stringify({ purpose: "account_access", accessCode: code, zip: "19147" }));
    const authorizeWater = (input: string, purpose: string, size: number, field: string) => tx(() => role(s, "authenticated", "select public.parent_authorize_utility_protected_input($1,2,'pwd-tap',$2,1,$3,$4,$5,$6,$7,$8,$9,true,true,true) value",
      [s.request, s.snapshot, s.hash, input, purpose, JSON.stringify([{ subjectId: s.subject, sourceId: field === "income" ? s.source : null, field }]), purpose === "account_access" ? "application/octet-stream" : "application/pdf", size, UTILITY_PROTECTED_INPUT_NOTICE_VERSION]));
    await expect(authorizeWater(randomUUID(), "income_proof", payload.length, "income")).rejects.toMatchObject({ code: "42501" });
    const capture = async (input: string, code: string) => tx(async () => {
      await seal(s, input, accountBytes(code));
      const start = (await role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_account_match($1) value", [input])).rows[0].value as { keyId: string; keyBase64: string; expiresAt: string };
      const key = Buffer.from(start.keyBase64, "base64"), fingerprint = utilityProtectedAccountFingerprint(key, s.owner, "pwd-tap", JSON.stringify([code, "19147"])); key.fill(0);
      const account = (await role(s, "parent_utility_protected", "select parent_private.parent_bind_utility_account($1,$2,$3) id", [input, start.keyId, fingerprint])).rows[0].id;
      return { account, expires: start.expiresAt };
    });
    const first = randomUUID(); await authorizeWater(first, "account_access", accountBytes("900000001").length, "water_access_code"); const original = await capture(first, "900000001");
    const second = randomUUID(); await authorizeWater(second, "account_access", accountBytes("900000001").length, "water_access_code"); expect(await capture(second, "900000001")).toEqual(original);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.utility_protected_account_keys where owner_id=$1", [s.owner])).rows[0].n).toBe(1);
    const changed = randomUUID(); await authorizeWater(changed, "account_access", accountBytes("900000002").length, "water_access_code"); await expect(capture(changed, "900000002")).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.utility_protected_inputs where input_id=$1", [changed])).rows[0].n).toBe(0);
    const proof = randomUUID(), authorization = (await authorizeWater(proof, "income_proof", payload.length, "income")).rows[0].value;
    expect(authorization).toMatchObject({ accountReference: original.account });
    const proofBinding = await store(s, proof); expect(proofBinding.accountReference).toBe(original.account);
    const serialized = JSON.stringify((await tx(() => role(s, "authenticated", "select public.parent_get_utility_protected_inputs($1) value", [s.request]))).rows[0].value);
    expect(serialized).not.toMatch(/900000001|19147|fingerprint|keyId|keyBase64/);
  });
  it("exports only owned opaque consent history after purpose closure and excludes other roles", async () => {
    const s = await setup(); await enable(); const input = randomUUID(); await authorize(s, input); await store(s, input);
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false");
    const exported = (await tx(() => role(s, "authenticated", "select public.parent_export_utility_protected_inputs() value"))).rows[0].value;
    expect(exported).toHaveLength(1); expect(JSON.stringify(exported)).not.toMatch(/keyBase64|contentDigest|projection|SYNTHETIC PRIVATE|PrivateCanary/);
    const foreign = await setup();
    expect((await tx(() => role(foreign, "authenticated", "select public.parent_export_utility_protected_inputs() value"))).rows[0].value).toEqual([]);
    for (const name of ["anon", "service_role", "parent_worker", "parent_storage_broker", "parent_snap_finalizer", "parent_retention_worker", "parent_utility_protected"])
      await expect(tx(() => role(s, name, "select public.parent_export_utility_protected_inputs()"))).rejects.toMatchObject({ code: "42501" });
  });

  it("finds each fresh original lineage for a leased background correction without losing multiple proofs for one source", async () => {
    const s = await setup(); await enable(); const first = randomUUID(), second = randomUUID(); await authorize(s, first); await store(s, first); await authorize(s, second); await store(s, second);
    const corrected = fixtureIntake({ needs: ["electricity"], utilityProviders: ["peco"], accountAuthority: "self", zip: "19105" });
    await tx(() => role(s, "authenticated", "select public.parent_correct_request($1,$2,2)", [s.request, JSON.stringify(corrected)]));
    await fixture.admin.query("update public.parent_jobs set state='cancelled',lease_token=null,lease_until=null where request_id<>$1", [s.request]);
    const lease = (await tx(() => role(s, "parent_worker", "select parent_private.parent_claim_job(120) value"))).rows[0].value as { jobId: string; leaseToken: string };
    const sql = "select parent_private.parent_get_utility_reuse_candidates($1,$2,$3,3,'peco-cap',$4,1,$5) value", args = [lease.jobId, lease.leaseToken, s.request, s.snapshot, s.hash];
    const before = (await tx(() => role(s, "parent_utility_protected", sql, args))).rows[0].value as { reference: { inputId: string }; originAuthorizationId: string }[];
    expect(before).toHaveLength(2); expect(before.map(item => item.reference.inputId).sort()).toEqual([first, second].sort());
    const copied = randomUUID();
    await tx(async () => { await role(s, "parent_utility_protected", "select parent_private.parent_begin_utility_protected_rebind($1,$2,3,$3,1,$4)", [first, copied, s.snapshot, s.hash]); await seal(s, copied); });
    const after = (await tx(() => role(s, "parent_utility_protected", sql, args))).rows[0].value as { reference: { inputId: string } }[];
    expect(after.map(item => item.reference.inputId)).toEqual([second]);
    for (const name of ["authenticated", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])
      await expect(tx(() => role(s, name, sql, args))).rejects.toMatchObject({ code: "42501" });
    await expect(tx(() => role(s, "parent_utility_protected", sql, [lease.jobId, randomUUID(), s.request, s.snapshot, s.hash]))).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update parent_private.utility_protected_policies set enabled=false");
    await expect(tx(() => role(s, "parent_utility_protected", sql, args))).rejects.toMatchObject({ code: "42501" });
  });

  it("binds a worker input before raw access and rejects a real-time lease expiry inside an older transaction", async () => {
    const s = await setup(); await enable(); const input = randomUUID(); await authorize(s, input); await store(s, input);
    await fixture.admin.query("update public.parent_jobs set state='cancelled',lease_token=null,lease_until=null where request_id<>$1", [s.request]);
    const lease = (await tx(() => role(s, "parent_worker", "select parent_private.parent_claim_job(120) value"))).rows[0].value as { jobId: string; leaseToken: string };
    const sql = "select parent_private.parent_check_utility_input_job($1,$2,$3,2,$4)", args = [lease.jobId, lease.leaseToken, s.request, input];
    await expect(tx(() => role(s, "parent_utility_protected", sql, args))).resolves.toBeTruthy();
    await expect(tx(() => role(s, "parent_utility_protected", sql, [lease.jobId, lease.leaseToken, s.request, randomUUID()]))).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("begin");
    try {
      await role(s, "parent_utility_protected", sql, args); vi.setSystemTime(new Date(at.getTime() + 121000));
      await expect(role(s, "parent_utility_protected", sql, args)).rejects.toMatchObject({ code: "42501" });
    } finally { await fixture.admin.query("rollback"); vi.setSystemTime(at); }
  });

});
