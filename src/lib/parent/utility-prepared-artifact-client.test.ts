import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureUtilityProtectedOperation } from "./utility-preparation-test-fixtures";
import { sealUtilityPreparedArtifact } from "./utility-prepared-artifact";
import { utilityPreparedAad, type UtilityPreparedBinding } from "./utility-protected-operation";
const driver = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn(), destroy: vi.fn() }));
vi.mock("pg", () => ({ Client: class { connection = { stream: { destroy: driver.destroy } }; query = driver.query; connect = driver.connect; end = driver.end; on() {} } }));
import { readUtilityPreparedArtifactForOwner, storeUtilityPreparedArtifact } from "./utility-prepared-artifact-client";
const now = new Date("2026-11-13T22:21:00Z"), key = Buffer.alloc(32, 17), id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bytes = new TextEncoder().encode("%PDF-1.7\nLOCAL TEST PRIVATE UTILITY PREPARATION\nPRIVATE_ACCOUNT_AND_MEMBER_CANARY\n%%EOF");
const options = () => ({ connectionString: "postgresql://caselink_utility_synthetic:synthetic-secret@127.0.0.1:55322/postgres", deadline: new Date(Date.now() + 10000) });
let binding: UtilityPreparedBinding, stored: boolean;
function job() { const reference = binding.operation.packet.protectedUtilityPacket; return { jobId: id(8), leaseToken: id(9), inputSetHash: binding.inputSetHash, scope: { requestId: reference.requestId, expectedVersion: reference.requestVersion,
  programId: reference.programId, snapshotId: reference.snapshotId, snapshotRevision: reference.snapshotRevision, snapshotHash: reference.snapshotHash } }; }
function output() { const reference = binding.operation.packet.protectedUtilityPacket; return { bytes: Uint8Array.from(bytes), inputs: structuredClone(reference.inputs),
  source: { kind: reference.sourceKind, id: reference.templateId, version: reference.templateVersion, sha256: reference.templateSha256, rendererVersion: reference.rendererVersion }, expiresAt: reference.expiresAt }; }
function envelope() { const sealed = sealUtilityPreparedArtifact(bytes, key, binding, now); return { binding, keyBase64: key.toString("base64"),
  aad: Buffer.from(utilityPreparedAad(binding)).toString("base64"), iv: Buffer.from(sealed.iv).toString("base64"), tag: Buffer.from(sealed.tag).toString("base64"), ciphertext: Buffer.from(sealed.ciphertext).toString("base64") }; }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks(); stored = false;
  const operation = fixtureUtilityProtectedOperation(); operation.packet.protectedUtilityPacket.byteLength = bytes.length;
  operation.packet.protectedUtilityPacket.contentSha256 = createHash("sha256").update(bytes).digest("hex");
  binding = { format: "caselink-utility-preparation-v1", ownerId: id(3), mandateHash: "e".repeat(64), inputSetHash: "f".repeat(64), operation };
  driver.connect.mockResolvedValue(undefined); driver.end.mockResolvedValue(undefined);
  driver.query.mockImplementation(async (sql: string) => {
    if (sql.includes("from pg_roles")) return { rows: [{ login: "caselink_utility_synthetic", role: "caselink_utility_synthetic", safe: true }] };
    if (sql.startsWith("select current_user")) return { rows: [{ role: "parent_utility_protected", login: "caselink_utility_synthetic" }] };
    if (sql.includes("parent_begin_utility_prepared")) return { rows: [{ value: { ...envelope(), state: stored ? "stored" : "pending" } }] };
    if (sql.includes("parent_seal_utility_prepared")) { stored = true; return { rows: [{ value: binding.operation }] }; }
    if (sql.includes("parent_read_utility_prepared")) return { rows: [{ value: envelope() }] };
    if (sql.includes("parent_check_utility_prepared") || sql.includes("parent_get_utility_prepared_operation")) return { rows: [{ value: binding.operation }] };
    return { rows: [] };
  });
});
afterEach(() => vi.useRealTimers());
describe("trusted private utility artifact client", () => {
  it("seals in one transaction with the existing strict utility-only session and returns opaque operation metadata", async () => {
    const value = output(), result = await storeUtilityPreparedArtifact(job(), value, options());
    expect(result).toEqual({ state: "prepared", operation: binding.operation });
    expect(driver.query.mock.calls.map(call => call[0])).toContain("set role parent_utility_protected");
    expect(driver.query.mock.calls.at(-1)![0]).toBe("commit");
    const sealed = driver.query.mock.calls.find(call => call[0].includes("parent_seal_utility_prepared"))![1];
    expect(Buffer.from(sealed[5])).not.toEqual(Buffer.from(bytes));
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_ACCOUNT|ciphertext|keyBase64|mandateHash/);
    expect(value.bytes).toEqual(bytes); expect(driver.destroy).toHaveBeenCalledOnce();
  });
  it("reconciles an exact retry against its original encrypted bytes without resealing or extending expiry", async () => {
    await storeUtilityPreparedArtifact(job(), output(), options());
    const result = await storeUtilityPreparedArtifact(job(), output(), options());
    expect(result).toMatchObject({ state: "prepared", operation: binding.operation });
    expect(driver.query.mock.calls.filter(call => call[0].includes("parent_seal_utility_prepared"))).toHaveLength(1);
  });
  it("reports an unknown dispatched COMMIT without claiming preparation or making another write", async () => {
    const usual = driver.query.getMockImplementation()!;
    driver.query.mockImplementation(async (sql, values) => { if (sql === "commit") throw new Error("PRIVATE_DATABASE_CANARY"); return usual(sql, values); });
    expect(await storeUtilityPreparedArtifact(job(), output(), options())).toEqual({ state: "commit_unknown", packetId: binding.operation.packet.protectedUtilityPacket.packetId, operationId: binding.operation.operationId });
    expect(driver.query.mock.calls.filter(call => call[0] === "commit")).toHaveLength(1);
    expect(driver.query.mock.calls.filter(call => call[0].includes("parent_seal_utility_prepared"))).toHaveLength(1);
  });
  it.each(["snapshot", "input", "expiry", "bytes", "set"])("rejects changed %s intent before persist without rebasing the original", async change => {
    const value = output(), target = job();
    if (change === "snapshot") target.scope.snapshotHash = "f".repeat(64);
    if (change === "input") value.inputs[0].authorizationId = id(10);
    if (change === "expiry") value.expiresAt = "2026-11-13T22:24:00Z";
    if (change === "bytes") value.bytes[20] ^= 1;
    if (change === "set") target.inputSetHash = "a".repeat(64);
    await expect(storeUtilityPreparedArtifact(target, value, options())).rejects.toThrow("could not be verified");
    expect(driver.query.mock.calls.map(call => call[0])).toContain("rollback");
    expect(driver.query.mock.calls.some(call => call[0].includes("parent_seal_utility_prepared"))).toBe(false);
  });
  it("rechecks the exact current operation before COMMIT and rolls back changed authority", async () => {
    const usual = driver.query.getMockImplementation()!;
    driver.query.mockImplementation(async (sql, values) => sql.includes("parent_get_utility_prepared_operation") ? { rows: [{ value: { ...binding.operation, protectedPacketCurrent: false } }] } : usual(sql, values));
    await expect(storeUtilityPreparedArtifact(job(), output(), options())).rejects.toThrow("could not be verified");
    expect(driver.query.mock.calls.map(call => call[0])).not.toContain("commit");
  });
  it("captures renderer bytes, input bindings, source and deadline before awaiting the database", async () => {
    const usual = driver.query.getMockImplementation()!; let finish!: () => void;
    driver.query.mockImplementation(async (sql, values) => { if (sql.includes("parent_begin_utility_prepared")) await new Promise<void>(resolve => { finish = resolve; }); return usual(sql, values); });
    const value = output(), target = job(), pending = storeUtilityPreparedArtifact(target, value, options());
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    value.bytes.fill(0); value.inputs[0].authorizationId = id(10); value.source.sha256 = "f".repeat(64); value.expiresAt = "2000-01-01T00:00:00Z"; target.scope.snapshotHash = "f".repeat(64);
    finish(); expect(await pending).toMatchObject({ state: "prepared", operation: binding.operation });
  });
  it("returns private owner bytes only after the same owner/case and current permission are checked twice", async () => {
    const result = await readUtilityPreparedArtifactForOwner({ packetId: binding.operation.packet.protectedUtilityPacket.packetId, ownerId: binding.ownerId, requestId: binding.operation.requestId }, options());
    expect(result.bytes).toEqual(bytes); expect(result.operation).toEqual(binding.operation);
    expect(driver.query.mock.calls.at(-1)![0]).toContain("parent_check_utility_prepared_artifact");
  });
  it("keeps paused owner inspection separate from current worker execution", async () => {
    const usual = driver.query.getMockImplementation()!;
    driver.query.mockImplementation(async (sql, values) => sql.includes("parent_check_utility_prepared") ? { rows: [{ value: { ...binding.operation, protectedPacketCurrent: false } }] } : usual(sql, values));
    const result = await readUtilityPreparedArtifactForOwner({ packetId: binding.operation.packet.protectedUtilityPacket.packetId, ownerId: binding.ownerId, requestId: binding.operation.requestId }, options());
    expect(result.bytes).toEqual(bytes); expect(result.operation.protectedPacketCurrent).toBe(false);
  });
  it("does not let a worker borrow the paused owner read boundary", async () => {
    const target = job();
    await expect(readUtilityPreparedArtifactForOwner({ packetId: binding.operation.packet.protectedUtilityPacket.packetId, ownerId: binding.ownerId, requestId: binding.operation.requestId },
      { ...options(), job: { jobId: target.jobId, leaseToken: target.leaseToken, requestId: target.scope.requestId, requestVersion: target.scope.expectedVersion } })).rejects.toThrow("could not be verified");
    expect(driver.connect).not.toHaveBeenCalled();
  });
  it("does not return decrypted bytes after closure or a foreign owner/case", async () => {
    const usual = driver.query.getMockImplementation()!;
    driver.query.mockImplementation(async (sql, values) => { if (sql.includes("parent_check_utility_prepared")) throw new Error("PRIVATE_PERMISSION_CANARY"); return usual(sql, values); });
    const target = { packetId: binding.operation.packet.protectedUtilityPacket.packetId, ownerId: binding.ownerId, requestId: binding.operation.requestId };
    await expect(readUtilityPreparedArtifactForOwner(target, options())).rejects.toThrow("could not be verified");
    await expect(readUtilityPreparedArtifactForOwner({ ...target, ownerId: id(10) }, options())).rejects.toThrow("could not be verified");
    await expect(readUtilityPreparedArtifactForOwner({ ...target, requestId: id(10) }, options())).rejects.toThrow("could not be verified");
  });
});
