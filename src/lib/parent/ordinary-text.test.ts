import { describe, expect, it } from "vitest";
import corpus from "../../../tests/fixtures/parent/ordinary-text-cases.json";
import { snapApplicationFieldsValueSchema } from "./snap-application-fields";
import { wicApplicationFieldsValueSchema } from "./wic-application-fields";
import { pecoApplicationFieldsValueSchema } from "./peco-application-fields";
import { pgwApplicationFieldsValueSchema } from "./pgw-application-fields";
import { waterApplicationFieldsValueSchema } from "./water-application-fields";
import { familyProfileDetailsSchema } from "./family-profile";
import { isOrdinaryText } from "./ordinary-text";

const id = "12345678-1234-4234-8234-123456789012";
const schemas = [
  ["SNAP", (name: string) => snapApplicationFieldsValueSchema.safeParse({ applicant: { firstName: name } }).success],
  ["WIC", (name: string) => wicApplicationFieldsValueSchema.safeParse({ contact: { firstName: name } }).success],
  ["PECO", (name: string) => pecoApplicationFieldsValueSchema.safeParse({ applicant: { id, firstName: name } }).success],
  ["PGW", (name: string) => pgwApplicationFieldsValueSchema.safeParse({ customer: { id, firstName: name } }).success],
  ["water", (name: string) => waterApplicationFieldsValueSchema.safeParse({ applicant: { id, name } }).success],
  ["family profile", (name: string) => familyProfileDetailsSchema.safeParse({ primaryPerson: { id, firstName: name } }).success],
] as const;

describe("ordinary private text stays outside protected identifier entry", () => {
  it.each(schemas)("rejects the audited passport disclosure in %s", (_program, accepts) => {
    expect(accepts(corpus.rejected[0])).toBe(false);
  });
  it.each(corpus.rejected)("rejects protected text %j in every ordinary field", value => {
    expect(isOrdinaryText(value)).toBe(false);
    expect(isOrdinaryText(value, true)).toBe(false);
    for (const [, accepts] of schemas) expect(accepts(value)).toBe(false);
  });
  it.each(corpus.accepted)("keeps legitimate text %j", value => {
    expect(isOrdinaryText(value)).toBe(true);
    for (const [, accepts] of schemas) expect(accepts(value)).toBe(true);
  });
  it.each(corpus.snapPhones)("preserves supported SNAP phone %j", value => {
    expect(isOrdinaryText(value, true)).toBe(true);
    expect(snapApplicationFieldsValueSchema.safeParse({ phone: value, otherPhone: value, authorizedRepresentative: { phone: value } }).success).toBe(true);
  });
  it("retains individual field limits and dedicated utility account fields", () => {
    expect(wicApplicationFieldsValueSchema.safeParse({ contact: { firstName: "x".repeat(51) } }).success).toBe(false);
    expect(pecoApplicationFieldsValueSchema.safeParse({ applicant: { id, firstName: "x".repeat(81) } }).success).toBe(false);
    expect(pecoApplicationFieldsValueSchema.safeParse({ accountNumber: "9000000001" }).success).toBe(true);
    expect(pgwApplicationFieldsValueSchema.safeParse({ accountNumber: "1234567890123456789" }).success).toBe(true);
    expect(pgwApplicationFieldsValueSchema.safeParse({ accountNumber: "passport:FICTIONAL" }).success).toBe(false);
  });
});
