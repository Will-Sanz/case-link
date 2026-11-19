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
  fixtureProtectedSnapOperation,
} from "./test-fixtures";

describe("receipt timestamps", () => {
  it.each(["2026-10-25T12:00:00Z", "2026-10-25T12:00:00+00:00", "2026-10-25T17:30:00+05:30"])("accepts the valid explicit timezone in %s", (recordedAt) => {
    expect(validateReceipt({ state: "agency_submitted", source: "authenticated_partner",
      reference: "Synthetic timestamp regression", recordedAt })).toBe(true);
  });
  it.each(["2026-10-25", "2026-10-25T12:00:00", "2026-10-25T12:00:00+25:00", "2026-10-25T12:00:00+05:99", "2026-02-30T12:00:00Z", "not-a-time"])("rejects an invalid or ambiguous timestamp %s", (recordedAt) => {
    expect(validateReceipt({ state: "agency_submitted", source: "authenticated_partner",
      reference: "Synthetic timestamp regression", recordedAt })).toBe(false);
  });
});
describe("attributed agency next steps", () => {
  const receipt = { state: "agency_submitted", source: "agency_receipt", reference: "Synthetic application receipt", recordedAt: "2026-11-07T15:00:00Z" };
  const status = { reference: "Synthetic DHS notice", observedAt: "2026-11-07T14:00:00Z",
    documents: [{ name: "Pay stubs for October", dueDate: "2026-11-18" }],
    interview: { scheduledAt: "2026-11-12T14:30:00-05:00", channel: "phone" } };
  it("accepts exact source-recorded document, interview and waiting evidence without inventing dates", () => {
    expect(validateReceipt({ ...receipt, agencyStatus: status })).toBe(true);
    expect(validateReceipt({ ...receipt, agencyStatus: { ...status, waitingForDecision: true } })).toBe(true);
    expect(validateReceipt({ ...receipt, agencyStatus: { reference: status.reference, observedAt: status.observedAt, waitingForDecision: true } })).toBe(true);
    expect(validateReceipt({ ...receipt, agencyStatus: { reference: status.reference, observedAt: status.observedAt, interview: {} } })).toBe(true);
  });
  it.each(["sent", "partner_received", "partner_accepted"])("never turns %s into agency status evidence", state => {
    expect(validateReceipt({ ...receipt, state, agencyStatus: status })).toBe(false);
  });
  it.each([
    { ...status, instructions: "An unsupported notice instruction" },
    { ...status, reference: " " },
    { ...status, observedAt: "2026-11-07T16:00:00Z" },
    { ...status, observedAt: "2026-11-07T14:00:00" },
    { ...status, documents: [] },
    { ...status, documents: [{ name: "Pay stubs", dueDate: "2026-02-30" }] },
    { ...status, documents: [{ name: "<a href='https://untrusted.example'>Document</a>" }] },
    { ...status, documents: [{ name: "SSN: 123-45-6789" }] },
    { ...status, documents: [{ name: "Pay stubs", url: "https://untrusted.example" }] },
    { ...status, interview: { scheduledAt: "tomorrow" } },
    { ...status, interview: { channel: "invented" } },
    { ...status, interview: { instructions: "Enter a secret elsewhere" } },
    { reference: status.reference, observedAt: status.observedAt },
    { ...status, documents: Array.from({ length: 8 }, () => ({ name: "証".repeat(160) })) },
  ])("rejects malformed, unsafe, contradictory or oversized agency evidence %#", agencyStatus => {
    expect(validateReceipt({ ...receipt, agencyStatus })).toBe(false);
  });
  it.each(["assistance_approved", "support_received", "declined"])("does not say waiting for a decision after %s", state => {
    expect(validateReceipt({ ...receipt, state, agencyStatus: { reference: status.reference, observedAt: status.observedAt, waitingForDecision: true } })).toBe(false);
  });
});
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
describe("exact private SNAP operation authority", () => {
  function protectedInput() {
    const canonical = fixtureProtectedSnapOperation({ personalActsComplete: true, snapSubmissionAuthorized: true });
    return { ...input(), request: fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"], zip: "19000" }), mandate: fixtureMandate({ recipientIds: ["snap-pa"] }) }),
      operation: { need: "snap_new", requestVersion: 1, programId: "snap-pa", action: "submit", dataCategories: canonical.dataCategories,
        documentIds: [], packet: canonical.packet, idempotencyKey: canonical.idempotencyKey, protectedSnap: canonical } as ProposedOperation,
      capability: { ...capability, programId: "snap-pa", dataCategories: ["household", "income"], permissionVersion: canonical.permissionVersion } as ProviderCapability };
  }
  it("uses exact current private source validation without asking again for protected routing facts", () => {
    expect(authorizeOperation(protectedInput())).toEqual({ allowed: true });
  });
  it("does not authorize another execution from read-only executing metadata even with all readiness flags true", () => {
    const value = protectedInput(); value.operation.protectedSnap!.state = "executing";
    expect(authorizeOperation(value)).toEqual({ allowed: false, reason: "invalid_protected_operation" });
  });
  it.each(["protectedPacketCurrent", "protectedParentSubmitReady", "personalActsComplete", "snapSubmissionAuthorized"] as const)("requires the exact database %s flag", field => {
    const value = protectedInput(); value.operation.protectedSnap![field] = false; expect(authorizeOperation(value).allowed).toBe(false);
  });
  it.each(["requestId", "requestVersion", "permissionVersion", "idempotencyKey", "packetHash"] as const)("denies changed canonical %s", field => {
    const value = protectedInput();
    if (field === "requestVersion") value.operation.protectedSnap!.requestVersion++;
    else if (field === "packetHash") value.operation.protectedSnap!.packetHash = "not-a-digest";
    else value.operation.protectedSnap![field] = "different";
    expect(authorizeOperation(value).allowed).toBe(false);
  });
  it("does not accept an unbound reference or hidden raw fields", () => {
    const value = protectedInput(); delete value.operation.protectedSnap; expect(authorizeOperation(value).allowed).toBe(false);
    const hidden = protectedInput(); hidden.operation.packet = { ...hidden.operation.packet, ssn: "PRIVATE_CANARY" }; expect(authorizeOperation(hidden).allowed).toBe(false);
    const dangling = protectedInput(); dangling.operation.packet = { zip: "19104" }; expect(authorizeOperation(dangling).allowed).toBe(false);
  });
});
describe("deterministic parent authority", () => {
  it.each(["snap_renewal", "snap_pending", "snap_problem", "wic_new", "wic_continuing"] as const)("rejects unverified initial actions for %s despite an enabled program", need => {
    const programId = need.startsWith("snap_") ? "snap-pa" : "wic-pa";
    for (const action of ["submit", "share", "schedule"] as const) {
      expect(authorizeOperation({ ...input(), request: fixtureRequest({ intake: fixtureIntake({ needs: [need] }), mandate: fixtureMandate({ recipientIds: [programId] }) }),
        operation: { ...operation, need, programId, action }, capability: { ...capability, programId, actions: [action] } })).toEqual({ allowed: false, reason: "journey_not_supported" });
    }
  });
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
      ).toEqual(need === "snap_new" ? { allowed: true } : { allowed: false, reason: "journey_not_supported" });
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
