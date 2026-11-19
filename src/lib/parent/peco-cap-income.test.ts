import { describe, expect, it } from "vitest";
import { assessPecoCapIncomeEvidence, type PecoCapIncomeInput } from "./peco-cap-income";

const now = new Date("2026-10-26T12:00:00Z");
const binding: PecoCapIncomeInput["scope"]["binding"] = {
  requestId: "request-1",
  householdId: "household-1",
  requestVersion: 2,
  accountRef: "account-1",
  programId: "peco-cap",
  need: "electricity",
  purpose: "income_preparation",
};
const validation = {
  binding,
  provenanceRef: "source-check-1",
  verifiedAt: "2026-10-26T10:00:00Z",
  validUntil: "2026-12-01T00:00:00Z",
};
const target = {
  subjectId: "adult-1",
  sourceId: "job-1"
};
const proof = {
  ...target,
  proofKind: "pay_stub" as const,
  grossBasis: "gross" as const,
  periodStart: "2026-09-27",
  periodEnd: "2026-10-26",
  detailsVerified: true,
  provenanceRef: "proof-check-1",
};
const zeroTemplate = "06f669f039e9dc9f8fd2c8b18672ea5732cca481b75d9acceaec06730daebc17";
function sourceCoverage(
  subjectId = "adult-1",
  sourceId: string | null = "job-1",
): PecoCapIncomeInput["bundles"][number]["sourceCoverage"][number] {
  return {
    subjectId,
    sourceId,
    basis: "30_days",
    applicationAsOf: "2026-10-26",
    documentRefs: [{
      documentId: "proof-1",
      sha256: "a".repeat(64)
    }],
    proofRequirement: "required",
    completenessVerified: true,
    applicabilityRule: "current_income_period",
    applicabilityRef: "source-applicability-check-1",
  };
}

function fixture(): PecoCapIncomeInput {
  return structuredClone({
    scope: {
      binding: { ...binding },
      applicantSubjectId: "adult-1",
      journey: "new_enrollment",
      currentCapState: "not_enrolled",
      requestState: "active",
      mandate: {
        expiresAt: validation.validUntil,
        revoked: false,
        recipientIds: ["peco-cap"],
        allowedActions: ["prepare"],
        allowedData: ["household", "income", "documents"]
      },
      grant: {
        expiresAt: validation.validUntil,
        revoked: false
      },
      incomeConsent: {
        version: "income-v1",
        expiresAt: validation.validUntil,
        subjectIds: ["adult-1"]
      },
      documentConsent: {
        version: "document-v1",
        expiresAt: validation.validUntil,
        documentIds: ["proof-1"]
      },
    },
    household: {
      ...validation,
      binding: { ...binding },
      complete: true,
      people: [{
        subjectId: "adult-1",
        adult: true,
        inventory: {
          ...validation,
          binding: { ...binding },
          state: "sources",
          complete: true,
          sources: [{
            sourceId: "job-1",
            kind: "employment"
          }]
        }
      }],
    },
    documents: [{
      documentId: "proof-1",
      sha256: "a".repeat(64),
      binding: { ...binding },
      provenanceRef: "original-check-1",
      status: "validated",
      originalAvailable: true,
      uploadConfirmedAt: "2026-10-26T09:00:00Z",
      validatedAt: validation.verifiedAt,
      expiresAt: "2026-10-27T10:00:00Z",
      coverage: [proof]
    }],
    bundles: [{
      ...validation,
      binding: { ...binding },
      basis: "30_days",
      periodStart: proof.periodStart,
      periodEnd: proof.periodEnd,
      documentIds: ["proof-1"],
      sourceCoverage: [sourceCoverage()],
      representativeness: "verified",
      annualGrossSummary: {
        annualGrossCents: 2400000,
        basis: "gross",
        comparisonRef: "source-validated-annual-gross-usd-v1",
        provenanceRef: "annual-check-1",
        sourceRefs: [target]
      }
    }],
    zeroIncome: null,
    liheap: null,
  });
}
function codes(input: PecoCapIncomeInput, at = now) {
  return assessPecoCapIncomeEvidence(input, at).serviceBlockers.map((issue) => issue.code);
}
function annual(input: PecoCapIncomeInput, amount = 1200000) {
  const document = structuredClone(input.documents[0]);
  document.documentId = "proof-annual";
  document.sha256 = "b".repeat(64);
  document.coverage = document.coverage.map((proof) => ({
    ...proof,
    periodStart: "2025-10-27"
  }));
  input.documents.push(document);
  input.scope.documentConsent!.documentIds.push(document.documentId);
  input.bundles.push({
    ...structuredClone(input.bundles[0]),
    basis: "12_months",
    periodStart: "2025-10-27",
    documentIds: [document.documentId],
    sourceCoverage: input.bundles[0].sourceCoverage.map((coverage) => ({
      ...coverage,
      basis: "12_months",
      documentRefs: [{
        documentId: document.documentId,
        sha256: document.sha256
      }]
    })),
    annualGrossSummary: {
      ...fixture().bundles[0].annualGrossSummary!,
      annualGrossCents: amount
    }
  });
}
function zero(input: PecoCapIncomeInput) {
  input.household.people[0].inventory = {
    ...structuredClone(validation),
    state: "none",
    complete: true,
    sources: []
  };
  input.documents = [{
    ...input.documents[0],
    documentId: "zero-form",
    sha256: zeroTemplate,
    coverage: []
  }];
  input.scope.documentConsent!.documentIds = ["zero-form"];
  input.bundles = [];
  input.zeroIncome = {
    ...structuredClone(validation),
    form: {
      documentId: "zero-form",
      sourceTemplateSha256: zeroTemplate
    },
    expenseExplanation: "complete"
  };
}
function liheap(input: PecoCapIncomeInput) {
  input.liheap = {
    ...structuredClone(validation),
    grant: {
      status: "approved",
      accountRef: "account-1",
      directedToPeco: true,
      season: "2025-2026",
      approvedAt: "2026-01-10T00:00:00Z",
      appliedAt: "2026-01-12T00:00:00Z"
    },
    sharing: {
      status: "verified",
      consentedAt: "2025-12-10T00:00:00Z",
      incomeAsOf: "2025-12-01",
      incomeSeason: "2025-2026",
      currentSeason: "2025-2026",
      provenanceRef: "dhs-sharing-check-1"
    },
    informedConsentForm: null,
  };
}
function shortConsent(input: PecoCapIncomeInput) {
  liheap(input);
  input.liheap!.grant.season = "2026-2027";
  input.liheap!.grant.approvedAt = "2026-11-02T10:00:00Z";
  input.liheap!.grant.appliedAt = "2026-11-02T12:00:00Z";
  input.liheap!.verifiedAt = "2026-11-03T00:20:00Z";
  input.liheap!.sharing.currentSeason = "2026-2027";
  input.liheap!.informedConsentForm = {
    documentId: "issued-form",
    issuedAccountRef: "account-1",
    issuedSeason: "2026-2027",
    issuedAt: "2026-11-03T00:00:00Z",
    sourceTemplateSha256: "c".repeat(64),
    reviewedTemplateSha256: "c".repeat(64),
    templateVerifiedAt: "2026-11-03T00:00:00Z",
    templateValidUntil: validation.validUntil,
    templateProvenanceRef: "issued-form-check-1",
  };
  input.documents = [{
    ...input.documents[0],
    documentId: "issued-form",
    sha256: "c".repeat(64),
    uploadConfirmedAt: "2026-11-03T00:10:00Z",
    validatedAt: "2026-11-03T00:15:00Z",
    expiresAt: "2026-11-04T00:15:00Z",
    coverage: []
  }];
  input.scope.documentConsent!.documentIds = ["issued-form"];
}

describe("PECO income evidence preparation assessment", () => {
  it("can assess income before form preparation while retaining a trusted snapshot reference when supplied", () => {
    const input = fixture();
    const before = assessPecoCapIncomeEvidence(input, now);
    input.scope.preparationSnapshot = { id: "preparation-1", revision: 1, sha256: "c".repeat(64) };
    expect(assessPecoCapIncomeEvidence(input, now)).toEqual(before);
    expect(input.scope.preparationSnapshot).toEqual({ id: "preparation-1", revision: 1, sha256: "c".repeat(64) });
  });

  it.each([
    { id: "", revision: 1, sha256: "c".repeat(64) },
    { id: "preparation-1", revision: 0, sha256: "c".repeat(64) },
    { id: "preparation-1", revision: 1, sha256: "not-a-digest" },
    { id: "preparation-1", revision: 1, sha256: "c".repeat(64), verifiedByClient: true },
  ])("rejects malformed preparation references without echoing supplied metadata", reference => {
    const input = fixture();
    Object.assign(input.scope, { preparationSnapshot: reference });
    expect(() => assessPecoCapIncomeEvidence(input, now)).toThrow("The PECO income evidence could not be assessed from the supplied information.");
  });

  it("selects exact originals from fresh scoped gross evidence without changing input or claiming submission/certification", () => {
    const input = fixture(), before = structuredClone(input);
    const result = assessPecoCapIncomeEvidence(input, now);
    expect(result).toMatchObject({
      route: "standard_proof",
      preparationComplete: true,
      basis: "30_days",
      selectedOriginals: [{
        documentId: "proof-1",
        sha256: "a".repeat(64)
      }],
      missingFacts: [],
      serviceBlockers: []
    });
    expect(result.coverage).toEqual([{
      ...target,
      complete: true,
      proofRequirement: "required",
      documentIds: ["proof-1"]
    }]);
    expect(input).toEqual(before);
    expect(result).not.toHaveProperty("submissionReady");
    expect(result).not.toHaveProperty("certificationComplete");
  });

  it("does not demand a second period or annualization when one complete documented basis exists", () => {
    const input = fixture();
    input.bundles[0].annualGrossSummary = null;
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(true);
    annual(input);
    input.bundles[1].documentIds = [];
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      preparationComplete: true,
      basis: "30_days",
      missingFacts: []
    });
  });

  it.each([1200000, 4800000, 2400000])("chooses the lesser comparable source-validated annual gross total (%i), breaking ties toward less history", (amount) => {
    const input = fixture();
    annual(input, amount);
    const result = assessPecoCapIncomeEvidence(input, now);
    expect(result.preparationComplete).toBe(true);
    expect(result.basis).toBe(amount < 2400000 ? "12_months" : "30_days");
  });

  it.each(["missing", "net", "different_method", "missing_source"])("keeps an unresolved comparison owned by CaseLink (%s)", (variant) => {
    const input = fixture();
    annual(input);
    const summary = input.bundles[1].annualGrossSummary!;
    if (variant === "missing") input.bundles[1].annualGrossSummary = null;
    if (variant === "net") summary.basis = "net";
    if (variant === "different_method") summary.comparisonRef = "unrelated-method";
    if (variant === "missing_source") summary.sourceRefs = [];
    expect(codes(input)).toContain("annual_gross_comparison_unresolved");
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts).toEqual([]);
  });

  it("does not resolve representativeness by guessing", () => {
    const input = fixture();
    input.bundles[0].representativeness = "unresolved";
    expect(codes(input)).toContain("income_period_representativeness_unresolved");
  });

  it("uses current complete evidence instead of comparing an irrelevant historical optional bundle", () => {
    const input = fixture();
    annual(input);
    input.bundles[1].periodStart = "2025-10-26";
    input.bundles[1].periodEnd = "2026-10-25";
    input.documents[1].coverage[0].periodStart = "2025-10-26";
    input.documents[1].coverage[0].periodEnd = "2026-10-25";
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      preparationComplete: true,
      basis: "30_days"
    });
  });

  it.each(["historical_bundle", "historical_proof"])(
    "does not relabel 2020 income as current by refreshing metadata (%s)",
    (variant) => {
      const input = fixture();
      input.documents[0].coverage[0].periodStart = "2020-09-27";
      input.documents[0].coverage[0].periodEnd = "2020-10-26";
      if (variant === "historical_bundle") {
        input.bundles[0].periodStart = "2020-09-27";
        input.bundles[0].periodEnd = "2020-10-26";
        input.bundles[0].sourceCoverage[0].applicationAsOf = "2020-10-26";
      }
      expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(false);
      expect(codes(input).length).toBeGreaterThan(0);
      expect(assessPecoCapIncomeEvidence(input, now).missingFacts).toEqual([]);
    },
  );

  it("ignores an unused expired candidate rather than blocking a complete valid original", () => {
    const input = fixture();
    input.documents.push({
      ...structuredClone(input.documents[0]),
      documentId: "unused-expired",
      expiresAt: "2026-01-01T00:00:00Z",
      coverage: [],
    });
    input.bundles[0].documentIds.push("unused-expired");
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      preparationComplete: true,
      selectedOriginals: [{
        documentId: "proof-1",
        sha256: "a".repeat(64)
      }],
    });
  });

  it("keeps a complete validated basis when optional second-period representativeness is unresolved", () => {
    const input = fixture();
    annual(input, 4800000);
    input.bundles[1].representativeness = "unresolved";
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      preparationComplete: true,
      basis: "30_days",
      missingFacts: [],
    });
    input.bundles[1].annualGrossSummary = null;
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(true);
    input.bundles[1].annualGrossSummary = {
      ...fixture().bundles[0].annualGrossSummary!,
      annualGrossCents: 1200000,
    };
    expect(codes(input)).toContain("income_period_representativeness_unresolved");
  });

  it("requires every adult and source, but can reuse one explicitly bound original for several sources or people", () => {
    const input = fixture();
    input.household.people[0].inventory!.sources.push({
      sourceId: "support-1",
      kind: "child_support"
    });
    input.household.people.push({
      subjectId: "adult-2",
      adult: true,
      inventory: {
        ...structuredClone(validation),
        state: "sources",
        complete: true,
        sources: [{
          sourceId: "job-2",
          kind: "employment"
        }]
      }
    });
    input.scope.incomeConsent.subjectIds.push("adult-2");
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts).toEqual([{
      code: "income_evidence",
      targets: [{
        subjectId: "adult-1",
        sourceId: "support-1"
      }, {
        subjectId: "adult-2",
        sourceId: "job-2"
      }]
    }]);
    input.documents[0].coverage.push({
      ...proof,
      sourceId: "support-1",
      proofKind: "voluntary_child_support_letter"
    }, {
      ...proof,
      subjectId: "adult-2",
      sourceId: "job-2"
    });
    input.bundles[0].sourceCoverage.push(sourceCoverage("adult-1", "support-1"), sourceCoverage("adult-2", "job-2"));
    input.bundles[0].annualGrossSummary = null;
    input.bundles[0].documentIds.push("proof-1");
    const result = assessPecoCapIncomeEvidence(input, now);
    expect(result.preparationComplete).toBe(true);
    expect(result.selectedOriginals).toHaveLength(1);
    expect(result.coverage).toHaveLength(3);
  });

  it("uses source-validated collective completeness rather than inventing a literal daily-payroll rule", () => {
    const input = fixture();
    input.documents[0].coverage[0].periodEnd = "2026-10-10";
    const second = {
      ...structuredClone(input.documents[0]),
      documentId: "proof-2",
      sha256: "b".repeat(64),
      coverage: [{
        ...proof,
        periodStart: "2026-10-12"
      }]
    };
    input.documents.push(second);
    input.scope.documentConsent!.documentIds.push("proof-2");
    input.bundles[0].documentIds.push("proof-2");
    input.bundles[0].sourceCoverage[0].documentRefs.push({
      documentId: "proof-2",
      sha256: second.sha256
    });
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(true);
    expect(assessPecoCapIncomeEvidence(input, now).selectedOriginals).toHaveLength(2);
    input.bundles[0].sourceCoverage[0].completenessVerified = false;
    expect(codes(input)).toContain("income_source_coverage_needs_validation");
  });

  it("does not require a minor zero declaration, but includes actual declared minor income", () => {
    const input = fixture();
    input.household.people.push({
      subjectId: "minor-1",
      adult: false,
      inventory: null
    });
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(true);
    input.household.people[1].inventory = {
      ...structuredClone(validation),
      state: "sources",
      complete: true,
      sources: [{
        sourceId: "minor-job",
        kind: "employment"
      }]
    };
    input.scope.incomeConsent.subjectIds.push("minor-1");
    expect(codes(input)).toContain("minor_income_proof_applicability_unresolved");
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts).toEqual([]);
    input.bundles[0].sourceCoverage.push({
      ...sourceCoverage("minor-1", "minor-job"),
      proofRequirement: "not_required",
      documentRefs: []
    });
    input.bundles[0].annualGrossSummary!.sourceRefs.push({
      subjectId: "minor-1",
      sourceId: "minor-job"
    });
    expect(assessPecoCapIncomeEvidence(input, now).coverage).toContainEqual({
      subjectId: "minor-1",
      sourceId: "minor-job",
      complete: true,
      proofRequirement: "not_required",
      documentIds: []
    });
  });

  it("ignores a stale optional minor-none declaration instead of inventing a required confirmation", () => {
    const input = fixture();
    input.household.people.push({
      subjectId: "minor-1",
      adult: false,
      inventory: {
        ...structuredClone(validation),
        state: "none",
        complete: true,
        validUntil: "2026-01-01T00:00:00Z",
        sources: []
      }
    });
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      preparationComplete: true,
      missingFacts: [],
      serviceBlockers: []
    });
  });

  it.each(["net", "unknown"])("will not treat %s income as gross evidence", (basis) => {
    const input = fixture();
    input.documents[0].coverage[0].grossBasis = basis as "net" | "unknown";
    expect(codes(input)).toContain("income_proof_details_need_validation");
  });

  it("routes unlisted evidence to service verification rather than declaring the family ineligible", () => {
    const input = fixture();
    input.documents[0].coverage[0].proofKind = "other";
    expect(codes(input)).toContain("proof_type_needs_verification");
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts).toEqual([]);
  });

  it("batches another adult's known missing proof while CaseLink checks an unlisted proof", () => {
    const input = fixture();
    input.documents[0].coverage[0].proofKind = "other";
    input.household.people.push({
      subjectId: "adult-2",
      adult: true,
      inventory: {
        ...structuredClone(validation),
        state: "sources",
        complete: true,
        sources: [{
          sourceId: "job-2",
          kind: "employment"
        }],
      },
    });
    input.scope.incomeConsent.subjectIds.push("adult-2");
    const result = assessPecoCapIncomeEvidence(input, now);
    expect(result.serviceBlockers[0].code).toBe("proof_type_needs_verification");
    expect(result.missingFacts).toEqual([{
      code: "income_evidence",
      targets: [{
        subjectId: "adult-2",
        sourceId: "job-2"
      }],
    }]);
  });

  it("does not ask a minor to upload proof when no basis or documents are available", () => {
    const input = fixture();
    input.documents = [];
    input.bundles = [];
    input.household.people.push({
      subjectId: "minor-1",
      adult: false,
      inventory: {
        ...structuredClone(validation),
        state: "sources",
        complete: true,
        sources: [{
          sourceId: "minor-job",
          kind: "employment"
        }],
      },
    });
    input.scope.incomeConsent.subjectIds.push("minor-1");
    const result = assessPecoCapIncomeEvidence(input, now);
    expect(result.missingFacts).toEqual([{
      code: "income_evidence",
      targets: [target]
    }]);
    expect(result.serviceBlockers).toContainEqual(expect.objectContaining({
      code: "minor_income_proof_applicability_unresolved",
      subjectId: "minor-1",
    }));
  });

  it("binds source completeness to the exact original hash and actual source applicability", () => {
    const input = fixture();
    input.bundles[0].sourceCoverage[0].documentRefs[0].sha256 = "f".repeat(64);
    expect(codes(input)).toContain("income_coverage_original_mismatch");
    input.bundles[0].sourceCoverage[0].documentRefs[0].sha256 = input.documents[0].sha256;
    input.bundles[0].sourceCoverage[0].applicabilityRule = "unverified";
    expect(codes(input)).toContain("income_source_coverage_needs_validation");
  });

  it.each([
    (input: PecoCapIncomeInput) => { input.scope.requestState = "cancelled"; },
    (input: PecoCapIncomeInput) => { input.scope.requestState = "paused"; },
    (input: PecoCapIncomeInput) => { input.scope.mandate.revoked = true; },
    (input: PecoCapIncomeInput) => { input.scope.grant.revoked = true; },
    (input: PecoCapIncomeInput) => { input.scope.grant.expiresAt = "2026-10-26T12:00:00Z"; },
    (input: PecoCapIncomeInput) => { input.scope.mandate.recipientIds = []; },
    (input: PecoCapIncomeInput) => { input.scope.mandate.allowedData = ["household"]; },
    (input: PecoCapIncomeInput) => { input.scope.mandate.allowedActions = ["research"]; },
    (input: PecoCapIncomeInput) => { input.scope.incomeConsent.expiresAt = "2026-10-26T12:00:00Z"; },
  ])("does not prepare after cancellation, expiry or changed authority", (change) => {
    const input = fixture();
    change(input);
    expect(codes(input)).toContain("preparation_authority_unavailable");
    expect(assessPecoCapIncomeEvidence(input, now).selectedOriginals).toEqual([]);
  });

  it.each(["enrolled", "unknown"])("does not silently start a new application when CAP state is %s", (state) => {
    const input = fixture();
    input.scope.currentCapState = state as "enrolled" | "unknown";
    const result = assessPecoCapIncomeEvidence(input, now);
    expect(result.preparationComplete).toBe(false);
    expect(result.route).toBe("undetermined");
    if (state === "unknown") expect(result.missingFacts[0].code).toBe("current_cap_state");
    else expect(codes(input)).toContain("different_cap_journey_required");
  });

  it("routes renewals elsewhere and batches unknown adult source inventories", () => {
    const input = fixture();
    input.scope.journey = "renewal";
    expect(codes(input)).toContain("different_cap_journey_required");
    input.scope.journey = "new_enrollment";
    input.household.people[0].inventory!.state = "unknown";
    input.household.people.push({
      subjectId: "adult-2",
      adult: true,
      inventory: null
    });
    input.scope.incomeConsent.subjectIds.push("adult-2");
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts).toEqual([{
      code: "complete_income_source_inventory",
      targets: [{
        subjectId: "adult-1",
        sourceId: null
      }, {
        subjectId: "adult-2",
        sourceId: null
      }]
    }]);
  });

  it.each([
    ["document_scope_mismatch", (input: PecoCapIncomeInput) => { input.documents[0].binding.requestVersion--; }],
    ["document_scope_mismatch", (input: PecoCapIncomeInput) => { input.documents[0].binding.householdId = "other-household"; }],
    ["document_scope_mismatch", (input: PecoCapIncomeInput) => { input.documents[0].binding.requestId = "other-request"; }],
    ["document_subject_mismatch", (input: PecoCapIncomeInput) => { input.documents[0].coverage[0].subjectId = "other-adult"; }],
    ["document_source_mismatch", (input: PecoCapIncomeInput) => { input.documents[0].coverage[0].sourceId = "other-job"; }],
    ["document_use_not_authorized", (input: PecoCapIncomeInput) => { input.scope.documentConsent!.documentIds = []; }],
    ["document_use_not_authorized", (input: PecoCapIncomeInput) => { input.scope.documentConsent!.expiresAt = "2026-10-25T00:00:00Z"; }],
    ["original_document_needs_validation", (input: PecoCapIncomeInput) => { input.documents[0].expiresAt = "2026-10-26T12:00:00Z"; }],
    ["original_document_needs_validation", (input: PecoCapIncomeInput) => { input.documents[0].status = "raw_deleted"; }],
    ["original_document_needs_validation", (input: PecoCapIncomeInput) => { input.documents[0].originalAvailable = false; }],
    ["original_document_needs_validation", (input: PecoCapIncomeInput) => { input.documents[0].uploadConfirmedAt = null; }],
    ["original_document_needs_validation", (input: PecoCapIncomeInput) => { input.documents[0].validatedAt = "2026-10-27T00:00:00Z"; }],
  ])("blocks unsafe original reuse (%s)", (code, change) => {
    const input = fixture();
    (change as (input: PecoCapIncomeInput) => void)(input);
    expect(codes(input)).toContain(code);
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(false);
  });

  it("does not extend original retention when its inventory is validated again", () => {
    const input = fixture();
    input.documents[0].expiresAt = "2026-10-26T11:00:00Z";
    input.household.people[0].inventory!.verifiedAt = now.toISOString();
    expect(codes(input)).toContain("original_document_needs_validation");
  });

  it("caps raw reuse at 24 hours after validation even when a supplied later expiry or current facts exist", () => {
    const input = fixture();
    input.documents[0].expiresAt = validation.validUntil;
    expect(codes(input, new Date("2026-10-27T10:00:00Z"))).toContain("original_document_needs_validation");
  });

  it("rejects impossible upload/validation chronology", () => {
    const input = fixture();
    input.documents[0].validatedAt = "2026-10-26T08:00:00Z";
    expect(codes(input)).toContain("original_document_needs_validation");
  });

  it("requires the official whole-household zero form plus an expense explanation, with signatures reserved for later", () => {
    const input = fixture();
    zero(input);
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      route: "household_zero_income",
      preparationComplete: true,
      selectedOriginals: [{
        documentId: "zero-form",
        sha256: zeroTemplate
      }]
    });
    input.zeroIncome!.expenseExplanation = "missing";
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts[0].code).toBe("living_expense_explanation");
    input.zeroIncome!.expenseExplanation = "complete";
    input.zeroIncome!.form!.sourceTemplateSha256 = "f".repeat(64);
    expect(codes(input)).toContain("official_zero_income_form_needs_validation");
    input.zeroIncome = null;
    expect(codes(input)).toContain("official_zero_income_form_not_prepared");
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts[0].code).toBe("living_expense_explanation");
  });

  it("reuses a fresh living-expense answer before a zero form exists instead of asking again", () => {
    const input = fixture();
    zero(input);
    input.zeroIncome!.form = null;
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      preparationComplete: false,
      missingFacts: [],
      serviceBlockers: [expect.objectContaining({ code: "official_zero_income_form_not_prepared" })]
    });
    input.zeroIncome!.expenseExplanation = "missing";
    expect(assessPecoCapIncomeEvidence(input, now).missingFacts[0].code).toBe("living_expense_explanation");
  });

  it("uses a listed individual-zero alternative in a mixed household, never the household-zero affidavit", () => {
    const input = fixture();
    input.household.people.push({
      subjectId: "adult-2",
      adult: true,
      inventory: {
        ...structuredClone(validation),
        state: "none",
        complete: true,
        sources: []
      }
    });
    input.scope.incomeConsent.subjectIds.push("adult-2");
    input.documents[0].coverage.push({
      ...proof,
      subjectId: "adult-2",
      sourceId: null,
      proofKind: "household_zero_form",
      grossBasis: "not_applicable"
    });
    input.bundles[0].sourceCoverage.push({
      ...sourceCoverage("adult-2", null),
      applicabilityRule: "individual_no_income"
    });
    input.bundles[0].annualGrossSummary = null;
    expect(codes(input)).toContain("individual_zero_evidence_needs_verification");
    input.documents[0].coverage[1].proofKind = "bill_supporter_letter";
    const result = assessPecoCapIncomeEvidence(input, now);
    expect(result).toMatchObject({
      route: "standard_proof",
      preparationComplete: true
    });
    expect(result.coverage).toHaveLength(2);
  });

  it("does not mistake known minor income for a whole-household zero case", () => {
    const input = fixture();
    zero(input);
    input.household.people.push({
      subjectId: "minor-1",
      adult: false,
      inventory: {
        ...structuredClone(validation),
        state: "sources",
        complete: true,
        sources: [{
          sourceId: "minor-job",
          kind: "employment"
        }]
      }
    });
    input.scope.incomeConsent.subjectIds.push("minor-1");
    expect(assessPecoCapIncomeEvidence(input, now).route).toBe("standard_proof");
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(false);
  });

  it("waives income attachments for a verified approved PECO grant and current DHS sharing without reasking adult sources", () => {
    const input = fixture();
    liheap(input);
    input.household.people[0].inventory = null;
    input.documents = [];
    input.bundles = [];
    input.scope.documentConsent = null;
    expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
      route: "liheap_full_application",
      preparationComplete: true,
      selectedOriginals: [],
      missingFacts: []
    });
  });

  it.each(["denied", "not_directed", "other_account", "approved"])(
    "does not let stale irrelevant LIHEAP metadata stop valid standard work (%s)",
    (variant) => {
      const input = fixture();
      liheap(input);
      input.liheap!.validUntil = "2020-01-01T00:00:00Z";
      if (variant === "denied") input.liheap!.grant.status = "denied";
      if (variant === "not_directed") input.liheap!.grant.directedToPeco = false;
      if (variant === "other_account") input.liheap!.grant.accountRef = "other-account";
      expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
        route: "standard_proof",
        preparationComplete: true,
      });
    },
  );

  it("does not accept a caller-invented future operating season as a current DHS waiver", () => {
    const input = fixture();
    liheap(input);
    input.documents = [];
    input.bundles = [];
    input.household.people[0].inventory = null;
    input.liheap!.sharing.currentSeason = "2099-2100";
    input.liheap!.sharing.incomeSeason = "2099-2100";
    input.liheap!.sharing.incomeAsOf = null;
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(false);
    expect(codes(input)).toContain("dhs_income_recency_or_consent_unverified");
  });

  it.each(["account", "unknown_sharing", "stale_income", "future_grant", "scope"])("does not invent a LIHEAP waiver (%s)", (variant) => {
    const input = fixture();
    liheap(input);
    if (variant !== "account") {
      input.documents = [];
      input.bundles = [];
      input.household.people[0].inventory = null;
    }
    if (variant === "account") input.liheap!.grant.accountRef = "other-account";
    if (variant === "unknown_sharing") input.liheap!.sharing.status = "unknown";
    if (variant === "stale_income") {
      input.liheap!.sharing.incomeAsOf = "2024-01-01";
      input.liheap!.sharing.incomeSeason = "2023-2024";
    }
    if (variant === "future_grant") input.liheap!.grant.approvedAt = "2027-01-01T00:00:00Z";
    if (variant === "scope") input.liheap!.binding.requestVersion--;
    if (variant === "account") {
      expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
        route: "standard_proof",
        preparationComplete: true
      });
    } else {
      expect(assessPecoCapIncomeEvidence(input, now)).toMatchObject({
        preparationComplete: false,
        missingFacts: []
      });
      expect(codes(input).length).toBeGreaterThan(0);
    }
  });

  it("uses verified current/prior-season DHS income support and does not treat a prior grant as the future short route", () => {
    const input = fixture();
    liheap(input);
    input.liheap!.sharing.incomeAsOf = "2024-12-01";
    input.liheap!.sharing.incomeSeason = "2024-2025";
    expect(assessPecoCapIncomeEvidence(input, now).preparationComplete).toBe(true);
    input.liheap!.sharing.currentSeason = "2026-2027";
    input.liheap!.sharing.incomeAsOf = "2026-01-01";
    input.liheap!.sharing.incomeSeason = "2025-2026";
    expect(assessPecoCapIncomeEvidence(input, new Date("2026-11-03T12:00:00Z")).route).toBe("liheap_full_application");
  });

  it("requires the actual current issued short form after the 2026-27 grant is applied, without defaulting to paystubs", () => {
    const input = fixture();
    shortConsent(input);
    const later = new Date("2026-11-03T12:00:00Z");
    input.household.people[0].inventory = null;
    input.bundles = [];
    expect(assessPecoCapIncomeEvidence(input, later)).toMatchObject({
      route: "liheap_informed_consent",
      preparationComplete: true,
      selectedOriginals: [{
        documentId: "issued-form",
        sha256: "c".repeat(64)
      }]
    });
    input.liheap!.informedConsentForm = null;
    const missing = assessPecoCapIncomeEvidence(input, later);
    expect(missing).toMatchObject({
      route: "liheap_informed_consent",
      preparationComplete: false,
      missingFacts: []
    });
    expect(missing.serviceBlockers[0].code).toBe("provider_issued_informed_consent_form_unavailable");
  });

  it("activates the November 2 shortcut on Pennsylvania's calendar date", () => {
    const input = fixture();
    shortConsent(input);
    input.liheap!.grant.approvedAt = "2026-11-01T22:00:00Z";
    input.liheap!.grant.appliedAt = "2026-11-01T23:00:00Z";
    input.liheap!.verifiedAt = "2026-11-02T01:00:00Z";
    const early = assessPecoCapIncomeEvidence(input, new Date("2026-11-02T02:00:00Z"));
    expect(early.route).not.toBe("liheap_informed_consent");
    expect(early.preparationComplete).toBe(false);

    input.liheap!.grant.approvedAt = "2026-11-02T05:00:00Z";
    input.liheap!.grant.appliedAt = "2026-11-02T05:05:00Z";
    input.liheap!.verifiedAt = "2026-11-02T05:25:00Z";
    const form = input.liheap!.informedConsentForm!;
    form.issuedAt = "2026-11-02T05:10:00Z";
    form.templateVerifiedAt = "2026-11-02T05:10:00Z";
    input.documents[0].uploadConfirmedAt = "2026-11-02T05:15:00Z";
    input.documents[0].validatedAt = "2026-11-02T05:20:00Z";
    input.documents[0].expiresAt = "2026-11-03T05:20:00Z";
    expect(assessPecoCapIncomeEvidence(input, new Date("2026-11-02T05:30:00Z"))).toMatchObject({
      route: "liheap_informed_consent",
      preparationComplete: true,
    });
  });

  it("does not treat tomorrow's Pennsylvania DHS income date as already observed after UTC midnight", () => {
    const input = fixture(); liheap(input);
    input.documents = [];
    input.bundles = [];
    input.household.people[0].inventory = null;
    input.liheap!.verifiedAt = "2026-11-02T01:00:00Z";
    input.liheap!.sharing.incomeAsOf = "2026-11-02";
    input.liheap!.sharing.incomeSeason = null;
    expect(codes(input, new Date("2026-11-02T02:00:00Z"))).toContain(
      "dhs_income_recency_or_consent_unverified",
    );
  });

  it.each(["hash", "original_hash", "account", "season", "expired_template", "before_applied", "existing_cap"])("blocks invalid short-form evidence (%s)", (variant) => {
    const input = fixture();
    shortConsent(input);
    const form = input.liheap!.informedConsentForm!;
    if (variant === "hash") form.reviewedTemplateSha256 = "d".repeat(64);
    if (variant === "original_hash") input.documents[0].sha256 = "d".repeat(64);
    if (variant === "account") form.issuedAccountRef = "other-account";
    if (variant === "season") form.issuedSeason = "2025-2026";
    if (variant === "expired_template") form.templateValidUntil = "2026-11-03T12:00:00Z";
    if (variant === "before_applied") form.issuedAt = "2026-11-01T00:00:00Z";
    if (variant === "existing_cap") input.scope.currentCapState = "enrolled";
    expect(assessPecoCapIncomeEvidence(input, new Date("2026-11-03T12:00:00Z")).preparationComplete).toBe(false);
  });

  it.each([
    {
      ...fixture(),
      ssn: "PRIVATE IDENTIFIER"
    },
    {
      ...fixture(),
      signature: "PRIVATE SIGNATURE"
    },
    {
      ...fixture(),
      password: "PRIVATE PASSWORD"
    },
    {
      ...fixture(),
      authCode: "PRIVATE CODE"
    },
    {
      ...fixture(),
      scope: {
        ...fixture().scope,
        name: "PRIVATE NAME"
      }
    },
    {
      ...fixture(),
      documents: [{
        ...fixture().documents[0],
        sha256: "bad"
      }]
    },
    {
      ...fixture(),
      bundles: [{
        ...fixture().bundles[0],
        periodStart: "2026-02-30"
      }]
    },
  ])("rejects unsupported private-channel fields and malformed records with a generic error", (value) => {
    expect(() => assessPecoCapIncomeEvidence(value, now)).toThrow(new Error(
      "The PECO income evidence could not be assessed from the supplied information.",
    ));
  });
});
