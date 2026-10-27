import { describe, expect, it } from "vitest";
import {
  applicationReadiness,
  supportRouteLabel,
  type ApplicationFieldEvidence,
} from "./application-readiness";
import { buildSupportPlan } from "./planning";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureNow,
  fixtureRequest,
} from "./test-fixtures";

const field: ApplicationFieldEvidence = {
  field: "householdSize",
  label: "People in your household",
  present: true,
  source: "parent",
  verifiedAt: fixtureNow.toISOString(),
  validUntil: "2026-11-01T12:00:00Z",
  conflicted: false,
};
function ready(): Parameters<typeof applicationReadiness>[0] {
  return {
    authority: {
      request: fixtureRequest(),
      operation: {
        need: "electricity",
        requestVersion: 1,
        programId: "peco-cap",
        action: "submit",
        dataCategories: ["household"],
        documentIds: [],
        packet: { zip: "19104", householdSize: 3 },
        idempotencyKey: "parent:exact-operation-v1",
      },
      capability: {
        programId: "peco-cap",
        enabled: true,
        actions: ["submit"],
        permissionReference: "synthetic-permission",
        permissionExpiresAt: "2026-11-01T12:00:00Z",
        dataCategories: ["household"],
        personalActsComplete: true,
      },
      accountActive: true,
      attempts: 0,
      now: fixtureNow,
      revoked: false,
      documentsValid: true,
    },
    requiredFields: [field],
    formVerified: true,
    transportReady: true,
  };
}
describe("automatic application handling", () => {
  it("keeps a program-purpose mismatch with the service instead of asking the family again", () => {
    const input = ready();
    input.authority.operation.need = "food_now";
    const result = applicationReadiness(input);
    expect(result.automaticHandlingAllowed).toBe(false);
    expect(result.authorityDeniedReason).toBe("need_not_authorized");
    expect(result.parentActionRequired).toBe(false);
  });

  it("does not request routine human review when the exact operation and all evidence are ready", () => {
    const result = applicationReadiness(ready());
    expect(result.automaticHandlingAllowed).toBe(true);
    expect(result.reviewRequired).toBe(false);
    expect(result.parentActionRequired).toBe(false);
    expect(result.blockers).toEqual([]);
  });
  it.each([
    { present: false },
    { source: "unverified" as const },
    { verifiedAt: null },
    { verifiedAt: "invalid" },
    { verifiedAt: "2026-10-26T12:00:00Z" },
    { validUntil: null },
    { validUntil: fixtureNow.toISOString() },
    { conflicted: true },
  ])(
    "requires resolution for incomplete or untrusted field evidence: %j",
    (override) => {
      const result = applicationReadiness({
        ...ready(),
        requiredFields: [{ ...field, ...override }],
      });
      expect(result.automaticHandlingAllowed).toBe(false);
      expect(result.blockers.map((check) => check.id)).toEqual([
        "field-householdSize",
      ]);
      expect(result.parentActionRequired).toBe(override.present === false);
    },
  );
  it("keeps provider and identity blockers visible even when a model score is high", () => {
    const input = ready();
    input.authority.capability.personalActsComplete = false;
    input.transportReady = false;
    input.modelJudgmentUsed = true;
    input.calibration = {
      score: 1,
      threshold: 0.9,
      evaluationId: "evaluated-route-version",
      evaluatedAt: fixtureNow.toISOString(),
      validUntil: "2026-11-01T12:00:00Z",
    };
    const result = applicationReadiness(input);
    expect(result.automaticHandlingAllowed).toBe(false);
    expect(result.parentActionRequired).toBe(true);
    expect(result.blockers.map((check) => check.id)).toEqual([
      "authority",
      "connected-submission",
    ]);
  });
  it("cannot substitute confidence for an unverified form or current provider permission", () => {
    const input = ready();
    input.authority.capability.enabled = false;
    input.formVerified = false;
    const result = applicationReadiness(input);
    expect(result.blockers.map((check) => check.id)).toEqual([
      "authority",
      "verified-form",
    ]);
    expect(result.parentActionRequired).toBe(false);
  });
  it("does not label disconnected service work as a parent task", () => {
    const input = ready();
    input.transportReady = false;
    expect(applicationReadiness(input).parentActionRequired).toBe(false);
  });
  it("requires a current tested score only for a decision that actually used model judgment", () => {
    const input = { ...ready(), modelJudgmentUsed: true };
    expect(applicationReadiness(input).automaticHandlingAllowed).toBe(false);
    const calibration = {
      score: 0.92,
      threshold: 0.9,
      evaluationId: "synthetic-route-eval",
      evaluatedAt: fixtureNow.toISOString(),
      validUntil: "2026-11-01T12:00:00Z",
    };
    expect(
      applicationReadiness({ ...input, calibration }).automaticHandlingAllowed,
    ).toBe(true);
    for (const override of [
      { score: 0.89 },
      { score: Number.NaN },
      { score: 1.1 },
      { threshold: 0 },
      { threshold: Number.POSITIVE_INFINITY },
      { evaluationId: " " },
      { validUntil: fixtureNow.toISOString() },
      { evaluatedAt: "2026-10-26T12:00:00Z" },
    ])
      expect(
        applicationReadiness({
          ...input,
          calibration: { ...calibration, ...override },
        }).automaticHandlingAllowed,
      ).toBe(false);
  });
  it("reuses current authorization, revocation and version checks instead of creating another authority path", () => {
    const input = ready();
    input.authority.request.version = 2;
    expect(applicationReadiness(input).automaticHandlingAllowed).toBe(false);
    input.authority.request.version = 1;
    input.authority.revoked = true;
    expect(applicationReadiness(input).automaticHandlingAllowed).toBe(false);
  });
});

describe("honest application labels", () => {
  const route = buildSupportPlan(
    fixtureIntake({ needs: ["snap_new"] }),
    fixtureMandate({ recipientIds: ["snap-pa"] }),
    fixtureNow,
  ).routes[0];
  it("distinguishes saved guidance, recorded information and an actual prepared form", () => {
    expect(supportRouteLabel(route)).toBe("Guidance ready");
    const operation = {
      programId: "snap-pa",
      need: "snap_new" as const,
      state: "prepared",
    };
    expect(supportRouteLabel(route, [operation])).toBe(
      "Information packet prepared",
    );
    expect(
      supportRouteLabel(route, [
        { ...operation, artifactId: "verified-form-artifact" },
      ]),
    ).toBe("Application prepared");
  });
  it("does not mistake a different journey or program’s artifact for the current application", () => {
    expect(
      supportRouteLabel(route, [
        {
          programId: "snap-pa",
          need: "snap_renewal",
          state: "prepared",
          artifactId: "other",
        },
      ]),
    ).toBe("Guidance ready");
    expect(
      supportRouteLabel(route, [
        {
          programId: "uesf-benefits",
          need: "snap_new",
          state: "prepared",
          artifactId: "other",
        },
      ]),
    ).toBe("Guidance ready");
  });
  it("retains the actual recorded outcome after submission", () => {
    expect(supportRouteLabel({ ...route, state: "agency_submitted" })).toBe(
      "Application submitted",
    );
  });
});
