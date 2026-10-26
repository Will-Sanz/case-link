import { describe, it, expect, vi } from "vitest";
import { executeSupportOperation } from "./execution";
import { fixtureNow, fixtureRequest } from "./test-fixtures";
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
  };
}
describe("execution side effect and receipts", () => {
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
