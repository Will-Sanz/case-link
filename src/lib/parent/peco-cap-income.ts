import { z } from "zod";

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
});
const timestamp=z.iso.datetime({ offset: true });
const binding=z.object({
  requestId: id,
  householdId: id,
  requestVersion: z.number().int().positive(),
  accountRef: id,
  programId: z.literal("peco-cap"),
  need: z.literal("electricity"),
  purpose: z.literal("income_preparation"),
}).strict();
export { binding as pecoCapIncomeBindingSchema };
export const pecoCapPreparationReferenceSchema=z.object({
  id,
  revision: z.number().int().positive(),
  sha256: hash,
}).strict();
const validation={
  binding,
  provenanceRef: id,
  verifiedAt: timestamp,
  validUntil: timestamp,
};
const sourceKind=z.enum([
  "employment",
  "unemployment",
  "pension",
  "workers_compensation",
  "veterans",
  "cash_welfare",
  "child_support",
  "spousal_support",
  "social_security",
  "rental",
  "self_employment",
  "other",
]);
const proofKind=z.enum([
  "pay_stub",
  "employer_letter",
  "unemployment_award",
  "pension_award",
  "pension_check",
  "workers_compensation_award",
  "workers_compensation_check",
  "veterans_award",
  "veterans_check",
  "matching_bank_deposit",
  "cash_benefit_award",
  "compass_cash_detail",
  "child_support_order",
  "domestic_relations_obligation",
  "voluntary_child_support_letter",
  "alimony_order",
  "alimony_check",
  "social_security_current_year_award",
  "ssi_award",
  "disability_award",
  "survivor_award",
  "rental_lease",
  "cancelled_rent_check",
  "rent_receipt",
  "tax_1040",
  "unemployment_denial",
  "workers_compensation_exhaustion",
  "workers_compensation_denial",
  "veterans_denial",
  "cash_benefit_stop",
  "cash_benefit_denial",
  "social_security_denial",
  "bill_supporter_letter",
  "household_zero_form",
  "other",
]);
const target=z.object({
  subjectId: id,
  sourceId: id.nullable()
}).strict();
const inventory=z.object({
  ...validation,
  state: z.enum(["sources","none","unknown"]),
  complete: z.boolean(),
  sources: z.array(z.object({
    sourceId: id,
    kind: sourceKind
  }).strict()).max(30),
}).strict();
const document=z.object({
  documentId: id,
  sha256: hash,
  binding,
  provenanceRef: id,
  status: z.enum(["uploaded","validated","raw_deleted","deleted","deletion_pending"]),
  originalAvailable: z.boolean(),
  uploadConfirmedAt: timestamp.nullable(),
  validatedAt: timestamp.nullable(),
  expiresAt: timestamp,
  coverage: z.array(target.extend({
    proofKind,
    grossBasis: z.enum(["gross","net","unknown","not_applicable"]),
    periodStart: date,
    periodEnd: date,
    detailsVerified: z.boolean(),
    provenanceRef: id,
    issueYear: z.number().int().min(1).max(9999).optional(),
  }).strict()).max(120),
}).strict();
const bundle=z.object({
  ...validation,
  basis: z.enum(["30_days","12_months"]),
  periodStart: date,
  periodEnd: date,
  documentIds: z.array(id).max(120),
  sourceCoverage: z.array(target.extend({
    basis: z.enum(["30_days","12_months"]),
    applicationAsOf: date,
    documentRefs: z.array(z.object({
      documentId: id,
      sha256: hash
    }).strict()).max(120),
    proofRequirement: z.enum(["required","not_required","unresolved"]),
    completenessVerified: z.boolean(),
    applicabilityRule: z.enum([
      "current_income_period",
      "ongoing_award_or_agreement",
      "representative_1040",
      "individual_no_income",
      "unverified"
    ]),
    applicabilityRef: id,
  }).strict()).max(120),
  representativeness: z.enum(["verified","unresolved"]),
  annualGrossSummary: z.object({
    annualGrossCents: z.number().int().min(0).max(1000000000000),
    basis: z.enum(["gross","net","unknown"]),
    comparisonRef: id,
    provenanceRef: id,
    sourceRefs: z.array(target).max(120),
  }).strict().nullable(),
}).strict();
const inputSchema=z.object({
  scope: z.object({
    binding,
    // Recorded by the trusted projection; income readiness can precede a completed form snapshot.
    preparationSnapshot: pecoCapPreparationReferenceSchema.optional(),
    applicantSubjectId: id,
    journey: z.enum(["new_enrollment","renewal","unknown"]),
    currentCapState: z.enum(["not_enrolled","enrolled","unknown"]),
    requestState: z.enum(["active","paused","cancelled","closed"]),
    mandate: z.object({
      expiresAt: timestamp,
      revoked: z.boolean(),
      recipientIds: z.array(id).max(30),
      allowedActions: z.array(z.enum(["research","prepare"])).max(2),
      allowedData: z.array(z.enum(["household","income","documents"])).max(3),
    }).strict(),
    grant: z.object({
      expiresAt: timestamp,
      revoked: z.boolean()
    }).strict(),
    incomeConsent: z.object({
      version: id,
      expiresAt: timestamp,
      subjectIds: z.array(id).max(120),
    }).strict(),
    documentConsent: z.object({
      version: id,
      expiresAt: timestamp,
      documentIds: z.array(id).max(120),
    }).strict().nullable(),
  }).strict(),
  household: z.object({
    ...validation,
    complete: z.boolean(),
    people: z.array(z.object({
      subjectId: id,
      adult: z.boolean(),
      inventory: inventory.nullable()
    }).strict()).min(1).max(100),
  }).strict(),
  documents: z.array(document).max(120),
  bundles: z.array(bundle).max(2),
  zeroIncome: z.object({
    ...validation,
    expenseExplanation: z.enum(["complete","missing","unverified"]),
    form: z.object({
      documentId: id,
      sourceTemplateSha256: hash
    }).strict().nullable(),
  }).strict().nullable(),
  liheap: z.object({
    ...validation,
    grant: z.object({
      status: z.enum(["approved","pending","denied","unknown"]),
      accountRef: id,
      directedToPeco: z.boolean(),
      season: z.string().regex(/^\d{4}-\d{4}$/),
      approvedAt: timestamp.nullable(),
      appliedAt: timestamp.nullable(),
    }).strict(),
    sharing: z.object({
      status: z.enum(["verified","not_authorized","unknown"]),
      consentedAt: timestamp.nullable(),
      incomeAsOf: date.nullable(),
      incomeSeason: z.string().regex(/^\d{4}-\d{4}$/).nullable(),
      currentSeason: z.string().regex(/^\d{4}-\d{4}$/),
      provenanceRef: id,
    }).strict(),
    informedConsentForm: z.object({
      documentId: id,
      issuedAccountRef: id,
      issuedSeason: z.string().regex(/^\d{4}-\d{4}$/),
      issuedAt: timestamp,
      sourceTemplateSha256: hash,
      reviewedTemplateSha256: hash,
      templateVerifiedAt: timestamp,
      templateValidUntil: timestamp,
      templateProvenanceRef: id,
    }).strict().nullable(),
  }).strict().nullable(),
}).strict();

/**
 * Internal source-validated metadata, not a family-input or provenance-authentication API.
 * Proof dates describe income applicability, not an inferred daily payroll requirement.
 * Each sourceCoverage conclusion binds that applicability to exact originals and the current PA application date.
 */
export type PecoCapIncomeInput=z.infer<typeof inputSchema>;
type Binding=z.infer<typeof binding>;
type Target=z.infer<typeof target>;
type Bundle=z.infer<typeof bundle>;
type Requirement=Target&{ kind: z.infer<typeof sourceKind>|"none"; adult: boolean };
type Issue=Target&{ code: string; documentId?: string };
export type PecoCapIncomeAssessment={
  route: "undetermined"|"standard_proof"|"household_zero_income"|"liheap_full_application"|"liheap_informed_consent";
  preparationComplete: boolean;
  basis: Bundle["basis"]|null;
  selectedOriginals: { documentId: string; sha256: string }[];
  coverage: (Target&{ complete: boolean; proofRequirement: "required"|"not_required"|"unresolved"; documentIds: string[] })[];
  missingFacts: { code: string; targets: Target[] }[];
  serviceBlockers: Issue[];
};

const accepted: Record<Requirement["kind"],z.infer<typeof proofKind>[]>={
  employment: ["pay_stub","employer_letter"],
  unemployment: ["unemployment_award"],
  pension: ["pension_award","pension_check","matching_bank_deposit"],
  workers_compensation: ["workers_compensation_award","workers_compensation_check","matching_bank_deposit"],
  veterans: ["veterans_award","veterans_check","matching_bank_deposit"],
  cash_welfare: ["cash_benefit_award","compass_cash_detail"],
  child_support: ["child_support_order","domestic_relations_obligation","voluntary_child_support_letter"],
  spousal_support: ["alimony_order","alimony_check","matching_bank_deposit"],
  social_security: ["social_security_current_year_award","ssi_award","disability_award","survivor_award"],
  rental: ["rental_lease","cancelled_rent_check","rent_receipt"],
  self_employment: ["tax_1040"],
  none: [
    "unemployment_denial",
    "workers_compensation_exhaustion",
    "workers_compensation_denial",
    "veterans_denial",
    "cash_benefit_stop",
    "cash_benefit_denial",
    "social_security_denial",
    "bill_supporter_letter"
  ],
  other: [],
};
const zeroTemplates=new Set([
  "06f669f039e9dc9f8fd2c8b18672ea5732cca481b75d9acceaec06730daebc17",
  "81f414d40a07feab5c2beca2ebea0fa4988e6ea489b840f03e1fca7184c8df6e",
]);
const key=(value: Target) => JSON.stringify([value.subjectId,value.sourceId]);
const sameBinding=(a: Binding,b: Binding) =>
  Object.keys(a).every((field) => a[field as keyof Binding]===b[field as keyof Binding]);
const instant=(value: string) => Date.parse(value);
const day=(value: string) => Date.parse(`${value}T00:00:00Z`);
const dayMs=86400000;
function pennsylvaniaDate(now: Date) {
  const parts=Object.fromEntries(
    new Intl.DateTimeFormat("en-US",{
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now).map((part) => [part.type,part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Offline preparation assessment, never a submission, eligibility or certification decision. */
export function assessPecoCapIncomeEvidence(value: unknown,now: Date): PecoCapIncomeAssessment {
  let input: PecoCapIncomeInput;
  try {
    input=inputSchema.parse(value);
    if(!Number.isFinite(now.getTime())) throw new Error();
  } catch {
    throw new Error("The PECO income evidence could not be assessed from the supplied information.");
  }
  const { scope }=input;
  const today=pennsylvaniaDate(now);
  const result: PecoCapIncomeAssessment={
    route: "undetermined",
    preparationComplete: false,
    basis: null,
    selectedOriginals: [],
    coverage: [],
    missingFacts: [],
    serviceBlockers: [],
  };
  let unavailableLiheap: PecoCapIncomeAssessment|null=null;
  const applicant={
    subjectId: scope.applicantSubjectId,
    sourceId: null
  };
  const block=(code: string,target: Target=applicant,documentId?: string) => {
    result.serviceBlockers.push({
      code,
      ...target,
      ...(documentId? { documentId }:{})
    });
  };
  const missing=(code: string,targets: Target[]) => {
    const existing=result.missingFacts.find((item) => item.code===code);
    const clean=targets.map(({ subjectId,sourceId }) => ({
      subjectId,
      sourceId
    }));
    if(existing) existing.targets.push(...clean);
    else result.missingFacts.push({
      code,
      targets: clean
    });
  };
  const current=(record: { binding: Binding; verifiedAt: string; validUntil: string }) =>
    sameBinding(scope.binding,record.binding)&&
    instant(record.verifiedAt)<=now.getTime()&&
    instant(record.validUntil)>now.getTime();
  const done=() => {
    for(const item of result.missingFacts) {
      const unique=new Map(item.targets.map((target) => [key(target),target]));
      item.targets=[...unique.values()].sort((a,b) => key(a).localeCompare(key(b)));
    }
    result.serviceBlockers=[...new Map(result.serviceBlockers.map((issue) => [JSON.stringify(issue),issue])).values()];
    result.preparationComplete=result.serviceBlockers.length===0&&result.missingFacts.length===0;
    if(!result.preparationComplete&&unavailableLiheap) return unavailableLiheap;
    return result;
  };
  if(scope.requestState!=="active"||scope.mandate.revoked||
    scope.grant.revoked||
    instant(scope.mandate.expiresAt)<=now.getTime()||
    instant(scope.grant.expiresAt)<=now.getTime()||
    instant(scope.incomeConsent.expiresAt)<=now.getTime()||
    !scope.mandate.recipientIds.includes("peco-cap")||
    !scope.mandate.allowedActions.includes("prepare")||
    !["income","household"].every((category) => scope.mandate.allowedData.includes(category as "income"|"household"))) {
    block("preparation_authority_unavailable");
    return done();
  }
  if(scope.journey==="unknown") missing("selected_cap_journey",[applicant]);
  else if(scope.journey!=="new_enrollment"||
    scope.currentCapState==="enrolled") block("different_cap_journey_required");
  if(scope.currentCapState==="unknown") missing("current_cap_state",[applicant]);
  if(!current(input.household)) block("household_inventory_needs_validation");
  if(!input.household.complete) missing("complete_household_inventory",[applicant]);
  const people=input.household.people;
  if(new Set(people.map((person) => person.subjectId)).size!==people.length||
    !people.some((person) => person.subjectId===scope.applicantSubjectId&&person.adult)) block("household_subject_binding_invalid");
  for(const person of people)
    if((person.adult||person.inventory?.sources.length)&&
      !scope.incomeConsent.subjectIds.includes(person.subjectId)) block("subject_income_use_not_authorized",{
        subjectId: person.subjectId,
        sourceId: null
      });
  if(result.serviceBlockers.length||result.missingFacts.length) return done();

  const documents=new Map(input.documents.map((document) => [document.documentId,document]));
  if(documents.size!==input.documents.length) {
    block("duplicate_document_reference");
    return done();
  }
  const documentIssue=(documentId: string) => {
    const document=documents.get(documentId);
    if(!document) return "original_document_unavailable";
    if(!scope.mandate.allowedData.includes("documents")||
      !scope.documentConsent||
      instant(scope.documentConsent.expiresAt)<=now.getTime()||
      !scope.documentConsent.documentIds.includes(documentId)) return "document_use_not_authorized";
    if(!sameBinding(scope.binding,document.binding)) return "document_scope_mismatch";
    if(document.status!=="validated"||!document.originalAvailable||
      !document.uploadConfirmedAt||
      instant(document.uploadConfirmedAt)>now.getTime()||
      !document.validatedAt||
      instant(document.validatedAt)>now.getTime()||
      instant(document.validatedAt)<instant(document.uploadConfirmedAt)||
      Math.min(instant(document.expiresAt),instant(document.validatedAt)+dayMs)<=now.getTime()) {
      return "original_document_needs_validation";
    }
    if(document.coverage.some((coverage) =>
      !people.some((person) => person.subjectId===coverage.subjectId),
    )) return "document_subject_mismatch";
    if(document.coverage.some((coverage) => {
      const person=people.find((person) => person.subjectId===coverage.subjectId)!;
      return coverage.sourceId===null
        ? person.inventory?.state!=="none"
        :!person.inventory?.sources.some((source) => source.sourceId===coverage.sourceId);
    })) return "document_source_mismatch";
    return null;
  };
  const select=(documentIds: string[]) => {
    result.selectedOriginals=[...new Set(documentIds)].sort().map((documentId) => ({
      documentId,
      sha256: documents.get(documentId)!.sha256
    }));
  };

  const liheap=input.liheap;
  const liheapAssessment=(() => {
    if(liheap?.grant.status==="approved"&&
      liheap.grant.directedToPeco&&
      liheap.grant.accountRef===scope.binding.accountRef) {
      if(!current(liheap)) {
        block("liheap_record_needs_validation");
        return done();
      }
      const grant=liheap.grant;
      result.route="liheap_full_application";
      if(!grant.approvedAt||
        instant(grant.approvedAt)>now.getTime()||
        (grant.appliedAt&&
          (instant(grant.appliedAt)>now.getTime()||instant(grant.appliedAt)<instant(grant.approvedAt)))) {
        block("liheap_grant_dates_unverified");
      }
      if((grant.approvedAt&&instant(grant.approvedAt)>instant(liheap.verifiedAt))||
        (grant.appliedAt&&instant(grant.appliedAt)>instant(liheap.verifiedAt))) block("liheap_grant_dates_unverified");
      if(liheap.sharing.status==="unknown") block("dhs_sharing_needs_verification");
      if(result.serviceBlockers.length) return done();
      if(liheap.sharing.status==="verified") {
        const sharing=liheap.sharing;
        const yearAgo=new Date(`${today}T12:00:00Z`);
        yearAgo.setUTCFullYear(yearAgo.getUTCFullYear()-1);
        // Only the reviewed Pennsylvania 2026 transition is known; later seasons need a new source review.
        const operationalSeason=today.startsWith("2026-")
          ? today>="2026-11-02"? "2026-2027":"2025-2026"
          :null;
        const priorSeason=operationalSeason
          ? `${Number(operationalSeason.slice(0,4))-1}-${operationalSeason.slice(0,4)}`
          :null;
        const seasonSupported=operationalSeason!==null&&
          sharing.currentSeason===operationalSeason&&
          [operationalSeason,priorSeason].includes(sharing.incomeSeason);
        const recent=sharing.incomeAsOf&&
          day(sharing.incomeAsOf)>=day(yearAgo.toISOString().slice(0,10))&&
          sharing.incomeAsOf<=today;
        if(!sharing.consentedAt||
          instant(sharing.consentedAt)>now.getTime()||
          (operationalSeason&&sharing.currentSeason!==operationalSeason)||
          (!recent&&!seasonSupported)) block("dhs_income_recency_or_consent_unverified");
        if(sharing.incomeAsOf&&
          sharing.incomeAsOf>today) block("dhs_income_recency_or_consent_unverified");
        if(sharing.incomeAsOf&&
          day(sharing.incomeAsOf)>instant(liheap.verifiedAt)) block("dhs_income_recency_or_consent_unverified");
        if(result.serviceBlockers.length) return done();
        if(operationalSeason==="2026-2027"&&grant.season==="2026-2027"&&
          grant.appliedAt) {
          result.route="liheap_informed_consent";
          const form=liheap.informedConsentForm;
          if(!form) block("provider_issued_informed_consent_form_unavailable");
          else {
            const issue=documentIssue(form.documentId);
            if(issue) block(issue,applicant,form.documentId);
            if(form.issuedAccountRef!==scope.binding.accountRef||
              form.issuedSeason!==grant.season||
              instant(form.issuedAt)<instant(grant.appliedAt)||
              instant(form.issuedAt)>now.getTime()||
              instant(form.templateVerifiedAt)>now.getTime()||
              instant(form.templateValidUntil)<=now.getTime()||
              form.sourceTemplateSha256!==form.reviewedTemplateSha256||
              documents.get(form.documentId)?.sha256!==form.sourceTemplateSha256||
              !documents.get(form.documentId)?.uploadConfirmedAt||
              instant(documents.get(form.documentId)!.uploadConfirmedAt!)<instant(form.issuedAt)) {
              block("issued_informed_consent_form_needs_verification");
            }
            if(!result.serviceBlockers.length) select([form.documentId]);
          }
        }
        return done();
      }
    }
    return null;
  })();
  if(liheapAssessment) {
    if(liheapAssessment.preparationComplete||
      liheapAssessment.route==="liheap_informed_consent") {
      return liheapAssessment;
    }
    unavailableLiheap=structuredClone(liheapAssessment);
    result.route="undetermined";
    result.serviceBlockers=[];
    result.missingFacts=[];
  }

  const requirements: Requirement[]=[];
  for(const person of people) {
    const record=person.inventory;
    const ref={
      subjectId: person.subjectId,
      sourceId: null
    };
    if(!person.adult&&!record?.sources.length) continue;
    if(!record||record.state==="unknown"||
      !record.complete) {
      if(person.adult) missing("complete_income_source_inventory",[ref]);
      else if(record?.sources.length) block("minor_declared_income_inventory_needs_validation",ref);
      continue;
    }
    if(!current(record)) {
      block("income_source_inventory_needs_validation",ref);
      continue;
    }
    if((record.state==="none"&&record.sources.length)||
      (record.state==="sources"&&!record.sources.length)||
      new Set(record.sources.map((source) => source.sourceId)).size!==record.sources.length) {
      block("income_source_inventory_conflict",ref);
      continue;
    }
    if(record.state==="none"&&person.adult) requirements.push({
      ...ref,
      kind: "none",
      adult: true
    });
    for(const source of record.sources) requirements.push({
      subjectId: person.subjectId,
      ...source,
      adult: person.adult
    });
  }
  if(result.serviceBlockers.length||result.missingFacts.length) return done();
  if(requirements.every((requirement) => requirement.kind==="none")) {
    result.route="household_zero_income";
    const zero=input.zeroIncome;
    if(!zero||zero.expenseExplanation==="missing") missing("living_expense_explanation",[applicant]);
    if(!zero?.form) block("official_zero_income_form_not_prepared");
    if(zero) {
      if(!current(zero)) block("zero_income_information_needs_validation");
      if(zero.expenseExplanation==="unverified") block("living_expense_explanation_needs_validation");
      if(zero.form) {
        if(!zeroTemplates.has(zero.form.sourceTemplateSha256)) block("official_zero_income_form_needs_validation");
        const issue=documentIssue(zero.form.documentId);
        if(issue) block(issue,applicant,zero.form.documentId);
        if(!result.serviceBlockers.length&&
          !result.missingFacts.length) {
          select([zero.form.documentId]);
          result.coverage=requirements.map(({ subjectId,sourceId }) => ({
            subjectId,
            sourceId,
            complete: true,
            proofRequirement: "required",
            documentIds: [zero.form!.documentId]
          }));
        }
      }
    }
    return done();
  }

  result.route="standard_proof";
  if(new Set(input.bundles.map((bundle) => bundle.basis)).size!==input.bundles.length) {
    block("duplicate_income_period");
    return done();
  }
  const candidates=input.bundles.map((bundle) => {
    const blockers: Issue[]=[];
    const missingTargets: Target[]=[];
    const coverage: PecoCapIncomeAssessment["coverage"]=[];
    const addIssue=(
      code: string,
      target: Target=applicant,
      documentId?: string,
    ) => blockers.push({
      code,
      ...target,
      ...(documentId? { documentId }:{})
    });
    const start=day(bundle.periodStart);
    const end=day(bundle.periodEnd);
    const expectedEnd=new Date(start);
    expectedEnd.setUTCFullYear(expectedEnd.getUTCFullYear()+1);
    if(
      !current(bundle)||bundle.periodEnd!==today||
      start>end||
      (bundle.basis==="30_days"
        ? end-start!==29*dayMs
        :end!==expectedEnd.getTime()-dayMs)
    ) {
      addIssue("documented_income_period_needs_validation");
    }
    for(const requirement of requirements) {
      const ref={
        subjectId: requirement.subjectId,
        sourceId: requirement.sourceId,
      };
      const conclusions=bundle.sourceCoverage.filter(
        (conclusion) => key(conclusion)===key(requirement),
      );
      const conclusion=conclusions[0];
      const before=blockers.length;
      const selected: string[]=[];
      if(!conclusion) {
        if(!requirement.adult) {
          addIssue("minor_income_proof_applicability_unresolved",ref);
        } else if(bundle.documentIds.some((documentId) =>
          documents.get(documentId)?.coverage.some((proof) => key(proof)===key(ref)),
        )) {
          addIssue("income_source_coverage_needs_validation",ref);
        } else {
          missingTargets.push(ref);
        }
      } else if(
        conclusions.length!==1||!conclusion.completenessVerified||
        conclusion.basis!==bundle.basis||
        conclusion.applicationAsOf!==bundle.periodEnd||
        conclusion.applicabilityRule==="unverified"
      ) {
        addIssue("income_source_coverage_needs_validation",ref);
      } else if(
        conclusion.proofRequirement==="unresolved"||
        (requirement.adult&&conclusion.proofRequirement!=="required")
      ) {
        addIssue(
          requirement.adult
            ? "adult_income_proof_applicability_unresolved"
            :"minor_income_proof_applicability_unresolved",
          ref,
        );
      } else if(conclusion.proofRequirement==="not_required") {
        if(conclusion.documentRefs.length) {
          addIssue("income_source_coverage_needs_validation",ref);
        }
      } else if(!conclusion.documentRefs.length) {
        addIssue("income_source_coverage_needs_validation",ref);
      } else {
        for(const original of conclusion.documentRefs) {
          const issue=documentIssue(original.documentId);
          const document=documents.get(original.documentId);
          if(issue) {
            addIssue(issue,ref,original.documentId);
            continue;
          }
          if(
            !bundle.documentIds.includes(original.documentId)||
            document!.sha256!==original.sha256
          ) {
            addIssue("income_coverage_original_mismatch",ref,original.documentId);
            continue;
          }
          const proofs=document!.coverage.filter((proof) => key(proof)===key(ref));
          const valid=proofs.some((proof) =>
            accepted[requirement.kind].includes(proof.proofKind)&&
            proof.detailsVerified&&
            (requirement.kind==="none"
              ? proof.grossBasis==="not_applicable"&&
              conclusion.applicabilityRule==="individual_no_income"
              :proof.grossBasis==="gross")&&
            (proof.proofKind!=="tax_1040"||
              conclusion.applicabilityRule==="representative_1040")&&
            (proof.proofKind!=="social_security_current_year_award"||
              proof.issueYear===Number(today.slice(0,4)))&&
            day(proof.periodStart)<=day(proof.periodEnd)&&
            day(proof.periodStart)<=end&&
            day(proof.periodEnd)>=start,
          );
          if(!valid) {
            const kindSupported=proofs.some((proof) =>
              accepted[requirement.kind].includes(proof.proofKind),
            );
            addIssue(
              !kindSupported
                ? requirement.kind==="none"
                  ? "individual_zero_evidence_needs_verification"
                  :"proof_type_needs_verification"
                :"income_proof_details_need_validation",
              ref,
              original.documentId,
            );
          } else {
            selected.push(original.documentId);
          }
        }
      }
      coverage.push({
        ...ref,
        complete: blockers.length===before&&!missingTargets.some((missing) => key(missing)===key(ref)),
        proofRequirement: conclusion?.proofRequirement??"unresolved",
        documentIds: [...new Set(selected)].sort(),
      });
    }
    return {
      bundle,
      blockers,
      missing: missingTargets,
      coverage,
      complete: blockers.length===0&&missingTargets.length===0,
    };
  });
  const complete=candidates.filter((candidate) => candidate.complete);
  const usable=complete.filter((candidate) => candidate.bundle.representativeness==="verified");
  if(!usable.length) {
    if(complete.length) {
      block("income_period_representativeness_unresolved");
      return done();
    }
    if(!candidates.length) {
      if(input.documents.length) block("documented_income_period_unresolved");
      else {
        missing("income_evidence",requirements.filter((requirement) => requirement.adult));
        for(const requirement of requirements.filter((requirement) => !requirement.adult)) {
          block("minor_income_proof_applicability_unresolved",requirement);
        }
      }
    } else {
      const closest=[...candidates].sort((a,b) => a.missing.length-b.missing.length||
        a.blockers.length-b.blockers.length||
        a.bundle.basis.localeCompare(b.bundle.basis))[0];
      result.coverage=closest.coverage;
      result.serviceBlockers.push(...closest.blockers);
      if(closest.missing.length) missing("income_evidence",closest.missing);
    }
    return done();
  }
  const comparable=(a: Bundle,b: Bundle) => {
    const first=a.annualGrossSummary;
    const second=b.annualGrossSummary;
    const expected=requirements.map(key).sort().join("|");
    return first&&second&&a.periodEnd===b.periodEnd&&
      first.basis==="gross"&&
      second.basis==="gross"&&
      first.comparisonRef===second.comparisonRef&&
      [first,second].every((summary) =>
        summary.sourceRefs.map(key).sort().join("|")===expected,
      );
  };
  let chosen=usable[0];
  if(usable.length===2) {
    const [a,b]=usable;
    if(!comparable(a.bundle,b.bundle)) {
      block("annual_gross_comparison_unresolved");
      return done();
    }
    const first=a.bundle.annualGrossSummary!.annualGrossCents;
    const second=b.bundle.annualGrossSummary!.annualGrossCents;
    chosen=first<second? a:second<first? b:
      usable.find((candidate) => candidate.bundle.basis==="30_days")!;
  } else if(complete.some((candidate) =>
    candidate.bundle.representativeness==="unresolved"&&
    comparable(candidate.bundle,chosen.bundle)&&
    candidate.bundle.annualGrossSummary!.annualGrossCents<chosen.bundle.annualGrossSummary!.annualGrossCents,
  )) {
    block("income_period_representativeness_unresolved");
    return done();
  }
  result.basis=chosen.bundle.basis;
  result.coverage=chosen.coverage;
  select(chosen.coverage.flatMap((coverage) => coverage.documentIds));
  return done();
}
