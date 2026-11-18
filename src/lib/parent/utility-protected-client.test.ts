import { beforeEach, describe, expect, it, vi } from "vitest";
import { sealUtilityProtectedInput, utilityProtectedContentDigest } from "./utility-protected-input";
import { UTILITY_PROTECTED_INPUT_FORMAT, utilityProtectedInputAad, type UtilityProtectedBinding } from "./utility-protected-input-contract";
const driver = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn(), destroy: vi.fn(), config: vi.fn() }));
vi.mock("pg", () => ({ Client: class { connection = { stream: { destroy: driver.destroy } }; constructor(config: unknown) { driver.config(config); } query = driver.query; connect = driver.connect; end = driver.end; on() {} } }));
import { getUtilityProtectedApplicationContext, storeUtilityProtectedInput, validateUtilityProtectedConnection, withUtilityProtectedInput, recordUtilityProtectedIncomeValidation } from "./utility-protected-client";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const connectionString = "postgresql://caselink_utility_synthetic:synthetic-secret@127.0.0.1:55322/postgres";
const options = () => ({ connectionString, deadline: new Date(Date.now() + 10000) });
const inputId = id(1), key = Buffer.alloc(32, 19), bytes = Buffer.from("SYNTHETIC PRIVATE DOCUMENT");
let binding: UtilityProtectedBinding, reference: object, context: object;
beforeEach(() => {
  vi.clearAllMocks(); driver.connect.mockResolvedValue(undefined); driver.end.mockResolvedValue(undefined);
  binding = { format: UTILITY_PROTECTED_INPUT_FORMAT, inputId, authorizationId: id(2), ownerId: id(3), requestId: id(4), requestVersion: 2,
    programId: "peco-cap", need: "electricity", snapshotId: id(5), snapshotRevision: 1, snapshotHash: "a".repeat(64), purpose: "income_proof", targets: [{ subjectId: id(6), sourceId: id(7), field: "income" }],
    policyVersion: "synthetic-1", retentionPolicyVersion: "synthetic-1", mediaType: "application/pdf", byteLength: bytes.length, contentDigest: utilityProtectedContentDigest(bytes, key),
    consentedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), accountReference: null };
  const { format: _1, need: _2, policyVersion: _3, retentionPolicyVersion: _4, mediaType: _5, byteLength: _6, contentDigest: _7, ...safe } = binding; void _1; void _2; void _3; void _4; void _5; void _6; void _7;
  reference = { ...safe, state: "stored", validation: null, accountReference: null };
  context = { ownerId: binding.ownerId, householdId: id(8), accountAuthority: "self", grantExpiresAt: binding.expiresAt, requestId: binding.requestId, requestVersion: 2, programId: binding.programId, need: binding.need, mandate: {},
    snapshot: { id: binding.snapshotId, request_id: binding.requestId, revision: 1, details: {}, source: {}, consent_evidence: { detailsSha256: binding.snapshotHash } },
    sourceExpiresAt: binding.expiresAt, approvalExpiresAt: binding.expiresAt, reference };
  driver.query.mockImplementation(async (sql: string) => {
    if (sql.includes("from pg_roles")) return { rows: [{ login: "caselink_utility_synthetic", role: "caselink_utility_synthetic", safe: true }] };
    if (sql.startsWith("select current_user")) return { rows: [{ role: "parent_utility_protected", login: "caselink_utility_synthetic" }] };
    if (sql.includes("parent_begin_utility")) return { rows: [{ value: { binding: { ...binding, contentDigest: null }, keyBase64: key.toString("base64"), state: "pending", iv: null, tag: null, ciphertext: null } }] };
    if (sql.includes("parent_seal_utility")) return { rows: [{ value: binding }] };
    if (sql.includes("parent_check_utility") || sql.includes("parent_get_utility")) return { rows: [{ value: context }] };
    if (sql.includes("parent_read_utility")) { const sealed = sealUtilityProtectedInput(bytes, key, binding, new Date()); return { rows: [{ value: { binding, keyBase64: key.toString("base64"), aad: Buffer.from(utilityProtectedInputAad(binding)).toString("base64"),
      iv: Buffer.from(sealed.iv).toString("base64"), tag: Buffer.from(sealed.tag).toString("base64"), ciphertext: Buffer.from(sealed.ciphertext).toString("base64") } }] }; }
    return { rows: [] };
  });
});
describe("utility-only short-lived private database client", () => {
  it("uses a utility-only principal, seals in one transaction, and returns metadata only", async () => {
    const result = await storeUtilityProtectedInput(inputId, bytes, options()); expect(result).toEqual({ state: "stored", reference });
    const calls = driver.query.mock.calls.map(call => call[0]); expect(calls).toContain("set role parent_utility_protected"); expect(calls).toContain("begin"); expect(calls.at(-1)).toBe("commit");
    const stored = driver.query.mock.calls.find(call => call[0].includes("parent_seal_utility"))![1];
    expect(Buffer.from(stored[4])).not.toEqual(bytes); expect(JSON.stringify(result)).not.toMatch(/contentDigest|ciphertext|keyBase64|SYNTHETIC PRIVATE/);
    expect(driver.config.mock.calls[0][0]).toMatchObject({ application_name: "caselink-utility-protected", connectionTimeoutMillis: 3000, query_timeout: 5000 }); expect(driver.destroy).toHaveBeenCalledOnce();
  });
  it("reports a dispatched unknown commit without resealing or retrying writes", async () => {
    const usual = driver.query.getMockImplementation()!; driver.query.mockImplementation(async (sql, values) => { if (sql === "commit") throw new Error("private DB canary"); return usual(sql, values); });
    expect(await storeUtilityProtectedInput(inputId, bytes, options())).toEqual({ state: "commit_unknown", inputId });
    expect(driver.query.mock.calls.filter(call => call[0].includes("parent_seal_utility"))).toHaveLength(1); expect(driver.query.mock.calls.filter(call => call[0] === "commit")).toHaveLength(1);
  });
  it("rolls back if exact binding changes before persist and never commits", async () => {
    const usual = driver.query.getMockImplementation()!; driver.query.mockImplementation(async (sql, values) => sql.includes("parent_seal_utility") ? { rows: [{ value: { ...binding, snapshotId: id(9) } }] } : usual(sql, values));
    await expect(storeUtilityProtectedInput(inputId, bytes, options())).rejects.toThrow("could not be verified");
    expect(driver.query.mock.calls.map(call => call[0])).toContain("rollback"); expect(driver.query.mock.calls.map(call => call[0])).not.toContain("commit");
  });
  it("checks current context and rechecks permission after an awaited private operation, clearing decrypted bytes", async () => {
    let raw: Uint8Array | undefined;
    const result = await withUtilityProtectedInput(inputId, options(), async value => { raw = value.bytes; expect(Buffer.from(value.bytes)).toEqual(bytes); await Promise.resolve(); return "safe result"; });
    expect(result).toBe("safe result"); expect(raw!.every(value => value === 0)).toBe(true); expect(driver.query.mock.calls.at(-1)![0]).toContain("parent_check_utility_protected_input");
  });
  it("discards private results if permission closes during the awaited operation", async () => {
    const usual = driver.query.getMockImplementation()!; let closed = false, raw: Uint8Array | undefined;
    driver.query.mockImplementation(async (sql, values) => { if (closed && sql.includes("parent_check_utility")) throw new Error("private policy canary"); return usual(sql, values); });
    await expect(withUtilityProtectedInput(inputId, options(), async value => { raw = value.bytes; await Promise.resolve(); closed = true; return "must not escape"; })).rejects.toThrow("could not be verified");
    expect(raw!.every(value => value === 0)).toBe(true);
  });
  it("does not use a private credential with any broader principal membership or privileges", async () => {
    driver.query.mockResolvedValue({ rows: [{ login: "caselink_utility_synthetic", role: "caselink_utility_synthetic", safe: false }] });
    await expect(storeUtilityProtectedInput(inputId, bytes, options())).rejects.toThrow("could not be verified"); expect(driver.query).toHaveBeenCalledOnce(); expect(driver.destroy).toHaveBeenCalledOnce();
  });
  it("checks exact source snapshot before returning private context", async () => {
    const scope = { requestId: binding.requestId, expectedVersion: 2, programId: binding.programId, snapshotId: binding.snapshotId, snapshotRevision: 1, snapshotHash: binding.snapshotHash };
    expect(await getUtilityProtectedApplicationContext(scope, options())).toMatchObject({ requestId: binding.requestId });
    await expect(getUtilityProtectedApplicationContext({ ...scope, snapshotHash: "b".repeat(64) }, options())).rejects.toThrow("could not be verified");
  });
  it("rejects expired/too-long/aborted operation windows before a connection", async () => {
    for (const value of [{ ...options(), deadline: new Date(0) }, { ...options(), deadline: new Date(Date.now() + 31000) }, { ...options(), signal: AbortSignal.abort() }])
      await expect(storeUtilityProtectedInput(inputId, bytes, value)).rejects.toThrow("could not be verified");
    expect(driver.connect).not.toHaveBeenCalled();
  });
  it.each(["postgresql://postgres:secret@127.0.0.1:55322/postgres", "postgresql://parent_utility_protected:secret@127.0.0.1:55322/postgres", "postgresql://caselink_test:secret@127.0.0.1:5432/postgres", "postgresql://caselink_test:secret@db.example.supabase.co/postgres?sslmode=require"])("rejects overbroad or unverified private database target %s", value => {
    expect(() => validateUtilityProtectedConnection(value)).toThrow("could not be verified");
  });
});

describe("worker-only transaction authority before plaintext and validation persistence", () => {
  const leased = () => ({ ...options(), job: { jobId: id(20), leaseToken: id(21), requestId: id(4), requestVersion: 2 } });
  it("rejects an invalid input-to-job binding before reading any original key", async () => {
    const usual = driver.query.getMockImplementation()!;
    driver.query.mockImplementation(async (sql, values) => { if (sql.includes("parent_check_utility_input_job")) throw new Error("expired-or-unrelated-job"); return usual(sql, values); });
    await expect(withUtilityProtectedInput(inputId, leased(), async () => "no-data")).rejects.toThrow("could not be verified");
    expect(driver.query.mock.calls.some(call => call[0].includes("parent_read_utility_protected_input"))).toBe(false);
    expect(driver.query.mock.calls.map(call => call[0])).toContain("rollback"); expect(driver.query.mock.calls.map(call => call[0])).not.toContain("commit");
  });
  it("rechecks the same captured job after awaited work and clears the result if its lease ends", async () => {
    const usual = driver.query.getMockImplementation()!, source = leased(); let checks = 0; const output = Uint8Array.from([1, 2, 3]);
    driver.query.mockImplementation(async (sql, values) => { if (sql.includes("parent_check_utility_input_job")) { checks++; expect(values).toEqual([id(20), id(21), id(4), 2, inputId]); if (checks === 4) throw new Error("lease-ended"); } return usual(sql, values); });
    await expect(withUtilityProtectedInput(inputId, source, async () => { source.job.jobId = id(99); await Promise.resolve(); return output; })).rejects.toThrow("could not be verified");
    expect(checks).toBe(4); expect(output.every(value => value === 0)).toBe(true); expect(driver.query.mock.calls.map(call => call[0])).not.toContain("commit");
  });
  it("rejects owner-inspection and new-capture modes with worker options and fails scope changes before connecting", async () => {
    await expect(withUtilityProtectedInput(inputId, leased(), async () => "none", false)).rejects.toThrow("could not be verified");
    await expect(storeUtilityProtectedInput(inputId, bytes, leased())).rejects.toThrow("could not be verified");
    await expect(getUtilityProtectedApplicationContext({ requestId: id(99), expectedVersion: 2, programId: binding.programId, snapshotId: binding.snapshotId, snapshotRevision: 1, snapshotHash: binding.snapshotHash }, leased())).rejects.toThrow("could not be verified");
    expect(driver.connect).not.toHaveBeenCalled();
  });
  it("guards a trusted validation INSERT and its COMMIT in the same job transaction", async () => {
    const projection = { version: "utility-employment-source-fields-2026-11-13.v1" as const, programId: "peco-cap" as const, subjectId: id(6), sourceId: id(7), proofKind: "pay_stub" as const, originalSha256: "e".repeat(64), currency: "USD" as const, grossCents: 150000,
      periodStart: "2026-11-01", periodEnd: "2026-11-07", issuedOn: "2026-11-08", payFrequency: "weekly" as const, subjectMatch: "printed_name_matches_authorized_target" as const,
      sourceEvidence: (["grossCents", "periodStart", "periodEnd", "issuedOn"] as const).map((field, index) => ({ field, page: 1, line: index + 1, sourceText: "Closed financial line" })) };
    const usual = driver.query.getMockImplementation()!; let checks = 0;
    driver.query.mockImplementation(async (sql, values) => { if (sql.includes("parent_check_utility_input_job") && ++checks === 2) throw new Error("lease-ended");
      if (sql.includes("parent_record_utility_protected_validation")) return { rows: [{ value: reference }] }; return usual(sql, values); });
    await expect(recordUtilityProtectedIncomeValidation(inputId, projection, binding.expiresAt, leased())).rejects.toThrow("could not be verified");
    expect(checks).toBe(2); expect(driver.query.mock.calls.map(call => call[0])).toContain("rollback"); expect(driver.query.mock.calls.map(call => call[0])).not.toContain("commit");
  });
});

it.each(["raw-read", "context"])("does not invoke private processing when the lease expires during awaited %s", async stage => {
  const usual = driver.query.getMockImplementation()!, run = vi.fn(async () => "no-plaintext-result"); let ended = false;
  driver.query.mockImplementation(async (sql, values) => {
    if (ended && sql.includes("parent_check_utility_input_job")) throw new Error("lease-ended");
    const result = await usual(sql, values);
    if (stage === "raw-read" ? sql.includes("parent_read_utility_protected_input") : sql.includes("parent_get_utility_protected_context")) ended = true;
    return result;
  });
  await expect(withUtilityProtectedInput(inputId, { ...options(), job: { jobId: id(20), leaseToken: id(21), requestId: id(4), requestVersion: 2 } }, run)).rejects.toThrow("could not be verified");
  expect(run).not.toHaveBeenCalled(); expect(driver.query.mock.calls.map(call => call[0])).toContain("rollback"); expect(driver.query.mock.calls.map(call => call[0])).not.toContain("commit");
});
