import { describe, expect, it } from "vitest";
import { WATER_APPLICATION_REFERENCE, assessWaterApplicationFields, waterApplicationFieldsValueSchema, waterApplicationLeaves, waterMoneySchema } from "./water-application-fields";

const applicantId = "11111111-1111-4111-8111-111111111111", childId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333", supporterId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-11-13T22:15:00Z");
const details = () => ({ journey: "new_application", existingApplication: "none_known", householdComplete: true,
  applicant: { id: applicantId, name: "Fictional Parent", dateOfBirth: "1990-01-01", grossMonthlyIncome: "1200.50", income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }] } },
  propertyAddress: "100 Synthetic Lane", householdMembers: [{ id: childId, name: "Fictional Child", dateOfBirth: "2020-01-01", relationship: "Child" }],
  childSupportReceived: "no", outsideIncomeSupport: "no",
});
describe("Philadelphia water reference fields", () => {
  it.each([{}, { journey: "unknown", existingApplication: "unknown" }, { journey: "recertification", existingApplication: "saved" }, { applicant: { id: applicantId } }])("preserves partial and continuing facts without inferring a new application: %j", value => {
    expect(waterApplicationFieldsValueSchema.parse(value)).toEqual(value);
  });
  it.each([{ waterAccessCode: "123456789" }, { applicationId: "SAVED-SECRET" }, { accountNumberSha256: "a".repeat(64) }, { protectedInputRef: applicantId },
    { ssn: "123-45-6789" }, { signatures: true }, { hardship: "medical" }, { diagnosis: "private" }, { programChoice: "lowest_bill" },
    { applicant: { id: applicantId, name: "１２３／４５／６７８９" } }, { applicant: { id: applicantId, name: "access code=private" } },
    { applicant: { id: applicantId, dateOfBirth: "2025-02-29" } }, { applicant: { id: applicantId }, householdMembers: [{ id: applicantId.toUpperCase() }] },
    { householdComplete: true }, { childSupportMonthlyAmount: "10" }, { outsideSupporters: [{ id: supporterId }] },
    { outsideIncomeSupport: "yes", outsideSupporters: [{ id: supporterId, frequency: "monthly", frequencyDescription: "week" }] },
    { applicant: { id: applicantId, grossMonthlyIncome: "1", income: { state: "none", sources: [] } } },
    { applicant: { id: applicantId, income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }, { id: sourceId.toUpperCase(), kind: "other" }] } } },
  ])("rejects protected/uncovered values and contradictory records: %j", value => {
    expect(waterApplicationFieldsValueSchema.safeParse(value).success).toBe(false);
  });
  it.each([["0", "0.00"], ["10.5", "10.50"], ["9999999.99", "9999999.99"]])("keeps USD exact without floating point: %s", (input, expected) => {
    expect(waterMoneySchema.parse(input)).toBe(expected);
  });
  it.each(["-1", "01", "1e3", "1.001", "10000000", "NaN", "", " 1"])("rejects ambiguous or unsupported amounts: %s", amount => {
    expect(waterMoneySchema.safeParse(amount).success).toBe(false);
  });
  it("keeps provenance paths stable across people/source reorder and canonical equivalent amounts", () => {
    const value = waterApplicationFieldsValueSchema.parse({ ...details(), applicant: { ...details().applicant, grossMonthlyIncome: "1200.5" }, householdMembers: [{ id: childId }, { id: supporterId }] });
    const reordered = { ...value, householdMembers: [...value.householdMembers!].reverse() };
    expect(waterApplicationLeaves(value)).toEqual(waterApplicationLeaves(reordered));
    expect(waterApplicationLeaves(value)[`applicant.${applicantId}.grossMonthlyIncome`]).toBe("1200.50");
    expect(waterApplicationLeaves({ applicant: { id: childId, name: "Fictional Parent" } })).not.toEqual(waterApplicationLeaves({ applicant: { id: applicantId, name: "Fictional Parent" } }));
  });
  it("groups missing expected facts while every real form, proof, act and provider outcome remains unresolved", () => {
    const result = assessWaterApplicationFields({ applicant: { id: applicantId, income: { state: "unknown", sources: [] } } }, now);
    expect(result.missingFacts.find(item => item.group === "applicant")?.fields).toEqual(["applicant.name", "applicant.dateOfBirth", "applicant.grossMonthlyIncome", "applicant.income"]);
    expect(result.referenceFieldsPresent).toBe(false); expect(result.actualFormReady).toBe(false); expect(result.submissionReady).toBe(false);
    expect(result.providerStatus).toBe("unverified"); expect(result.shutoffProtection).toBe("unverified");
    expect(result.serviceBlockers).toContain("actual_account_issued_form_unverified");
  });
  it("derives only the SAMPLE's child-row zero, preserving the family's private facts and no-income distinction", () => {
    const value = details(), before = structuredClone(value), result = assessWaterApplicationFields(value, now);
    expect(result.referenceFieldsPresent).toBe(true); expect(value).toEqual(before);
    expect(result.householdIncome).toEqual([{ subjectId: applicantId, amount: "1200.50", basis: "parent_answer" }, { subjectId: childId, amount: "0.00", basis: "sample_under_18_instruction" }]);
    expect(result.actualFormReady).toBe(false); expect(result.submissionReady).toBe(false);
  });
  it("uses the Pennsylvania day before an eighteenth birthday rather than UTC midnight", () => {
    const value = details(); value.householdMembers[0].dateOfBirth = "2008-11-14";
    expect(assessWaterApplicationFields(value, new Date("2026-11-14T02:00:00Z")).missingFacts.some(item => item.fields.includes(`householdMembers.${childId}.grossMonthlyIncome`))).toBe(false);
    expect(assessWaterApplicationFields(value, new Date("2026-11-14T05:00:00Z")).missingFacts.some(item => item.fields.includes(`householdMembers.${childId}.grossMonthlyIncome`))).toBe(true);
  });
  it("keeps a minor applicant's separate required gross-income box without inventing an adult eligibility rule", () => {
    const value = details(); value.applicant.dateOfBirth = "2009-01-01";
    const result = assessWaterApplicationFields(value, now);
    expect(result.referenceFieldsPresent).toBe(true);
    expect(result.householdIncome.find(person => person.subjectId === applicantId)).toEqual({ subjectId: applicantId, amount: "1200.50", basis: "parent_answer" });
    expect(result.serviceBlockers).not.toContain("adult_applicant_required"); expect(result.actualFormReady).toBe(false);
    const incomplete = { ...value, applicant: { ...value.applicant, grossMonthlyIncome: undefined } };
    expect(assessWaterApplicationFields(incomplete, now).missingFacts.find(group => group.group === "applicant")?.fields).toContain("applicant.grossMonthlyIncome");
  });
  it("keeps known saved/submitted/pending work on reconciliation instead of authorizing a duplicate", () => {
    for (const existingApplication of ["saved", "submitted"])
      expect(assessWaterApplicationFields({ ...details(), existingApplication }, now).serviceBlockers).toContain("reconcile_existing_application_before_new_request");
    expect(assessWaterApplicationFields({ ...details(), journey: "pending" }, now).serviceBlockers).toContain("reconcile_existing_application_before_new_request");
  });
  it("asks only applicable outside-support facts and preserves an unresolved period", () => {
    const result = assessWaterApplicationFields({ ...details(), outsideIncomeSupport: "yes", outsideSupporters: [{ id: supporterId, name: "Fictional Supporter", address: "2 Synthetic Lane", amount: "20", frequency: "other" }] }, now);
    expect(result.missingFacts.find(item => item.group === `outsideSupporters.${supporterId}`)?.fields).toEqual([`outsideSupporters.${supporterId}.frequencyDescription`]);
  });
  it("expires reference review without turning the sample into an issued or submittable application", () => {
    const result = assessWaterApplicationFields(details(), new Date(WATER_APPLICATION_REFERENCE.verifiedUntil));
    expect(result.referenceFieldsPresent).toBe(false); expect(result.serviceBlockers).toContain("reference_review_expired");
    expect(WATER_APPLICATION_REFERENCE.kind).toBe("sample_reference_only");
  });
  it("uses the parent's actual applicant zero amount once and groups applicable financial explanations", () => {
    const value = { ...details(), applicant: { ...details().applicant, grossMonthlyIncome: "0", income: { state: "none", sources: [] } } };
    expect(assessWaterApplicationFields(value, now).missingFacts.find(group => group.group === "zero_income")?.fields).toEqual(["livingExpenses.food", "livingExpenses.housing", "livingExpenses.utilities"]);
    const complete = { ...value, livingExpenses: { food: "Using savings", housing: "Another household member pays rent", utilities: "Using savings" } };
    expect(assessWaterApplicationFields(complete, now)).toMatchObject({ referenceFieldsPresent: true, actualFormReady: false, submissionReady: false });
    expect(waterApplicationLeaves(complete)["livingExpenses.food"]).toBe("Using savings");
    expect(waterApplicationFieldsValueSchema.parse(complete)).not.toHaveProperty("zeroIncomeClaim");
  });
  it("does not infer whole-household no income from the applicant amount or a child's reference zero", () => {
    const value = { applicant: { id: applicantId, grossMonthlyIncome: "0" }, outsideIncomeSupport: "no", livingExpenses: { housing: "The other adult pays rent" },
      householdMembers: [{ id: childId, dateOfBirth: "1990-01-01", grossMonthlyIncome: "1200.00" }] };
    expect(waterApplicationFieldsValueSchema.safeParse(value).success).toBe(true);
    expect(assessWaterApplicationFields(details(), now).missingFacts.some(group => group.group === "zero_income")).toBe(false);
    expect(waterApplicationFieldsValueSchema.safeParse({ applicant: { id: applicantId, grossMonthlyIncome: "0" }, outsideIncomeSupport: "yes" }).success).toBe(true);
  });
  it.each([
    { livingExpenses: { food: "Using savings" } }, { applicant: { id: applicantId, grossMonthlyIncome: "0" }, outsideIncomeSupport: "unknown", livingExpenses: {} },
    { applicant: { id: applicantId, grossMonthlyIncome: "0" }, outsideIncomeSupport: "yes", livingExpenses: {} },
    { applicant: { id: applicantId, grossMonthlyIncome: "1.00" }, outsideIncomeSupport: "no", livingExpenses: {} },
    { zeroIncomeClaim: "yes" },
    { applicant: { id: applicantId, grossMonthlyIncome: "0" }, outsideIncomeSupport: "no", livingExpenses: { food: "password=secret" } },
    { applicant: { id: applicantId, grossMonthlyIncome: "0" }, outsideIncomeSupport: "no", livingExpenses: { medical: "private" } },
  ])("rejects uncovered or inapplicable zero-income preparation: %j", value => {
    expect(waterApplicationFieldsValueSchema.safeParse(value).success).toBe(false);
  });

});
