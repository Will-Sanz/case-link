import type { UtilityProtectedOperation } from "./utility-protected-operation";

/** Fictional metadata only; no provider form, personal act or receipt is established. */
export function fixtureUtilityProtectedOperation(): UtilityProtectedOperation {
  const packetId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
  return { operationId: "33333333-3333-4333-8333-333333333333", requestId, requestVersion: 2, need: "water", programId: "pwd-tap",
    action: "prepare", state: "prepared", packet: { protectedUtilityPacket: {
      packetId, requestId, requestVersion: 2, programId: "pwd-tap", snapshotId: "44444444-4444-4444-8444-444444444444", snapshotRevision: 1, snapshotHash: "a".repeat(64),
      inputs: [{ inputId: "55555555-5555-4555-8555-555555555555", authorizationId: "66666666-6666-4666-8666-666666666666", validationId: null }],
      sourceKind: "local_test_issued_form", templateId: "caselink-local-water-issued-form", templateVersion: "local-test-v1", templateSha256: "b".repeat(64), rendererVersion: "local-water-test-v1",
      policyVersion: "local-test-policy-v1", retentionPolicyVersion: "local-test-retention-v1",
      preparedAt: "2026-11-13T22:20:00.000Z", expiresAt: "2026-11-13T22:25:00.000Z", contentSha256: "c".repeat(64), byteLength: 1024, preparationOnly: true,
    } }, packetHash: "d".repeat(64), dataCategories: ["household", "income", "utility"], documentIds: [], artifactId: null,
    idempotencyKey: `utility-prepare:${packetId}`, protectedPacketCurrent: true };
}
