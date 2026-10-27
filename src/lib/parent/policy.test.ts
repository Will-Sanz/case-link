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
  it.each(["stale", "excluded", "other_need", "outside"])(
    "requires current permitted routing for new work even when ZIP is unsent: %s",
    (source) => {
      const test = input();
      test.operation.dataCategories = ["utility"];
      if (source === "stale") test.request.intake_confirmed_at = { zip: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString() };
      if (source === "excluded") test.request.mandate.allowedData = ["utility"];
      if (source === "outside") test.request.intake.zip = "10001";
      if (source === "other_need") {
        test.request.intake_need_scoped_fields = ["zip"];
        test.request.facts = [{ need: "food_now", field: "zip", value: "19104", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" }];
      }
      expect(authorizeOperation(test)).toEqual({ allowed: false, reason: "routing_source_not_current" });
    },
  );
  it("exempts only verified linked follow-up from new-work routing", () => {
    const test = input();
    test.request.intake.zip = "10001";
    test.operation.action = "follow_up";
    test.capability.actions = ["follow_up"];
    expect(authorizeOperation(test).allowed).toBe(false);
    test.operation.packet = { statusReference: "known-receipt" };
    test.operation.dataCategories = ["household"];
    expect(authorizeOperation(test)).toEqual({ allowed: false, reason: "unverified_status_reference" });
    expect(authorizeOperation({ ...test, statusReferences: ["known-receipt"] }).allowed).toBe(true);
    test.operation.packet = { statusReference: "known-receipt", householdSize: 10 };
    expect(authorizeOperation({ ...test, statusReferences: ["known-receipt"] }).allowed).toBe(false);
  });
  it.each(["zip", "householdSize", "incomeAmount", "incomeFrequency"] as const)(
    "requires a matching current owned source for packet %s",
    (field) => {
      const test = input();
      test.request.intake = fixtureIntake({ incomeAmount: 0, incomeFrequency: "monthly" });
      test.operation = { ...operation, need: "electricity", dataCategories: ["household", "income"], packet: { [field]: test.request.intake[field] } };
      test.capability.dataCategories = ["household", "income"];
      expect(authorizeOperation(test).allowed).toBe(true);
      test.request.intake_confirmed_at = { [field]: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString() };
      expect(authorizeOperation(test)).toEqual({ allowed: false, reason: "packet_source_not_current" });
      test.request.intake_confirmed_at = { [field]: fixtureNow.toISOString() };
      test.request.intake_need_scoped_fields = [field];
      expect(authorizeOperation(test).allowed).toBe(false);
      const income = field === "incomeAmount" || field === "incomeFrequency";
      test.request.facts = [{
        need: "food_now", field: income ? "income" : field,
        value: income ? { amount: 0, frequency: "monthly" } : test.request.intake[field],
        source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25",
      }];
      expect(authorizeOperation(test).allowed).toBe(false);
      test.request.facts[0].need = "electricity";
      expect(authorizeOperation(test).allowed).toBe(true);
      test.operation.packet = { [field]: field === "zip" ? "19103" : field === "incomeFrequency" ? "weekly" : 10 };
      expect(authorizeOperation(test).allowed).toBe(false);
    },
  );
  it.each(["research", "prepare", "share", "submit", "schedule", "follow_up"] as const)(
    "rejects a mismatched or unrequested need before %s even when the recipient is named",
    (action) => {
      for (const need of ["food_now", "electricity", undefined] as const) {
        const test = input();
        test.request.intake = fixtureIntake({ needs: ["food_now"] });
        test.operation = {
          ...operation,
          need,
          action,
          dataCategories: ["household"],
          packet: { zip: "19104" },
        };
        test.capability = {
          ...capability,
          actions: [action],
          dataCategories: ["household"],
        };
        expect(authorizeOperation(test)).toEqual({
          allowed: false,
          reason: "need_not_authorized",
        });
      }
    },
  );

  it("does not infer a purpose when one recipient serves multiple requested journeys", () => {
    const test = input();
    test.request = fixtureRequest({
      intake: fixtureIntake({ needs: ["snap_new", "snap_renewal"] }),
      mandate: fixtureMandate({ recipientIds: ["uesf-benefits"] }),
    });
    test.operation = {
      ...operation,
      programId: "uesf-benefits",
      dataCategories: ["household"],
      packet: { householdSize: 3 },
    };
    test.capability = { ...capability, programId: "uesf-benefits" };
    expect(authorizeOperation(test)).toEqual({
      allowed: false,
      reason: "need_not_authorized",
    });
    for (const need of ["snap_new", "snap_renewal"] as const)
      expect(
        authorizeOperation({
          ...test,
          operation: { ...test.operation, need },
        }),
      ).toEqual({ allowed: true });
    test.request.intake = fixtureIntake({ needs: ["snap_new"] });
    expect(authorizeOperation(test)).toEqual({ allowed: true });
  });

  it.each([null, "", "career_support", "water", { need: "electricity" }])(
    "rejects a foreign or malformed purpose at the runtime boundary: %j",
    (need) => {
      const test = input();
      test.operation = { ...operation, need } as ProposedOperation;
      expect(authorizeOperation(test)).toEqual({
        allowed: false,
        reason: "need_not_authorized",
      });
    },
  );

  it("does not make an unknown program executable by naming it in both permission records", () => {
    const test = input();
    test.request.mandate.recipientIds = ["unknown-program"];
    test.operation.programId = "unknown-program";
    test.capability.programId = "unknown-program";
    expect(authorizeOperation(test)).toEqual({
      allowed: false,
      reason: "need_not_authorized",
    });
  });

  it("denies an old provider route after a same-need provider correction", () => {
    const test = input();
    test.request.facts = [
      {
        need: "electricity",
        field: "utilityProvider",
        value: "other",
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
    ];
    expect(authorizeOperation(test)).toEqual({
      allowed: false,
      reason: "provider_account_mismatch",
    });
    const mismatch = input();
    mismatch.operation.packet = { utilityProvider: "pgw" };
    expect(authorizeOperation(mismatch)).toEqual({
      allowed: false,
      reason: "provider_account_mismatch",
    });
  });

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
