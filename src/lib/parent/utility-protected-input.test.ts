import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UTILITY_PROTECTED_INPUT_FORMAT, UTILITY_PROTECTED_INPUT_NOTICE_VERSION, utilityProtectedAuthorizationSchema, utilityProtectedInputAad,
  utilityProtectedInputReferenceSchema, type UtilityProtectedBinding } from "./utility-protected-input-contract";
import { openUtilityProtectedInput, sealUtilityProtectedInput, utilityProtectedAccountFingerprint, utilityProtectedContentDigest, UTILITY_PROTECTED_INPUT_ERROR } from "./utility-protected-input";

const now = new Date("2026-11-13T22:00:00.000Z"), key = new Uint8Array(32).fill(7);
const bytes = new TextEncoder().encode("%PDF-Fictional private proof: 123-45-6789. Not a family document.");
function binding(): UtilityProtectedBinding {
  return { format: UTILITY_PROTECTED_INPUT_FORMAT, inputId: randomUUID(), authorizationId: randomUUID(), ownerId: randomUUID(), requestId: randomUUID(),
    requestVersion: 3, programId: "peco-cap", need: "electricity", snapshotId: randomUUID(), snapshotRevision: 2, snapshotHash: "a".repeat(64),
    purpose: "income_proof", targets: [{ subjectId: randomUUID(), sourceId: randomUUID(), field: "income" }],
    policyVersion: "synthetic-policy-v1", retentionPolicyVersion: "synthetic-retention-v1", mediaType: "application/pdf", byteLength: bytes.length,
    contentDigest: utilityProtectedContentDigest(bytes, key), consentedAt: "2026-11-13T21:59:00.000Z", expiresAt: "2026-11-13T23:00:00.000Z", accountReference: null };
}
describe("isolated utility protected bytes", () => {
  it("encrypts exact owned bytes with independently random IVs without putting their values in the binding", () => {
    const scope = binding(), first = sealUtilityProtectedInput(bytes, key, scope, now), second = sealUtilityProtectedInput(bytes, key, scope, now);
    expect(Buffer.from(openUtilityProtectedInput(first, key, now))).toEqual(Buffer.from(bytes));
    expect(first.iv).not.toEqual(second.iv); expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(Buffer.from(first.ciphertext).includes(Buffer.from("123-45-6789"))).toBe(false);
    expect(JSON.stringify(first.binding)).not.toContain("123-45-6789");
  });
  it.each(["inputId", "authorizationId", "ownerId", "requestId", "snapshotId"] as const)("rejects transplanting protected bytes to another %s", field => {
    const sealed = sealUtilityProtectedInput(bytes, key, binding(), now);
    expect(() => openUtilityProtectedInput({ ...sealed, binding: { ...sealed.binding, [field]: randomUUID() } }, key, now)).toThrow(UTILITY_PROTECTED_INPUT_ERROR);
  });
  it.each([{ requestVersion: 4 }, { snapshotRevision: 3 }, { snapshotHash: "b".repeat(64) }, { policyVersion: "changed-v1" },
    { retentionPolicyVersion: "changed-v1" }, { mediaType: "image/png" }, { contentDigest: "b".repeat(64) }, { expiresAt: "2026-11-13T23:30:00.000Z" },
    { consentedAt: "2026-11-13T21:58:00.000Z" }, { programId: "pgw-crp", need: "gas" }, { purpose: "residency_proof" }])("rejects changed scope, consent, content or retention: %j", patch => {
    const sealed = sealUtilityProtectedInput(bytes, key, binding(), now);
    expect(() => openUtilityProtectedInput({ ...sealed, binding: { ...sealed.binding, ...patch } }, key, now)).toThrow(UTILITY_PROTECTED_INPUT_ERROR);
  });
  it("binds each exact person/source pair while making target ordering irrelevant", () => {
    const scope = binding(); scope.targets.push({ subjectId: randomUUID(), sourceId: randomUUID(), field: "income" });
    const sealed = sealUtilityProtectedInput(bytes, key, scope, now), reversed = { ...scope, targets: [...scope.targets].reverse() };
    expect(utilityProtectedInputAad(reversed)).toEqual(utilityProtectedInputAad(scope));
    expect(Buffer.from(openUtilityProtectedInput({ ...sealed, binding: reversed }, key, now))).toEqual(Buffer.from(bytes));
    const switched = { ...scope, targets: scope.targets.map((target, index) => ({ ...target, sourceId: scope.targets[1 - index].sourceId })) };
    expect(() => openUtilityProtectedInput({ ...sealed, binding: switched }, key, now)).toThrow(UTILITY_PROTECTED_INPUT_ERROR);
  });
  it("rejects an expired/future consent, wrong key and modified ciphertext/tag/IV with fixed non-content errors", () => {
    const scope = binding(), sealed = sealUtilityProtectedInput(bytes, key, scope, now);
    for (const [input, suppliedKey, at] of [
      [sealed, key, new Date(scope.expiresAt)], [sealed, key, new Date("2026-11-13T21:58:00Z")], [sealed, new Uint8Array(32), now],
      [{ ...sealed, iv: new Uint8Array(12) }, key, now], [{ ...sealed, tag: new Uint8Array(16) }, key, now],
      [{ ...sealed, ciphertext: sealed.ciphertext.slice(1) }, key, now],
    ] as const) expect(() => openUtilityProtectedInput(input, suppliedKey, at)).toThrow(UTILITY_PROTECTED_INPUT_ERROR);
    expect(() => sealUtilityProtectedInput(bytes, key, { ...scope, contentDigest: "0".repeat(64) }, now)).toThrow(UTILITY_PROTECTED_INPUT_ERROR);
    expect(() => sealUtilityProtectedInput(bytes, key.slice(1), scope, now)).toThrow(UTILITY_PROTECTED_INPUT_ERROR);
  });
  it("uses keyed commitments and owner/program-scoped stable account matching for small secrets", () => {
    const secret = new TextEncoder().encode("123456789"), owner = randomUUID();
    expect(utilityProtectedContentDigest(secret, key)).not.toBe(createHash("sha256").update(secret).digest("hex"));
    const match = utilityProtectedAccountFingerprint(key, owner, "pwd-tap", "123456789:19104");
    expect(utilityProtectedAccountFingerprint(key, owner, "pwd-tap", "123456789:19104")).toBe(match);
    for (const fingerprint of [utilityProtectedAccountFingerprint(key, randomUUID(), "pwd-tap", "123456789:19104"),
      utilityProtectedAccountFingerprint(key, owner, "pgw-crp", "123456789:19104"), utilityProtectedAccountFingerprint(new Uint8Array(32), owner, "pwd-tap", "123456789:19104"),
      utilityProtectedAccountFingerprint(key, owner, "pwd-tap", "123456788:19104")]) expect(fingerprint).not.toBe(match);
  });
});

describe("utility protected metadata contract", () => {
  it("contains no raw values, filename or small-secret commitment", () => {
    const scope = binding();
    const { format: _, need: __, policyVersion: ___, retentionPolicyVersion: ____, mediaType: _____, byteLength: ______, contentDigest: _______, ...safe } = scope;
    void _; void __; void ___; void ____; void _____; void ______; void _______;
    const reference = { ...safe, state: "stored", validation: null };
    expect(utilityProtectedInputReferenceSchema.safeParse(reference).success).toBe(true);
    for (const patch of [{ value: "123456789" }, { accessCode: "123456789" }, { filename: "private-123-45-6789.pdf" }, { contentDigest: scope.contentDigest }])
      expect(utilityProtectedInputReferenceSchema.safeParse({ ...reference, ...patch }).success).toBe(false);
  });
  it("requires consent and exact purpose-compatible targets before document or scalar capture", () => {
    const scope = binding(), input = { requestId: scope.requestId, expectedVersion: scope.requestVersion, programId: scope.programId,
      snapshotId: scope.snapshotId, snapshotRevision: scope.snapshotRevision, snapshotHash: scope.snapshotHash, inputId: scope.inputId,
      purpose: scope.purpose, targets: scope.targets, mediaType: scope.mediaType, byteLength: scope.byteLength,
      noticeVersion: UTILITY_PROTECTED_INPUT_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true, accountAuthorityDeclared: true };
    expect(utilityProtectedAuthorizationSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ consentAccepted: false }, { subjectAuthorityDeclared: false }, { accountAuthorityDeclared: false },
      { targets: [...scope.targets, scope.targets[0]] }, { purpose: "required_identifier" }, { mediaType: "application/octet-stream" },
      { purpose: "identity_proof", targets: [{ ...scope.targets[0], field: "identity", sourceId: null }] }, { ssn: "123-45-6789" }])
      expect(utilityProtectedAuthorizationSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    const scalar = { ...input, programId: "pwd-tap", purpose: "account_access", mediaType: "application/octet-stream", byteLength: 42,
      targets: [{ subjectId: scope.targets[0].subjectId, sourceId: null, field: "water_access_code" }] };
    expect(utilityProtectedAuthorizationSchema.safeParse(scalar).success).toBe(true);
    expect(utilityProtectedAuthorizationSchema.safeParse({ ...scalar, byteLength: 1025 }).success).toBe(false);
  });
});
