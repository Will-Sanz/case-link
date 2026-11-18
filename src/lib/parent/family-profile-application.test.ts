import { describe, expect, it } from "vitest";
import { familyProfileDetailsSchema, familyProfileLeaves, type FamilyProfileSnapshot } from "./family-profile";
import { pgwApplicationFieldsValueSchema } from "./pgw-application-fields";
import { wicApplicationFieldsValueSchema } from "./wic-application-fields";
import { familyProfileApplicationValue, matchingFamilyProfileFields, mergeFamilyProfileApplicationProjection, projectFamilyProfileApplication, replaceFamilyProfileApplicationValue } from "./family-profile-application";

const now = new Date("2026-11-17T18:00:00Z"), primaryId = "11111111-1111-4111-8111-111111111111", childId = "22222222-2222-4222-8222-222222222222", adultId = "33333333-3333-4333-8333-333333333333", sourceId = "44444444-4444-4444-8444-444444444444";
function fixture() {
  const details = familyProfileDetailsSchema.parse({
    primaryPerson: { id: primaryId, firstName: "Fictional", middleInitial: "Q", lastName: "Rivera", dateOfBirth: "1990-01-01", income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }] } },
    members: [{ id: childId, firstName: "Child", lastName: "Rivera", dateOfBirth: "2023-01-01", relationship: "Child", income: { state: "none", sources: [] } },
      { id: adultId, firstName: "Other", lastName: "Adult", dateOfBirth: "1990-02-01", relationship: "Sibling", income: { state: "unknown", sources: [] } }],
    contact: { phone: "215-555-0101", email: "fictional@example.invalid" },
    homeAddress: { street: "123 Synthetic Lane", apartment: "Unit 2", city: "Philadelphia", state: "PA", zip: "19104", county: "Philadelphia" },
    mailingAddress: { street: "456 Synthetic Avenue", city: "Philadelphia", state: "PA", zip: "19103", county: "Philadelphia" }, preferredLanguage: "es",
  });
  return { revision: 4, idempotencyKey: "55555555-5555-4555-8555-555555555555", details,
    provenance: Object.fromEntries(Object.keys(familyProfileLeaves(details)).map(path => [path, { confirmedAt: "2026-11-16T18:00:00Z", expiresAt: "2026-12-01T18:00:00Z" }])) } satisfies FamilyProfileSnapshot;
}
function project(program: Parameters<typeof projectFamilyProfileApplication>[1], extra: Partial<Parameters<typeof projectFamilyProfileApplication>[2]> = {}, profile = fixture()) {
  return projectFamilyProfileApplication(profile, program, { now, ...extra });
}

it("replaces or removes only the selected stable-ID leaf while preserving manual answers", () => {
  const value = { applicant: { id: primaryId, firstName: "Old", manualChoice: true }, children: [{ id: childId, firstName: "Child" }, { id: adultId, firstName: "Other" }], zip: "19104" };
  replaceFamilyProfileApplicationValue(value, `applicant.${primaryId}.firstName`, "Fresh");
  replaceFamilyProfileApplicationValue(value, `children.${adultId}.firstName`, undefined);
  replaceFamilyProfileApplicationValue(value, "zip", "19147");
  expect(value).toEqual({ applicant: { id: primaryId, firstName: "Fresh", manualChoice: true }, children: [{ id: childId, firstName: "Child" }, { id: adultId }], zip: "19147" });
});

describe("shared family facts projected into exact application fields", () => {
  it("keeps original bound utility values when a later projection omits an expired fact", () => {
    const profile = fixture();
    const original = project("pgw-crp", { accountAuthority: "self" }, profile);
    profile.provenance["primaryPerson.income"].expiresAt = now.toISOString();
    const later = project("pgw-crp", { accountAuthority: "self", useHomeAddress: true }, profile);
    const merged = mergeFamilyProfileApplicationProjection(original, later);
    const draft = pgwApplicationFieldsValueSchema.parse({ ...original.details, address: pgwApplicationFieldsValueSchema.parse(later.details).address });
    expect(matchingFamilyProfileFields(draft, merged)).toContainEqual({ applicationPath: `customer.${primaryId}.income`, profilePaths: ["primaryPerson.income"] });
    expect(matchingFamilyProfileFields({ ...draft, customer: { ...draft.customer!, income: { state: "none", sources: [] } } }, merged).some(field => field.applicationPath === `customer.${primaryId}.income`)).toBe(false);
  });
  it("preserves existing WIC child bindings when another saved child is added", () => {
    const profile = fixture();
    const original = project("wic-pa", { wicBeneficiaries: "children", wicChildIds: [childId] }, profile);
    profile.provenance[`members.${childId}.dateOfBirth`].expiresAt = now.toISOString();
    const later = project("wic-pa", { wicBeneficiaries: "children", wicChildIds: [childId, adultId] }, profile);
    const merged = mergeFamilyProfileApplicationProjection(original, later);
    const draft = wicApplicationFieldsValueSchema.parse({ ...original.details, children: [...wicApplicationFieldsValueSchema.parse(original.details).children!, ...wicApplicationFieldsValueSchema.parse(later.details).children!.filter(child => child.id === adultId)] });
    expect(matchingFamilyProfileFields(draft, merged)).toContainEqual({ applicationPath: `children.${childId}.dateOfBirth`, profilePaths: [`members.${childId}.dateOfBirth`] });
  });
  it("reuses SNAP names, dates, home address, contact and language with stable people, leaving application-only answers unresolved", () => {
    const result = project("snap-pa");
    expect(result.details).toMatchObject({ applicant: { firstName: "Fictional", lastName: "Rivera", middleInitial: "Q" },
      address: { street: "123 Synthetic Lane, Unit 2", city: "Philadelphia", state: "PA" }, zip: "19104", county: "Philadelphia", phone: "215-555-0101", language: "es",
      household: [{ id: primaryId, relationship: "SELF", dateOfBirth: "1990-01-01" }, { id: childId, relationship: "Child" }, { id: adultId, relationship: "Sibling" }] });
    expect(result.details).not.toHaveProperty("income"); expect(result.details).not.toHaveProperty("householdSize");
    for (const row of (result.details as { household: Record<string, unknown>[] }).household) for (const field of ["requestingSnap", "citizen", "student", "sex"]) expect(row).not.toHaveProperty(field);
    expect(result.fields.find(field => field.applicationPath === "address.street")?.profilePaths).toEqual(["homeAddress.street", "homeAddress.apartment"]);
    expect(result.fields.find(field => field.applicationPath === `household.${childId}.dateOfBirth`)?.profilePaths).toEqual([`members.${childId}.dateOfBirth`]);
  });
  it.each(["peco-cap", "pgw-crp", "pwd-tap"] as const)("does not infer the %s account holder or service address", program => {
    const result = project(program);
    expect(result.details).not.toHaveProperty("applicant"); expect(result.details).not.toHaveProperty("customer"); expect(result.details).not.toHaveProperty("householdMembers");
    expect(result.details).not.toHaveProperty("address"); expect(result.details).not.toHaveProperty("propertyAddress");
    expect(result.details).not.toHaveProperty("accountNumber"); expect(result.details).not.toHaveProperty("householdComplete");
  });
  it("reuses self-account PECO people and exact supported income inventories without choosing a phone subtype or collecting minor income", () => {
    const result = project("peco-cap", { accountAuthority: "self" });
    expect(result.details).toMatchObject({ applicant: { id: primaryId, income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }] } },
      householdMembers: [{ id: childId, firstName: "Child" }, { id: adultId, income: { state: "unknown", sources: [] } }] });
    expect((result.details as { householdMembers: Record<string, unknown>[] }).householdMembers[0]).not.toHaveProperty("income");
    expect(result.details).not.toHaveProperty("homePhone"); expect(result.details).not.toHaveProperty("cellPhone");
    expect(project("peco-cap", { accountAuthority: "self", pecoPhoneType: "cell" }).details).toHaveProperty("cellPhone", "215-555-0101");
  });
  it("keeps PGW customer birth date blank while copying non-customer dates and exact member income source identities", () => {
    const result = project("pgw-crp", { accountAuthority: "self" });
    expect(result.details).toMatchObject({ customer: { id: primaryId, firstName: "Fictional" }, householdMembers: [{ id: childId, dateOfBirth: "2023-01-01", income: { state: "none", sources: [] } }, { id: adultId }] });
    expect((result.details as { customer: unknown }).customer).not.toHaveProperty("dateOfBirth");
    expect((result.details as { customer: unknown }).customer).not.toHaveProperty("under18");
  });
  it("uses an explicitly chosen caregiver account person without inferring relationship to that person or their contact phone", () => {
    const result = project("pwd-tap", { accountAuthority: "authorized_caregiver", accountPersonId: adultId });
    expect(result.details).toMatchObject({ applicant: { id: adultId, name: "Other Adult" }, householdMembers: [{ id: primaryId, name: "Fictional Rivera" }, { id: childId, name: "Child Rivera" }] });
    expect(result.details).not.toHaveProperty("phone");
    for (const member of (result.details as { householdMembers: unknown[] }).householdMembers) expect(member).not.toHaveProperty("relationship");
  });
  it("requires a meaningful service-address choice and records every formatted water source without truncating values", () => {
    const result = project("pwd-tap", { accountAuthority: "self", useHomeAddress: true });
    expect(result.details).toMatchObject({ applicant: { name: "Fictional Rivera" }, propertyAddress: "123 Synthetic Lane, Unit 2, Philadelphia, PA, 19104", mailingAddress: "456 Synthetic Avenue, Philadelphia, PA, 19103" });
    expect(result.fields.find(field => field.applicationPath === `applicant.${primaryId}.name`)?.profilePaths).toEqual(["primaryPerson.firstName", "primaryPerson.lastName"]);
    expect(result.fields.find(field => field.applicationPath === "propertyAddress")?.profilePaths).toEqual(["homeAddress.street", "homeAddress.apartment", "homeAddress.city", "homeAddress.state", "homeAddress.zip"]);
    const profile = fixture(); profile.details.homeAddress!.street = "A".repeat(160); profile.details.homeAddress!.apartment = "B".repeat(80);
    expect(project("pwd-tap", { useHomeAddress: true }, profile).details).not.toHaveProperty("propertyAddress");
    expect(project("pgw-crp", { useHomeAddress: true }, profile).details).not.toHaveProperty("address.street");
  });
  it("fills WIC contact only, using the explicit mailing address and no assumed mother or beneficiaries", () => {
    const result = project("wic-pa");
    expect(result.details).toEqual({ contact: { firstName: "Fictional", lastName: "Rivera", dateOfBirth: "1990-01-01", phone: "215-555-0101", email: "fictional@example.invalid", street: "456 Synthetic Avenue", city: "Philadelphia", zip: "19103", county: "Philadelphia" } });
    for (const key of ["mother", "children", "beneficiaries", "applicationType", "appointmentPreference"]) expect(result.details).not.toHaveProperty(key);
    const profile = fixture(); delete profile.details.mailingAddress;
    for (const path of Object.keys(profile.provenance)) if (path.startsWith("mailingAddress.")) delete profile.provenance[path];
    expect(project("wic-pa", {}, profile).details).not.toHaveProperty("contact.street");
  });
  it("copies only explicitly selected WIC child records after the beneficiary branch was chosen", () => {
    expect(project("wic-pa", { wicChildIds: [childId] }).details).not.toHaveProperty("children");
    const result = project("wic-pa", { wicBeneficiaries: "children", wicChildIds: [childId, "99999999-9999-4999-8999-999999999999"] });
    expect(result.details).toMatchObject({ beneficiaries: "children", children: [{ id: childId, firstName: "Child", lastName: "Rivera", dateOfBirth: "2023-01-01" }] });
    expect((result.details as { children: unknown[] }).children).toHaveLength(1);
    expect(result.details).not.toHaveProperty("mother");
  });
  it("uses the home address as postal only with the fresh explicit same-address answer", () => {
    const profile = fixture(); delete profile.details.mailingAddress;
    for (const path of Object.keys(profile.provenance)) if (path.startsWith("mailingAddress.")) delete profile.provenance[path]; profile.details.mailingAddressSameAsHome = true;
    profile.provenance.mailingAddressSameAsHome = { confirmedAt: "2026-11-16T18:00:00Z", expiresAt: "2026-12-01T18:00:00Z" };
    expect(project("wic-pa", {}, profile).details).toHaveProperty("contact.street", "123 Synthetic Lane, Unit 2");
    profile.provenance.mailingAddressSameAsHome.expiresAt = now.toISOString();
    expect(project("wic-pa", {}, profile).details).not.toHaveProperty("contact.street");
  });
  it("does not refresh or reuse an expired, future-confirmed or partially stale compound field", () => {
    const profile = fixture(), before = structuredClone(profile);
    profile.provenance["primaryPerson.firstName"].expiresAt = now.toISOString();
    profile.provenance["contact.phone"].confirmedAt = "2026-11-18T18:00:00Z";
    profile.provenance["contact.phone"].expiresAt = "2026-12-01T18:00:00Z";
    const result = project("pwd-tap", { accountAuthority: "self" }, profile);
    expect(result.details).not.toHaveProperty("applicant.name"); expect(result.details).not.toHaveProperty("phone");
    expect(result.details).toHaveProperty("applicant.dateOfBirth", "1990-01-01");
    expect(profile.provenance["primaryPerson.dateOfBirth"]).toEqual(before.provenance["primaryPerson.dateOfBirth"]);
    for (const value of Object.values(profile.provenance)) { value.confirmedAt = "2026-11-16T18:00:00Z"; value.expiresAt = now.toISOString(); }
    expect(project("snap-pa", {}, profile)).toEqual({ details: {}, fields: [] });
  });
  it("leaves incompatible income types unanswered rather than guessing a program category or zero amount", () => {
    const profile = fixture(); profile.details.primaryPerson.income!.sources[0].kind = "foster_care";
    const peco = project("peco-cap", { accountAuthority: "self" }, profile);
    expect(peco.details).not.toHaveProperty("applicant.income"); expect(peco.details).not.toHaveProperty("incomeAmount");
    expect(project("pgw-crp", { accountAuthority: "self" }, profile).details).toHaveProperty("customer.income.sources.0.kind", "foster_care");
    expect(project("pwd-tap", { accountAuthority: "self" }, profile).details).not.toHaveProperty("applicant.income");
  });
  it("uses the Eastern birthday before copying a PECO adult member's income inventory", () => {
    const profile = fixture(); profile.details.members![1].dateOfBirth = "2008-11-18";
    const before = projectFamilyProfileApplication(profile, "peco-cap", { accountAuthority: "self", now: new Date("2026-11-18T00:30:00Z") });
    expect((before.details as { householdMembers: { id: string; income?: unknown }[] }).householdMembers.find(person => person.id === adultId)).not.toHaveProperty("income");
    const after = projectFamilyProfileApplication(profile, "peco-cap", { accountAuthority: "self", now: new Date("2026-11-18T05:00:00Z") });
    expect((after.details as { householdMembers: { id: string; income?: unknown }[] }).householdMembers.find(person => person.id === adultId)).toHaveProperty("income.state", "unknown");
  });
  it("preserves inventory provenance when source rows are reordered and drops it when a source kind changes", () => {
    const profile = fixture(); profile.details.primaryPerson.income!.sources.push({ id: "66666666-6666-4666-8666-666666666666", kind: "pension" });
    const projection = project("pgw-crp", { accountAuthority: "self" }, profile), details = pgwApplicationFieldsValueSchema.parse(structuredClone(projection.details));
    details.customer!.income!.sources.reverse(); const path = `customer.${primaryId}.income`;
    expect(matchingFamilyProfileFields(details, projection).some(field => field.applicationPath === path)).toBe(true);
    details.customer!.income!.sources[0].kind = "employment";
    expect(matchingFamilyProfileFields(details, projection).some(field => field.applicationPath === path)).toBe(false);
  });
  it("keeps the shared PGW no-income inventory date when a distinct programme explanation is added", () => {
    const profile = fixture(); profile.details.primaryPerson.income = { state: "none", sources: [] };
    const projection = project("pgw-crp", { accountAuthority: "self" }, profile), details = pgwApplicationFieldsValueSchema.parse(structuredClone(projection.details));
    details.customer!.income!.noIncomeSituation = "Prior savings cover current bills";
    const fields = matchingFamilyProfileFields(details, projection);
    expect(fields).toContainEqual({ applicationPath: `customer.${primaryId}.income`, profilePaths: ["primaryPerson.income"] });
    expect(fields.some(field => field.applicationPath.endsWith("noIncomeSituation"))).toBe(false);
  });
  it("keeps bindings only for unchanged actual application values, including stable row IDs after reordering", () => {
    const projection = project("snap-pa"), details = structuredClone(projection.details);
    (details as { applicant: { firstName: string } }).applicant.firstName = "Corrected";
    (details as { household: unknown[] }).household.reverse();
    const fields = matchingFamilyProfileFields(details, projection);
    expect(fields.some(field => field.applicationPath === "applicant.firstName")).toBe(false);
    expect(fields.some(field => field.applicationPath === `household.${childId}.dateOfBirth`)).toBe(true);
    expect(familyProfileApplicationValue(details, `household.${childId}.firstName`)).toBe("Child");
    expect(familyProfileApplicationValue(details, "household.unknown.firstName")).toBeUndefined();
    (details as { household: { id: string }[] }).household = (details as { household: { id: string }[] }).household.filter(person => person.id !== childId);
    expect(matchingFamilyProfileFields(details, { ...projection, details }).some(field => field.applicationPath.startsWith(`household.${childId}.`))).toBe(false);
  });
});
