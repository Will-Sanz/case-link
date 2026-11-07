import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessSnapApplicationFields, snapApplicationFieldsSchema, snapApplicationFieldsValueSchema, SNAP_APPLICATION_SOURCE, type SnapApplicationFields } from "./snap-application-fields";

const now = new Date("2026-11-03T21:00:00Z");
const personId = "11111111-1111-4111-8111-111111111111";
const incomeId = "22222222-2222-4222-8222-222222222222";
function complete(): SnapApplicationFields {
  return {
    zip: "19104", language: "en", householdSize: 1,
    applicant: { firstName: "Maria", lastName: "Rivera" },
    address: { street: "123 Synthetic Lane", city: "Philadelphia", state: "PA" }, county: "Philadelphia", phone: "215-555-0101", interpreter: false,
    screening: { lowCashAndIncome: false, migrantOrSeasonal: false, belowShelterCosts: true },
    household: [{ id: personId, firstName: "Maria", lastName: "Rivera", dateOfBirth: "1988-04-15", sex: "female", student: false, relationship: "SELF", requestingSnap: true, citizen: true }],
    income: { month: "2026-11", hasIncome: true, entries: [{ id: incomeId, personId, source: "Employment", amount: 0, frequency: "Every two weeks", status: "received", date: "2026-11-01" }] },
    history: { fleeingOrProbation: { answer: false }, welfareFraud: { answer: false }, otherStateDisqualification: { answer: false } },
    expenses: { childSupport: false, mealsIncludedInRent: false, heat: true, housingAssistance: false, outsidePayer: false, airConditioning: false, care: false, utilities: ["electric"], rent: 800 },
    expenseClaims: { household: "claim", housing: ["rent"], medical: "not_applicable" },
  };
}
const valid = (value: unknown) => snapApplicationFieldsSchema(now).safeParse(value).success;

describe("complete SNAP application values", () => {
  it("binds the immutable reviewed source inventory without becoming a submission or identity contract", () => {
    const raw = readFileSync("data/verified-forms/snap-pa600fs-2019.fields.json");
    const inventory = JSON.parse(raw.toString());
    expect(SNAP_APPLICATION_SOURCE.inventorySha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(SNAP_APPLICATION_SOURCE.inventoryId).toBe(inventory.id);
    expect(SNAP_APPLICATION_SOURCE.inventoryVersion).toBe(inventory.version);
    expect(SNAP_APPLICATION_SOURCE.templateSha256).toBe(inventory.source.sha256);
    const result = assessSnapApplicationFields(complete(), now);
    expect(result.nonProtectedDataReadyForReview).toBe(true);
    expect(result.submissionReady).toBe(false);
    expect(result.protectedSteps).toEqual([
      { step: "required_identifier_or_verified_exception", personId },
      { step: "genuine_applicant_certifications_printed_pages_1_and_5" },
      { step: "permitted_delivery_and_actual_agency_receipt" },
    ]);
  });
  it("preserves partial unknown facts and never converts size or aggregate income into rows", () => {
    const value = { zip: "19104", language: "es", householdSize: 3, incomeAmount: 680, incomeFrequency: "biweekly" };
    expect(snapApplicationFieldsSchema(now).parse(value)).toEqual(value);
    const result = assessSnapApplicationFields(value, now);
    expect(result.nonProtectedDataReadyForReview).toBe(false);
    expect(result.missingFields).toEqual(expect.arrayContaining(["household", "income", "screening.lowCashAndIncome"]));
    expect(result.serviceQuestions).toContain("address_or_provider_accepted_alternative");
  });
  it("keeps an explicit expected future current-month payment separate from money received", () => {
    const value = complete(); value.income!.entries![0] = { ...value.income!.entries![0], status: "expected", date: "2026-11-20", source: "Self employment", frequency: "Irregular" };
    expect(valid(value)).toBe(true);
    const result = assessSnapApplicationFields(value, now);
    expect(result.nonProtectedDataReadyForReview).toBe(true);
    expect(result.renderingRequirements).toContain("explicit_expected_income_rendering");
    expect(snapApplicationFieldsSchema(now).parse(value).income?.entries?.[0].status).toBe("expected");
  });
  it.each([
    { status: "received", date: "2026-11-04" }, { status: "expected", date: "2026-11-01" },
    { status: "expected", date: "2026-12-01" }, { status: "received", date: "2026-10-31" },
    { status: "received", date: "2026-02-30" },
  ])("rejects contradictory or non-current income timing %j", (entry) => {
    const value = complete(); Object.assign(value.income!.entries![0], entry); expect(valid(value)).toBe(false);
  });
  it("uses the Eastern calendar month and does not refresh supplied income periods", () => {
    const value = complete(); value.income = { month: "2026-10", hasIncome: false };
    expect(snapApplicationFieldsSchema(new Date("2026-11-01T01:00:00Z")).safeParse(value).success).toBe(true);
    expect(valid(value)).toBe(false);
  });
  it("retains historical values after a month rollover while identifying stale income for current preparation", () => {
    const value = complete(); const original = structuredClone(value);
    const later = new Date("2026-12-01T15:00:00Z");
    expect(snapApplicationFieldsValueSchema.parse(value)).toEqual(original);
    expect(snapApplicationFieldsSchema(later).safeParse(value).success).toBe(false);
    const result = assessSnapApplicationFields(value, later);
    expect(result.nonProtectedDataReadyForReview).toBe(false);
    expect(result.sourceReviewCurrent).toBe(true);
    expect(result.serviceQuestions).toContain("refresh_current_month_income");
    expect(result.invalidCurrentFields).toEqual(["income.month", `income.entries.${incomeId}.date`]);
    expect(result.missingFields).not.toContain("zip");
    expect(snapApplicationFieldsValueSchema.parse(value)).toEqual(original);
    expect(value).toEqual(original);
  });
  it("keeps protected-content and relationship guards on the historical parser", () => {
    const value = complete(); value.applicant!.firstName = "123-45-6789";
    expect(snapApplicationFieldsValueSchema.safeParse(value).success).toBe(false);
    const orphan = complete(); orphan.income!.entries![0].personId = "33333333-3333-4333-8333-333333333333";
    expect(snapApplicationFieldsValueSchema.safeParse(orphan).success).toBe(false);
  });
  it("accepts known no income without inventing zero-valued payment rows", () => {
    const value = complete(); value.income = { month: "2026-11", hasIncome: false };
    expect(assessSnapApplicationFields(value, now).nonProtectedDataReadyForReview).toBe(true);
    expect(snapApplicationFieldsSchema(now).parse(value).income?.entries).toBeUndefined();
  });
  it("supports applicable conditional answers without demanding unrelated housing or medical amounts", () => {
    const value = complete(); value.expenses = { ...value.expenses!, childSupport: true, courtOrdered: true,
      housingAssistance: true, housingAssistanceKind: "Rental support", utilityAllowance: false,
      outsidePayer: true, outsideExpenses: "Water", outsideAmount: 0, outsideFrequency: "Monthly", outsidePayee: "Utility",
      care: true, careMonthlyAmount: 0, careRecipient: "Household member", utilities: ["other"], otherUtility: "Other household fuel",
      medical: ["other"], otherMedical: "Other applicable expense" };
    value.expenseClaims!.medical = "claim";
    expect(assessSnapApplicationFields(value, now).nonProtectedDataReadyForReview).toBe(true);
    delete value.expenses.courtOrdered; delete value.expenses.otherMedical;
    expect(assessSnapApplicationFields(value, now).missingFields).toEqual(expect.arrayContaining(["expenses.courtOrdered", "expenses.otherMedical"]));
  });
  it("requires a distinct explicit deduction election rather than treating unknown expenses as waived", () => {
    const value = complete(); delete value.expenses; delete value.expenseClaims;
    expect(assessSnapApplicationFields(value, now).missingFields).toContain("expenseClaims.household");
    value.expenseClaims = { household: "do_not_claim", medical: "do_not_claim" };
    expect(assessSnapApplicationFields(value, now).nonProtectedDataReadyForReview).toBe(true);
  });
  it("does not invent missing phone or address alternatives or make a phone a minimum filing fact", () => {
    const value = complete(); delete value.phone;
    const result = assessSnapApplicationFields(value, now);
    expect(result.minimumFilingNameAndAddressPresent).toBe(true);
    expect(result.nonProtectedDataReadyForReview).toBe(true);
    expect(result.serviceQuestions).toEqual([]);
    expect(result.optionalContactNotes).toEqual(["phone_not_supplied"]);
    expect(snapApplicationFieldsSchema(now).parse(value).phone).toBeUndefined();
    delete value.address;
    expect(assessSnapApplicationFields(value, now).serviceQuestions).toContain("address_or_provider_accepted_alternative");
  });
  it.each(["None", "hello", "215", "215-HELLO-01"])("rejects an invented or unusable supplied phone: %s", phone => {
    const value = complete(); value.phone = phone; expect(valid(value)).toBe(false);
  });
  it("accepts a conventional international phone without mistaking its digit count for an identifier", () => {
    const value = complete(); value.phone = "+442079460018"; expect(valid(value)).toBe(true);
  });
  it("omits citizenship questions for non-applicants and keeps noncitizen documents protected", () => {
    const value = complete(); value.household!.push({ id: "33333333-3333-4333-8333-333333333333", firstName: "Leo", lastName: "Rivera", dateOfBirth: "2018-03-12", sex: "male", student: true, relationship: "Child", requestingSnap: false });
    value.householdSize = 2; value.household![0].citizen = false;
    const result = assessSnapApplicationFields(value, now);
    expect(result.nonProtectedDataReadyForReview).toBe(true);
    expect(result.protectedSteps).toContainEqual({ step: "noncitizen_applicant_documentation", personId });
    expect(result.protectedSteps.filter(s => "personId" in s && s.personId === value.household![1].id)).toHaveLength(0);
    value.household![1].citizen = false; expect(valid(value)).toBe(false);
  });
  it("accepts partial records with stable IDs and reports missing values without replacing them", () => {
    const value = { household: [{ id: personId, firstName: "Maria" }], income: { month: "2026-11", entries: [{ id: incomeId, personId }] } };
    expect(valid(value)).toBe(true);
    expect(assessSnapApplicationFields(value, now).missingFields).toContain(`household.${personId}.dateOfBirth`);
    expect(snapApplicationFieldsSchema(now).parse(value)).toEqual(value);
  });
  it.each([
    { ssn: "PRIVATE_IDENTIFIER" }, { password: "PRIVATE_CREDENTIAL" }, { signature: "PRIVATE_SIGNATURE" }, { race: "White" }, { voterRegistration: true }, { cao: { eligible: true } },
  ])("strictly rejects protected or excluded top-level fields %j", (extra) => expect(valid({ ...complete(), ...extra })).toBe(false));
  it.each(["123-45-6789", "１２３/４５/６７８９", "password=private-value", "signature:PRIVATE_SIGNATURE"])("rejects protected content in an ordinary text field without changing the general identifier guards: %s", (firstName) => {
    const value = complete(); value.applicant!.firstName = firstName; value.household![0].firstName = firstName; expect(valid(value)).toBe(false);
  });
  it.each([
    (v: SnapApplicationFields) => { v.household![0] = { ...v.household![0], ssn: "PRIVATE_IDENTIFIER" } as never; },
    (v: SnapApplicationFields) => { v.household!.push(v.household![0]); },
    (v: SnapApplicationFields) => { v.income!.entries!.push(v.income!.entries![0]); },
    (v: SnapApplicationFields) => { v.income!.entries![0].personId = "33333333-3333-4333-8333-333333333333"; },
    (v: SnapApplicationFields) => { v.household![0].dateOfBirth = "2027-01-01"; },
    (v: SnapApplicationFields) => { v.applicant!.firstName = "Another person"; },
    (v: SnapApplicationFields) => { v.income!.hasIncome = false; },
    (v: SnapApplicationFields) => { v.expenses!.courtOrdered = true; },
    (v: SnapApplicationFields) => { v.expenses!.housingAssistanceKind = "Inapplicable"; },
    (v: SnapApplicationFields) => { v.expenses!.outsideAmount = 20; },
    (v: SnapApplicationFields) => { v.expenses!.careMonthlyAmount = 20; },
    (v: SnapApplicationFields) => { v.expenses!.utilities = ["electric", "electric"]; },
    (v: SnapApplicationFields) => { v.expenses!.otherUtility = "Inapplicable"; },
    (v: SnapApplicationFields) => { v.expenses!.medical = ["dental"]; },
    (v: SnapApplicationFields) => { v.expenseClaims!.housing = []; },
    (v: SnapApplicationFields) => { v.expenseClaims!.household = "do_not_claim"; },
    (v: SnapApplicationFields) => { v.history!.welfareFraud = { answer: false, names: "Private name" }; },
  ])("rejects contradictory, orphaned or duplicate records %#", (change) => { const value = complete(); change(value); expect(valid(value)).toBe(false); });
  it("does not confuse populated rows beyond printed capacity with a completed render", () => {
    const value = complete(); value.householdSize = 9;
    value.household = [value.household![0], ...Array.from({ length: 8 }, (_, i) => ({ ...value.household![0], id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, firstName: `Person${i}`, relationship: "Relative", requestingSnap: false, citizen: undefined }))];
    value.income!.entries = Array.from({ length: 6 }, (_, i) => ({ ...value.income!.entries![0], id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    const result = assessSnapApplicationFields(value, now);
    expect(result.nonProtectedDataReadyForReview).toBe(true);
    expect(result.renderingRequirements).toEqual(["accepted_household_continuation", "accepted_income_continuation"]);
    expect(result.submissionReady).toBe(false);
  });
  it("keeps a supplied representative separate from genuine designation and signatures", () => {
    const value = complete(); value.authorizedRepresentative = { name: "Real representative", address: { street: "20 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19104" }, phone: "215-555-0101" };
    expect(assessSnapApplicationFields(value, now).protectedSteps).toContainEqual({ step: "genuine_representative_designation_and_personal_act" });
  });
  it("retains the source review window without erasing valid saved values", () => {
    const value = complete(); const result = assessSnapApplicationFields(value, new Date("2026-11-02T12:00:00Z"));
    expect(result.sourceReviewCurrent).toBe(false);
    expect(result.serviceQuestions).toContain("current_form_source_review");
  });
});
