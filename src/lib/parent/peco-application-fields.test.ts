import { describe, expect, it } from "vitest";
import { pecoApplicationFieldsValueSchema, pecoApplicationLeaves } from "./peco-application-fields";

const id = "a1111111-1111-4111-8111-111111111111", sourceId = "b1111111-1111-4111-8111-111111111111";
describe("PECO-specific private preparation fields", () => {
  it.each([{}, { journey: "unknown", currentCapState: "unknown" }, { journey: "renewal", currentCapState: "enrolled" }, { applicant: { id } },
    { applicant: { id, income: { state: "none", sources: [] } } }, { applicant: { id, income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }] } } },
    { accountNumber: "9000000001", address: { zip: "19147", state: "PA" }, smsUpdates: false }])("keeps partial facts and continuing journeys distinct: %j", value => {
    expect(pecoApplicationFieldsValueSchema.parse(value)).toEqual(value);
  });
  it.each([{ ssn: "123-45-6789" }, { accountNumber: "123-45-6789" }, { accountNumber: "123456789" }, { accountNumber: "1234567890123456" },
    { signatures: true }, { applicant: { id, firstName: "１２３／４５／６７８９" } }, { applicant: { id, firstName: "password=private" } },
    { applicant: { id, firstName: "social\u1680security=private" } }, { applicant: { id, firstName: "😀".repeat(41) } },
    { applicant: { id, dateOfBirth: "2025-02-29" } }, { applicant: { firstName: "Missing stable ID" } }, { mother: { status: "pregnant" } },
    { householdComplete: true }, { smsUpdates: true }, { address: { state: "NJ" } },
    { applicant: { id, income: { state: "none", sources: [{ id: sourceId, kind: "employment" }] } } },
    { applicant: { id, income: { state: "sources", sources: [] } } },
    { applicant: { id }, householdMembers: [{ id: id.toUpperCase() }] },
    { applicant: { id, income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }, { id: sourceId.toUpperCase(), kind: "pension" }] } } },
  ])("rejects unrelated fields, identifiers, secret-like text and inconsistent records: %j", value => {
    expect(pecoApplicationFieldsValueSchema.safeParse(value).success).toBe(false);
  });
  it("canonicalizes stable UUIDs without treating IDs as fresh factual answers", () => {
    const value = pecoApplicationFieldsValueSchema.parse({ applicant: { id: id.toUpperCase(), firstName: "Example" }, householdMembers: [{ id: sourceId.toUpperCase() }] });
    expect(value.applicant!.id).toBe(id);
    expect(pecoApplicationLeaves(value)).toEqual({ [`applicant.${id}.firstName`]: "Example", [`householdMembers.${sourceId}`]: {} });
    expect(pecoApplicationLeaves({ applicant: { id: sourceId, firstName: "Example" } })).not.toEqual(pecoApplicationLeaves({ applicant: { id, firstName: "Example" } }));
  });
});
