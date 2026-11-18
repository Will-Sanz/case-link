import { describe, expect, it } from "vitest";
import { prepareFictionalPgwApplication, PGW_PREPARATION_ERROR } from "./pgw-application-preparation";
import { fictionalPgwFields } from "./pgw-application-test-fixtures";
import { PGW_APPLICATION_SOURCE } from "./pgw-application-fields";
const now = new Date("2026-11-13T21:50:00Z");
const prepare = (fields: unknown = fictionalPgwFields(), at = now) => prepareFictionalPgwApplication({ kind: "fictional_offline_rehearsal", fields }, at);
describe("PGW source-specific fictional preparation", () => {
  it("separates base form fields from every other member's required protected ID and actual personal acts", () => {
    const fields = fictionalPgwFields(), result = prepare(fields);
    expect(result.formFieldsReady).toBe(true); expect(result.protectedRequirements).toEqual([{ subjectId: fields.householdMembers![0].id,
      field: "pgw_household_identifier", sourceId: null, acceptedTypes: PGW_APPLICATION_SOURCE.identifierTypes, state: "protected_entry_unresolved" }]);
    expect(result.protectedRequirements.some(item => item.subjectId === fields.customer!.id)).toBe(false);
    expect(result.personalActs).toEqual([{ id: "customer_signature_and_responsibilities", actor: "customer", state: "not_recorded" }]);
    expect(result).toMatchObject({ incomeProof: "not_assessed", financialAssent: "not_recorded", submissionReady: false, sending: "not_attempted", enrollment: "unconfirmed" });
  });
  it("batches unknown facts and does not manufacture None, zero, customer birth date or an identifier target ID", () => {
    const result = prepare({});
    expect(result.formFieldsReady).toBe(false); expect(result.protectedRequirements).toEqual([]);
    expect(result.missingFacts).toEqual(expect.arrayContaining([{ group: "journey", fields: ["journey", "currentCrpState"] },
      { group: "customer", fields: ["customer.firstName", "customer.lastName", "customer.under18"] }, { group: "outside_support", fields: ["outsideSupport.receives"] }]));
    expect(result.fields).toEqual({}); expect(JSON.stringify(result)).not.toContain("dateOfBirth");
  });
  it("retains adult and child identifier requirements and computes age at Pennsylvania midnight", () => {
    const fields = fictionalPgwFields(); fields.householdMembers![0].dateOfBirth = "2008-11-14";
    fields.householdMembers![0].income = { state: "none", sources: [] };
    expect(prepare(fields, new Date("2026-11-14T02:00:00Z")).formFieldsReady).toBe(true);
    const adult = prepare(fields, new Date("2026-11-14T05:00:00Z"));
    expect(adult.formFieldsReady).toBe(false); expect(adult.protectedRequirements).toHaveLength(1);
    expect(adult.missingFacts[0].fields).toContain(`householdMembers.${fields.householdMembers![0].id}.income.noIncomeSituation`);
  });
  it("does not silently turn pending or conflicting account work into a new application", () => {
    const fields = fictionalPgwFields();
    expect(prepare({ ...fields, journey: "pending" }).formFieldsReady).toBe(false);
    expect(prepare({ ...fields, currentCrpState: "enrolled" }).serviceRequirements).toContain("resolve_account_journey_conflict");
    expect(prepare({ ...fields, journey: "recertification", currentCrpState: "previously_enrolled" }).formFieldsReady).toBe(false);
    expect(prepare({ ...fields, journey: "reenrollment", currentCrpState: "not_enrolled" }).formFieldsReady).toBe(false);
    const recert = prepare({ ...fields, journey: "recertification", currentCrpState: "enrolled" }); expect(recert.formFieldsReady).toBe(true);
    const returning = prepare({ ...fields, journey: "reenrollment", currentCrpState: "previously_enrolled" });
    expect(returning.formFieldsReady).toBe(true); expect(returning.serviceRequirements).toContain("verify_current_cure_reconnection_and_financial_terms");
  });
  it("requires a real household no-income period statement and living-expense answers rather than inferring it", () => {
    const fields = fictionalPgwFields(); fields.customer!.income = { state: "none", sources: [], noIncomeSituation: "Unemployed and not eligible for unemployment" }; delete fields.zeroIncomePast30Days;
    expect(prepare(fields).missingFacts).toContainEqual({ group: "household_zero_income", fields: ["zeroIncomePast30Days"] });
    fields.zeroIncomePast30Days = true; expect(prepare(fields).formFieldsReady).toBe(false);
    fields.livingExpenses = { food: "Using savings", housing: "Using savings", utilities: "Using savings" };
    expect(prepare(fields).formFieldsReady).toBe(true);
  });
  it("keeps an outside supporter's personal completion separate from household answers", () => {
    const fields = fictionalPgwFields(); fields.outsideSupport = { receives: true };
    const result = prepare(fields); expect(result.formFieldsReady).toBe(false);
    expect(result.personalActs).toContainEqual({ id: "outside_supporter_signature", actor: "outside_supporter", state: "not_recorded" });
    expect(result.missingFacts.some(item => item.group === "outside_supporter")).toBe(true);
  });
  it.each([new Date("2026-11-13T21:39:42Z"), new Date(PGW_APPLICATION_SOURCE.verifiedUntil), new Date("invalid")])("rejects expired/future/invalid source timing without echoing values", at => {
    expect(() => prepare(fictionalPgwFields(), at)).toThrow(PGW_PREPARATION_ERROR);
  });
  it("requires an explicit fictional-only entry context", () => {
    expect(() => prepareFictionalPgwApplication({ fields: fictionalPgwFields() }, now)).toThrow(PGW_PREPARATION_ERROR);
  });
});
