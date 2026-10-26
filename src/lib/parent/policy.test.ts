import { describe, it, expect } from "vitest";
import {
  authorizeOperation,
  validateMandate,
  validateReceipt,
  type ProviderCapability,
  type ProposedOperation,
} from "./policy";
import {
  fixtureNow,
  fixtureRequest,
  fixtureMandate,
  fixtureIntake,
} from "./test-fixtures";
const capability: ProviderCapability = {
  programId: "peco-cap",
  enabled: true,
  actions: ["submit"],
  permissionReference: "synthetic-agreement-v1",
  permissionExpiresAt: "2026-11-25T00:00:00Z",
  dataCategories: ["household", "utility"],
  personalActsComplete: true,
};
const operation: ProposedOperation = {
  requestVersion: 1,
  programId: "peco-cap",
  action: "submit",
  dataCategories: ["household", "utility"],
  documentIds: [],
  packet: { amountDue: 50 },
  idempotencyKey: "synthetic-operation-1",
};
const input = () => ({
  request: fixtureRequest(),
  operation: { ...operation },
  capability: { ...capability },
  accountActive: true,
  attempts: 0,
  now: fixtureNow,
  revoked: false,
  documentsValid: true,
});
describe("deterministic parent authority", () => {
  it("accepts a fresh exact-need authority fact while keeping another utility unauthorized", () => {
    const request = fixtureRequest({
      intake: fixtureIntake({
        needs: ["electricity", "gas"],
        accountAuthority: "not_sure",
      }),
      mandate: fixtureMandate({ recipientIds: ["peco-cap", "pgw-crp"] }),
    });
    request.facts = [
      {
        need: "electricity",
        field: "accountAuthority",
        value: "self",
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
    ];
    expect(
      authorizeOperation({
        ...input(),
        request,
        operation: {
          ...operation,
          need: "electricity",
          packet: { amountDue: 50, accountAuthority: "self" },
        },
      }).allowed,
    ).toBe(true);
    expect(
      authorizeOperation({
        ...input(),
        request,
        operation: {
          ...operation,
          need: "gas",
          programId: "pgw-crp",
          packet: { amountDue: 50, accountAuthority: "self" },
        },
        capability: { ...capability, programId: "pgw-crp" },
      }).allowed,
    ).toBe(false);
    expect(
      authorizeOperation({
        ...input(),
        request,
        operation: {
          ...operation,
          need: "electricity",
          packet: { amountDue: 50, accountAuthority: "authorized_caregiver" },
        },
      }).allowed,
    ).toBe(false);
  });
  it("permits an exact in-scope action and denies changed authority or facts", () => {
    expect(authorizeOperation(input())).toEqual({ allowed: true });
    const cases = [
      { revoked: true },
      { accountActive: false },
      { attempts: 12 },
      { request: fixtureRequest({ status: "cancelled" }) },
      { request: fixtureRequest({ version: 2 }) },
      { capability: { ...capability, enabled: false } },
      { capability: { ...capability, permissionExpiresAt: "invalid" } },
      { capability: { ...capability, personalActsComplete: false } },
      { operation: { ...operation, programId: "unexpected-partner" } },
      { operation: { ...operation, dataCategories: ["income"] as const } },
    ];
    for (const change of cases)
      expect(
        authorizeOperation({ ...input(), ...change } as Parameters<
          typeof authorizeOperation
        >[0]).allowed,
      ).toBe(false);
  });
  it("continues food work while utility account authority is unresolved", () => {
    const request = fixtureRequest({
      intake: fixtureIntake({ accountAuthority: "not_sure" }),
    });
    expect(authorizeOperation({ ...input(), request }).allowed).toBe(false);
    expect(
      authorizeOperation({
        ...input(),
        request,
        operation: {
          ...operation,
          programId: "philly-food",
          dataCategories: ["household"],
          packet: { householdSize: 3 },
        },
        capability: { ...capability, programId: "philly-food" },
      }),
    ).toEqual({ allowed: true });
  });
  it("rejects expiry, unknown recipients, document scope expansion and untrusted receipts", () => {
    expect(
      validateMandate(
        fixtureMandate({ expiresAt: "2026-10-24T00:00:00Z" }),
        fixtureNow,
      ),
    ).toBe("invalid_expiry");
    expect(
      validateMandate(
        fixtureMandate({ recipientIds: ["unknown"] }),
        fixtureNow,
      ),
    ).toBe("unknown_recipient");
    expect(
      authorizeOperation({
        ...input(),
        documentsValid: false,
        operation: { ...operation, documentIds: ["unapproved-document"] },
      }).allowed,
    ).toBe(false);
    expect(
      validateReceipt({
        state: "support_received",
        source: "parent_report",
        reference: "I opened a link",
        recordedAt: fixtureNow.toISOString(),
      }),
    ).toBe(false);
    expect(
      validateReceipt({
        state: "sent",
        source: "provider_api",
        reference: "synthetic-transport-123",
        recordedAt: fixtureNow.toISOString(),
      }),
    ).toBe(true);
  });
});
