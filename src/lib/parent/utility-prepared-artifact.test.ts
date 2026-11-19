import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixtureUtilityProtectedOperation } from "./utility-preparation-test-fixtures";
import { openUtilityPreparedArtifact, sealUtilityPreparedArtifact, UTILITY_PREPARED_ARTIFACT_ERROR } from "./utility-prepared-artifact";

const now = new Date("2026-11-13T22:21:00Z"), key = new Uint8Array(32).fill(42);
// Crypto fixture only, not a parseable, issued or submittable PDF. The native rehearsal supplies actual generated pages.
const bytes = new TextEncoder().encode("%PDF-1.7\nLOCAL TEST PRIVATE WATER DRAFT\nPRIVATE_ACCOUNT_AND_MEMBER_CANARY\n%%EOF");
function binding() {
  const operation = fixtureUtilityProtectedOperation();
  operation.packet.protectedUtilityPacket.byteLength = bytes.length;
  operation.packet.protectedUtilityPacket.contentSha256 = createHash("sha256").update(bytes).digest("hex");
  return { format: "caselink-utility-preparation-v1", ownerId: "88888888-8888-4888-8888-888888888888", mandateHash: "e".repeat(64), inputSetHash: "f".repeat(64), operation };
}
describe("isolated utility preparation encryption", () => {
  it("round-trips exact private bytes with a distinct authenticated IV without exposing plaintext in its metadata", () => {
    const first = sealUtilityPreparedArtifact(bytes, key, binding(), now), second = sealUtilityPreparedArtifact(bytes, key, binding(), now);
    expect(Buffer.from(openUtilityPreparedArtifact(first, key, now))).toEqual(Buffer.from(bytes));
    expect(first.iv).not.toEqual(second.iv); expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain("PRIVATE_ACCOUNT_AND_MEMBER_CANARY");
    expect(Buffer.from(first.ciphertext).includes(Buffer.from("PRIVATE_ACCOUNT_AND_MEMBER_CANARY"))).toBe(false);
  });
  it.each(["owner", "operation", "hash", "input", "expiry", "source"])("rejects a changed authenticated %s binding", field => {
    const sealed = sealUtilityPreparedArtifact(bytes, key, binding(), now), changed = structuredClone(sealed.binding);
    if (field === "owner") changed.ownerId = "99999999-9999-4999-8999-999999999999";
    if (field === "operation") changed.operation.operationId = "99999999-9999-4999-8999-999999999999";
    if (field === "hash") changed.operation.packetHash = "e".repeat(64);
    if (field === "input") changed.operation.packet.protectedUtilityPacket.inputs[0].authorizationId = "99999999-9999-4999-8999-999999999999";
    if (field === "expiry") changed.operation.packet.protectedUtilityPacket.expiresAt = "2026-11-13T22:26:00.000Z";
    if (field === "source") changed.operation.packet.protectedUtilityPacket.templateSha256 = "f".repeat(64);
    expect(() => openUtilityPreparedArtifact({ ...sealed, binding: changed }, key, now)).toThrow(UTILITY_PREPARED_ARTIFACT_ERROR);
  });
  it.each(["ciphertext", "iv", "tag"] as const)("rejects changed %s or a wrong key without diagnostic content", part => {
    const sealed = sealUtilityPreparedArtifact(bytes, key, binding(), now), changed = Uint8Array.from(sealed[part]); changed[0] ^= 1;
    expect(() => openUtilityPreparedArtifact({ ...sealed, [part]: changed }, key, now)).toThrow(UTILITY_PREPARED_ARTIFACT_ERROR);
    expect(() => openUtilityPreparedArtifact(sealed, new Uint8Array(32).fill(1), now)).toThrow(UTILITY_PREPARED_ARTIFACT_ERROR);
  });
  it.each([new Date("2026-11-13T22:19:59Z"), new Date("2026-11-13T22:25:00Z"), new Date("invalid")])("does not open or seal outside the original bounded time: %s", at => {
    const sealed = sealUtilityPreparedArtifact(bytes, key, binding(), now);
    expect(() => sealUtilityPreparedArtifact(bytes, key, binding(), at)).toThrow(UTILITY_PREPARED_ARTIFACT_ERROR);
    expect(() => openUtilityPreparedArtifact(sealed, key, at)).toThrow(UTILITY_PREPARED_ARTIFACT_ERROR);
  });
  it("rejects a non-PDF, changed digest, wrong length, raw metadata or invalid key", () => {
    const value = binding();
    for (const [data, suppliedKey, metadata] of [[bytes.subarray(1), key, value], [bytes, key, { ...value, privateValue: "PRIVATE_CANARY" }], [bytes, new Uint8Array(31), value]] as const)
      expect(() => sealUtilityPreparedArtifact(data, suppliedKey, metadata, now)).toThrow(UTILITY_PREPARED_ARTIFACT_ERROR);
    const changed = structuredClone(value); changed.operation.packet.protectedUtilityPacket.contentSha256 = "f".repeat(64);
    expect(() => sealUtilityPreparedArtifact(bytes, key, changed, now)).toThrow(UTILITY_PREPARED_ARTIFACT_ERROR);
  });
});
