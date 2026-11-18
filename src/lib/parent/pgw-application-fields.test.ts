import { describe, expect, it } from "vitest";
import { pgwApplicationFieldsValueSchema, pgwApplicationLeaves } from "./pgw-application-fields";
import { fictionalPgwFields } from "./pgw-application-test-fixtures";
describe("PGW non-identifier application fields", () => {
  it("accepts a partial draft without defaulting a journey, household or amount", () => {
    expect(pgwApplicationFieldsValueSchema.parse({})).toEqual({});
    expect(pgwApplicationFieldsValueSchema.parse(fictionalPgwFields())).toEqual(fictionalPgwFields());
  });
  it.each(["ssn", "idNumber", "passport", "studentId", "driversLicense", "signature", "dateOfBirth"])("never adds optional customer %s to private JSON", key => {
    const value = fictionalPgwFields();
    expect(pgwApplicationFieldsValueSchema.safeParse({ ...value, customer: { ...value.customer, [key]: "123456789" } }).success).toBe(false);
  });
  it.each(["idNumber", "identificationType", "passport", "ssn", "signature", "inputId"])("keeps member %s outside application JSON", key => {
    const value = fictionalPgwFields();
    expect(pgwApplicationFieldsValueSchema.safeParse({ ...value, householdMembers: [{ ...value.householdMembers![0], [key]: "private" }] }).success).toBe(false);
  });
  it.each(["123-45-6789", "１２３－４５－６７８９", "passport: private", "passport number: private", "drivers license number: private", "student ID: private", "student ID number: private", "signature: private", "Name\nControl", "<name>"])("rejects identifier/credential/control text without adding fields (%s)", firstName => {
    const value = fictionalPgwFields(); expect(pgwApplicationFieldsValueSchema.safeParse({ ...value, customer: { ...value.customer, firstName } }).success).toBe(false);
  });
  it("preserves explicit assistance zero and refuses an amount without the actual receives answer", () => {
    expect(pgwApplicationFieldsValueSchema.safeParse({ snap: { receives: true, monthlyAmountCents: 0 } }).success).toBe(true);
    expect(pgwApplicationFieldsValueSchema.safeParse({ snap: { monthlyAmountCents: 30000 } }).success).toBe(false);
    expect(pgwApplicationFieldsValueSchema.safeParse({ housingSubsidy: { receives: false, monthlyAmountCents: 1 } }).success).toBe(false);
  });
  it("does not impose an invented account mask", () => {
    for (const accountNumber of ["9000000002", "FICT-PGW 02", "FICT/PGW.02"]) expect(pgwApplicationFieldsValueSchema.parse({ accountNumber }).accountNumber).toBe(accountNumber);
  });
  it("rejects duplicate people/sources and conflicting or inferred zero-income statements", () => {
    const value = fictionalPgwFields();
    expect(pgwApplicationFieldsValueSchema.safeParse({ ...value, householdMembers: [{ ...value.householdMembers![0], id: value.customer!.id }] }).success).toBe(false);
    expect(pgwApplicationFieldsValueSchema.safeParse({ ...value, customer: { ...value.customer, income: { state: "sources", sources: [value.customer!.income!.sources[0], value.customer!.income!.sources[0]] } } }).success).toBe(false);
    expect(pgwApplicationFieldsValueSchema.safeParse({ ...value, zeroIncomePast30Days: true }).success).toBe(false);
    expect(pgwApplicationFieldsValueSchema.safeParse({ livingExpenses: { food: "Unknown" } }).success).toBe(false);
  });
  it("uses stable person/source paths without renewing unchanged leaves on row order", () => {
    const value = fictionalPgwFields(), leaves = pgwApplicationLeaves(value);
    expect(leaves[`customer.${value.customer!.id}.income.sources.${value.customer!.income!.sources[0].id}.kind`]).toBe("employment");
    expect(leaves[`householdMembers.${value.householdMembers![0].id}.dateOfBirth`]).toBe("2020-01-01");
    expect(Object.keys(leaves)).not.toContain("customer.id");
  });
});
