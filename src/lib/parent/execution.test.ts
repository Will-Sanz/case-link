import { describe, it, expect, vi } from "vitest";
import { executeSupportOperation } from "./execution";
import { fixtureIntake, fixtureNow, fixtureRequest } from "./test-fixtures";
import type { ProposedOperation, ProviderCapability } from "./policy";
function setup() {
  const operation: ProposedOperation = {
    requestVersion: 1,
    programId: "peco-cap",
    action: "submit",
    dataCategories: ["utility"],
    documentIds: [],
    packet: { amountDue: 50 },
    idempotencyKey: "synthetic-operation-1",
  };
  const capability: ProviderCapability = {
    programId: "peco-cap",
    enabled: true,
    actions: ["submit"],
    permissionReference: "synthetic-contract-1",
    permissionExpiresAt: "2026-11-20T00:00:00Z",
    dataCategories: ["utility"],
    personalActsComplete: true,
  };
  const store = {
    prepare: vi.fn(async () => "synthetic-operation"),
    begin: vi.fn(async () => ({
      operationId: "synthetic-operation",
      packet: { amountDue: 50 },
      packetHash: "database-hash",
    })),
    finish: vi.fn(async () => {}),
  };
  const transport = {
    execute: vi.fn(async () => ({
      state: "agency_submitted",
      source: "agency_receipt",
      reference: "synthetic-receipt",
      recordedAt: fixtureNow.toISOString(),
    })),
  };
  return {
    request: fixtureRequest(),
    operation,
    capability,
    store,
    transport,
    now: fixtureNow,
    accountActive: true,
    attempts: 0,
    revoked: false,
    documentsValid: true,
    readiness: { requiredFields: [], formVerified: true },
  };
}
describe("execution side effect and receipts", () => {
  it("cannot prepare or dispatch a named recipient's operation for a different requested purpose", async () => {
    const input = setup();
    input.request.intake = fixtureIntake({ needs: ["food_now"] });
    input.operation = {
      ...input.operation,
      need: "food_now",
      dataCategories: ["household"],
      packet: { householdSize: 3 },
    };
    input.capability.dataCategories = ["household"];
    expect(await executeSupportOperation(input)).toEqual({
      state: "blocked",
      reason: "need_not_authorized",
    });
    expect(input.store.prepare).not.toHaveBeenCalled();
    expect(input.store.begin).not.toHaveBeenCalled();
    expect(input.transport.execute).not.toHaveBeenCalled();
  });

  it("blocks actual dispatch until required application evidence is current and the form is verified", async () => {
    const input = setup();
    const incomplete = {
      ...input,
      readiness: {
        requiredFields: [
          {
            field: "householdSize",
            label: "People in your household",
            present: false,
            source: "unverified" as const,
            verifiedAt: null,
            validUntil: null,
            conflicted: false,
          },
        ],
        formVerified: true,
      },
    };
    expect(await executeSupportOperation(incomplete)).toEqual({
      state: "blocked",
      reason: "application_evidence_requires_resolution",
    });
    expect(
      await executeSupportOperation({
        ...input,
        readiness: { requiredFields: [], formVerified: false },
      }),
    ).toEqual({
      state: "blocked",
      reason: "application_evidence_requires_resolution",
    });
    expect(input.store.prepare).not.toHaveBeenCalled();
    expect(input.transport.execute).not.toHaveBeenCalled();
  });
  it("does not replace measured decision readiness with a routine final-review click", async () => {
    const input = setup();
    const readiness = {
      requiredFields: [],
      formVerified: true,
      modelJudgmentUsed: true,
    };
    expect((await executeSupportOperation({ ...input, readiness })).state).toBe(
      "blocked",
    );
    expect(input.transport.execute).not.toHaveBeenCalled();
    const approved = await executeSupportOperation({
      ...input,
      readiness: {
        ...readiness,
        calibration: {
          score: 0.92,
          threshold: 0.9,
          evaluationId: "versioned-synthetic-route-evaluation",
          evaluatedAt: fixtureNow.toISOString(),
          validUntil: "2026-11-01T12:00:00Z",
        },
      },
    });
    expect(approved.state).toBe("agency_submitted");
    expect(input.transport.execute).toHaveBeenCalledOnce();
  });
  it("rechecks database authority before transport and retains exact receipt", async () => {
    const input = setup();
    expect(await executeSupportOperation(input)).toMatchObject({
      state: "agency_submitted",
      receipt: { reference: "synthetic-receipt" },
    });
    expect(input.transport.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        packet: input.operation.packet,
        packetHash: "database-hash",
        idempotencyKey: input.operation.idempotencyKey,
      }),
    );
    expect(input.store.finish).toHaveBeenCalledWith(
      "synthetic-operation",
      "agency_submitted",
      expect.objectContaining({ reference: "synthetic-receipt" }),
    );
  });
  it("cannot send after revocation and treats uncertain delivery as reconciliation", async () => {
    const revoked = setup();
    await executeSupportOperation({ ...revoked, revoked: true });
    expect(revoked.store.begin).not.toHaveBeenCalled();
    expect(revoked.transport.execute).not.toHaveBeenCalled();
    const uncertain = setup();
    uncertain.transport.execute.mockRejectedValue(new Error("timeout"));
    expect(await executeSupportOperation(uncertain)).toEqual({
      state: "delivery_unknown",
    });
    expect(uncertain.transport.execute).toHaveBeenCalledTimes(1);
    expect(uncertain.store.finish).toHaveBeenCalledWith(
      "synthetic-operation",
      "delivery_unknown",
      expect.objectContaining({ reason: "receipt_requires_reconciliation" }),
    );
  });
  it("rejects hidden data in a misleading category and database-denied dispatch", async () => {
    const input = setup();
    expect(
      (
        await executeSupportOperation({
          ...input,
          operation: {
            ...input.operation,
            packet: { ssn: "synthetic-excluded" },
          },
        })
      ).state,
    ).toBe("blocked");
    expect(input.store.prepare).not.toHaveBeenCalled();
    const raced = setup();
    raced.store.begin.mockRejectedValue(new Error("revoked atomically"));
    await expect(executeSupportOperation(raced)).rejects.toThrow(
      "revoked atomically",
    );
    expect(raced.transport.execute).not.toHaveBeenCalled();
  });
});
