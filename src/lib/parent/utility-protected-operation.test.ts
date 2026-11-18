import { describe, expect, it } from "vitest";
import { PECO_APPLICATION_SOURCE } from "./peco-application-fields";
import { PGW_APPLICATION_SOURCE } from "./pgw-application-fields";
import { WATER_APPLICATION_REFERENCE } from "./water-application-fields";
import { fixtureUtilityProtectedOperation } from "./utility-preparation-test-fixtures";
import { sameUtilityPreparedPacket, sameUtilityProtectedOperationBinding, utilityPreparedAad, utilityPreparedBindingSchema, utilityPreparedPacketSchema, utilityProtectedOperationSchema } from "./utility-protected-operation";

describe("opaque utility preparation operation", () => {
  it("binds only an unsigned local test water form, never an application submission or City receipt", () => {
    const value = utilityProtectedOperationSchema.parse(fixtureUtilityProtectedOperation());
    expect(value.action).toBe("prepare"); expect(value.packet.protectedUtilityPacket.preparationOnly).toBe(true);
    expect(value.packet.protectedUtilityPacket.sourceKind).toBe("local_test_issued_form");
    expect(value).not.toHaveProperty("receipt"); expect(value).not.toHaveProperty("personalActsComplete");
  });
  it.each(["ssn", "accessCode", "applicationId", "name", "signature", "object_path", "bytes", "filename", "extra"])("rejects raw or unexpected %s beside or inside its only opaque packet reference", field => {
    const packet = fixtureUtilityProtectedOperation().packet;
    expect(utilityPreparedPacketSchema.safeParse({ ...packet, [field]: "PRIVATE_CANARY" }).success).toBe(false);
    expect(utilityPreparedPacketSchema.safeParse({ protectedUtilityPacket: { ...packet.protectedUtilityPacket, [field]: "PRIVATE_CANARY" } }).success).toBe(false);
  });
  it.each([{ action: "submit" }, { state: "executing" }, { state: "agency_submitted" }, { state: "delivery_unknown" },
    { idempotencyKey: "a-different-key" }, { need: "gas" }, { requestVersion: 1 }, { programId: "pgw-crp" },
    { artifactId: "77777777-7777-4777-8777-777777777777" }, { documentIds: ["77777777-7777-4777-8777-777777777777"] },
    { dataCategories: ["household", "income"] }, { dataCategories: ["household", "income", "utility", "utility"] },
    { personalActsComplete: true }, { protectedPacketCurrent: "true" },
  ])("rejects a changed or expanded preparation binding: %j", patch => {
    expect(utilityProtectedOperationSchema.safeParse({ ...fixtureUtilityProtectedOperation(), ...patch }).success).toBe(false);
  });
  it.each([{ sourceKind: "official_public_form" }, { templateId: "city-sample-relabeled-issued" }, { preparationOnly: false },
    { expiresAt: "2026-11-13T22:20:00.000Z" }, { byteLength: 8 }, { snapshotHash: "secret" },
  ])("does not promote a sample, remove preparation limits or extend a malformed reference: %j", patch => {
    const value = fixtureUtilityProtectedOperation();
    expect(utilityProtectedOperationSchema.safeParse({ ...value, packet: { protectedUtilityPacket: { ...value.packet.protectedUtilityPacket, ...patch } } }).success).toBe(false);
  });
  it.each([["peco-cap", "electricity"], ["pgw-crp", "gas"]] as const)("supports the checked public %s form only as preparation", (programId, need) => {
    const value = fixtureUtilityProtectedOperation();
    const source = programId === "peco-cap" ? { id: PECO_APPLICATION_SOURCE.contractId, version: PECO_APPLICATION_SOURCE.contractVersion, hash: PECO_APPLICATION_SOURCE.sourceSha256 }
      : { id: PGW_APPLICATION_SOURCE.id, version: PGW_APPLICATION_SOURCE.version, hash: PGW_APPLICATION_SOURCE.sourceSha256 };
    const changed = { ...value, programId, need, packet: { protectedUtilityPacket: { ...value.packet.protectedUtilityPacket, programId, sourceKind: "official_public_form", templateId: source.id, templateVersion: source.version, templateSha256: source.hash } } };
    expect(utilityProtectedOperationSchema.safeParse(changed).success).toBe(true);
    expect(utilityProtectedOperationSchema.safeParse({ ...changed, packet: { protectedUtilityPacket: { ...changed.packet.protectedUtilityPacket, templateSha256: "f".repeat(64) } } }).success).toBe(false);
  });
  it("rejects the water SAMPLE hash even when relabeled as a local issued form", () => {
    const value = fixtureUtilityProtectedOperation();
    expect(utilityProtectedOperationSchema.safeParse({ ...value, packet: { protectedUtilityPacket: { ...value.packet.protectedUtilityPacket, templateSha256: WATER_APPLICATION_REFERENCE.sampleSha256 } } }).success).toBe(false);
  });
  it("normalizes only input order and rejects duplicate or expanded input bindings", () => {
    const value = fixtureUtilityProtectedOperation().packet.protectedUtilityPacket;
    const second = { ...value.inputs[0], inputId: "77777777-7777-4777-8777-777777777777" };
    expect(sameUtilityPreparedPacket({ protectedUtilityPacket: { ...value, inputs: [second, ...value.inputs] } }, { protectedUtilityPacket: { ...value, inputs: [...value.inputs, second] } })).toBe(true);
    expect(utilityPreparedPacketSchema.safeParse({ protectedUtilityPacket: { ...value, inputs: [...value.inputs, ...value.inputs] } }).success).toBe(false);
    expect(utilityPreparedPacketSchema.safeParse({ protectedUtilityPacket: { ...value, inputs: [{ ...value.inputs[0], raw: "PRIVATE_CANARY" }] } }).success).toBe(false);
  });
  it("keeps currentness mutable while any immutable operation, file, source or input change has a different binding", () => {
    const value = utilityProtectedOperationSchema.parse(fixtureUtilityProtectedOperation());
    expect(sameUtilityProtectedOperationBinding(value, { ...value, protectedPacketCurrent: false })).toBe(true);
    for (const patch of [{ operationId: "77777777-7777-4777-8777-777777777777" }, { packetHash: "e".repeat(64) }])
      expect(sameUtilityProtectedOperationBinding(value, { ...value, ...patch })).toBe(false);
    const changed = structuredClone(value); changed.packet.protectedUtilityPacket.inputs[0].authorizationId = "77777777-7777-4777-8777-777777777777";
    expect(sameUtilityProtectedOperationBinding(value, changed)).toBe(false);
  });
  it("authenticates the exact owner, operation/hash/key and original expiry without authenticating a mutable currentness flag", () => {
    const binding = { format: "caselink-utility-preparation-v1", ownerId: "88888888-8888-4888-8888-888888888888", mandateHash: "e".repeat(64), inputSetHash: "f".repeat(64), operation: fixtureUtilityProtectedOperation() };
    const value = utilityPreparedBindingSchema.parse(binding), aad = utilityPreparedAad(value);
    expect(utilityPreparedAad({ ...value, operation: { ...value.operation, protectedPacketCurrent: false } })).toEqual(aad);
    expect(utilityPreparedAad({ ...value, ownerId: "99999999-9999-4999-8999-999999999999" })).not.toEqual(aad);
    const changed = structuredClone(value); changed.operation.packet.protectedUtilityPacket.expiresAt = "2026-11-13T22:26:00.000Z";
    expect(utilityPreparedAad(changed)).not.toEqual(aad);
    expect(new TextDecoder().decode(aad)).toContain(value.operation.packetHash);
  });
});
