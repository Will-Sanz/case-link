import { describe, expect, it } from "vitest";
import { fixtureProtectedSnapOperation } from "./test-fixtures";
import { sameSnapProtectedOperationBinding, sameSnapProtectedPacket, snapProtectedOperationSchema, snapProtectedPacketSchema, snapProtectedDeliveryAttempt } from "./snap-protected-operation";
import { snapProtectedSubmissionResultSchema } from "./snap-protected-submission-port";

describe("strict opaque canonical SNAP metadata", () => {
  it.each(["executing", "delivery_unknown", "sent", "partner_received", "partner_accepted", "agency_submitted", "assistance_approved", "support_received", "declined", "unresolved"])("recognizes the recorded %s attempt without calling it an agency receipt", state => {
    expect(snapProtectedDeliveryAttempt(state)).toBe(true);
  });
  it.each(["checking", "prepared", "withdrawn", "unknown", ""])("does not treat %s as a delivery attempt", state => {
    expect(snapProtectedDeliveryAttempt(state)).toBe(false);
  });
  it("accepts an executing canonical row for read-only inspection without changing its binding", () => {
    const prepared = fixtureProtectedSnapOperation(), executing = snapProtectedOperationSchema.parse({ ...prepared, state: "executing", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    expect(executing.state).toBe("executing"); expect(sameSnapProtectedOperationBinding(prepared, executing)).toBe(true);
  });
  it("accepts the exact synthetic reference with no PDF fields and compares bindings independently from mutable flags", () => {
    const value = snapProtectedOperationSchema.parse(fixtureProtectedSnapOperation());
    expect(sameSnapProtectedOperationBinding(value, { ...value, snapSubmissionAuthorized: true, personalActsComplete: true })).toBe(true);
    expect(sameSnapProtectedOperationBinding(value, { ...value, packetHash: "d".repeat(64) })).toBe(false);
    const reordered = Object.fromEntries(Object.entries(value.packet.protectedSnapPacket).reverse());
    expect(sameSnapProtectedPacket(value.packet, { protectedSnapPacket: reordered })).toBe(true);
  });
  it.each(["ssn", "signature", "object_path", "bytes", "extra"])("rejects raw or unexpected %s beside the opaque reference", field => {
    const packet = fixtureProtectedSnapOperation().packet;
    expect(snapProtectedPacketSchema.safeParse({ ...packet, [field]: "PRIVATE_SYNTHETIC_CANARY" }).success).toBe(false);
    expect(snapProtectedPacketSchema.safeParse({ protectedSnapPacket: { ...packet.protectedSnapPacket, [field]: "PRIVATE_SYNTHETIC_CANARY" } }).success).toBe(false);
  });
  it.each([{ idempotencyKey: "another-operation" }, { requestVersion: 0 }, { artifactId: "11111111-1111-4111-8111-111111111111" },
    { dataCategories: ["utility"] }, { documentIds: ["11111111-1111-4111-8111-111111111111"] }, { protectedPacketCurrent: "true" },
    { personalActsComplete: 1 }, { snapSubmissionAuthorized: null }])("rejects an invalid canonical binding %j", change => {
    expect(snapProtectedOperationSchema.safeParse({ ...fixtureProtectedSnapOperation(), ...change }).success).toBe(false);
  });
});

describe("isolated SNAP submission metadata results", () => {
  const bound = { operationId: fixtureProtectedSnapOperation().operationId, packetId: fixtureProtectedSnapOperation().packet.protectedSnapPacket.packetId, contentSha256: "b".repeat(64) };
  const receipt = { reference: "synthetic-only", recordedAt: "2026-11-04T12:00:00Z" };
  it.each([["sent", "provider_api"], ["agency_submitted", "agency_receipt"]])("allows only the attributed %s/%s result", (state, source) => {
    expect(snapProtectedSubmissionResultSchema.safeParse({ ...bound, receipt: { ...receipt, state, source } }).success).toBe(true);
  });
  it.each([["agency_submitted", "provider_api"], ["agency_submitted", "operator_confirmed"], ["support_received", "agency_receipt"], ["partner_received", "provider_api"]])("rejects unsupported or promoted evidence %s/%s", (state, source) => {
    expect(snapProtectedSubmissionResultSchema.safeParse({ ...bound, receipt: { ...receipt, state, source } }).success).toBe(false);
  });
  it("keeps unknown delivery distinct and rejects response content", () => {
    expect(snapProtectedSubmissionResultSchema.parse({ ...bound, state: "delivery_unknown" })).toMatchObject({ state: "delivery_unknown" });
    expect(snapProtectedSubmissionResultSchema.safeParse({ ...bound, state: "delivery_unknown", pdf: "PRIVATE_CANARY" }).success).toBe(false);
  });
});
