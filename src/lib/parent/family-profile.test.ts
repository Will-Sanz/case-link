import { describe, expect, it, vi } from "vitest";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileDetailsSchema, familyProfileLeaves, familyProfileReadSchema, familyProfileSnapshotSchema, familyProfileSourceSchema, familyProfileWriteSchema } from "./family-profile";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
describe("partial owned family basics", () => {
  it("accepts unanswered facts and keeps stable person/source IDs without guessing programme facts", () => {
    expect(familyProfileDetailsSchema.parse({ primaryPerson: { id: id(1) } })).toEqual({ primaryPerson: { id: id(1) } });
    const details = familyProfileDetailsSchema.parse({ primaryPerson: { id: id(1), firstName: "Pat", income: { state: "sources", sources: [{ id: id(4), kind: "employment" }, { id: id(3), kind: "pension" }] } }, members: [{ id: id(2), dateOfBirth: "2017-02-03" }] });
    expect(familyProfileLeaves(details)).toEqual({ "primaryPerson.firstName": "Pat", "primaryPerson.income": { state: "sources", sources: [{ id: id(3), kind: "pension" }, { id: id(4), kind: "employment" }] }, [`members.${id(2)}.dateOfBirth`]: "2017-02-03" });
  });
  it.each([{ pregnancy: true }, { accountNumber: "9000000001" }, { primaryPerson: { id: id(1), ssn: "000-00-0000" } }, { primaryPerson: { id: id(1), firstName: "000-00-0000" } }, { primaryPerson: { id: id(1), dateOfBirth: "2000-02-30" } }, { primaryPerson: { id: id(1), dateOfBirth: "2099-01-01" } }, { members: [{ id: id(1) }] }, { mailingAddressSameAsHome: true, mailingAddress: { zip: "19147" } }, { primaryPerson: { id: id(1), income: { state: "none", sources: [{ id: id(3), kind: "employment" }] } } }])("rejects sensitive, incompatible or contradictory profile input", addition => {
    expect(familyProfileDetailsSchema.safeParse({ primaryPerson: { id: id(1) }, ...addition }).success).toBe(false);
  });
  it("limits the household and reconfirms only exact existing paths", () => {
    expect(familyProfileDetailsSchema.safeParse({ primaryPerson: { id: id(1) }, members: Array.from({ length: 30 }, (_, n) => ({ id: id(n + 2) })) }).success).toBe(false);
    const write = { expectedOwnerId: id(8), expectedRevision: 0, details: { primaryPerson: { id: id(1), firstName: "Pat" } }, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true };
    expect(familyProfileWriteSchema.safeParse({ ...write, confirmedPaths: ["primaryPerson.firstName"] }).success).toBe(true);
    expect(familyProfileWriteSchema.safeParse({ ...write, confirmedPaths: ["primaryPerson.ssn"] }).success).toBe(false);
    expect(familyProfileSourceSchema.safeParse({ expectedOwnerId: id(8), revision: 1, fields: [{ applicationPath: "applicant.name", profilePaths: ["primaryPerson.firstName", "primaryPerson.lastName"] }] }).success).toBe(true);
    expect(familyProfileSourceSchema.safeParse({ revision: 1, fields: [{ applicationPath: "applicant.name", profilePaths: ["primaryPerson.firstName"] }] }).success).toBe(false);
    expect(familyProfileSourceSchema.safeParse({ revision: 1, fields: [{ applicationPath: "applicant.name", profilePaths: [] }] }).success).toBe(false);
  });
  it("uses the Philadelphia day and rejects invalid dates/provenance instead of refreshing them", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T01:00:00Z"));
    try {
      expect(familyProfileDetailsSchema.safeParse({ primaryPerson: { id: id(1), dateOfBirth: "2026-11-18" } }).success).toBe(false);
      expect(familyProfileDetailsSchema.safeParse({ primaryPerson: { id: id(1), dateOfBirth: "2026-11-17" } }).success).toBe(true);
      const profile = { revision: 1, details: { primaryPerson: { id: id(1), firstName: "Pat" } }, provenance: { "primaryPerson.firstName": { confirmedAt: "2026-11-17T00:00:00Z", expiresAt: "2027-01-17T00:00:00Z" } }, idempotencyKey: id(9) };
      expect(familyProfileReadSchema.safeParse({ ownerId: id(8), revision: 1, lastMutationKey: id(9), collection: { collectionEnabled: false, noticeVersion: null, expiresAt: null, retentionDays: 45 }, profile }).success).toBe(false);
      const cached = { ...profile, provenance: { "primaryPerson.firstName": { confirmedAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z" } } };
      expect(familyProfileSnapshotSchema.safeParse(cached).success).toBe(true);
      expect(familyProfileReadSchema.safeParse({ ownerId: id(8), revision: 1, lastMutationKey: id(9), collection: { collectionEnabled: false, noticeVersion: null, expiresAt: null, retentionDays: 45 }, profile: cached }).success).toBe(false);
      expect(familyProfileLeaves({ primaryPerson: { id: id(1), firstName: undefined } })).toEqual({});
    } finally { vi.useRealTimers(); }
  });
  it("requires exact snapshot/revision/key agreement for read-only recovery", () => {
    const read = { ownerId: id(8), revision: 2, lastMutationKey: id(9), collection: { collectionEnabled: false, noticeVersion: null, expiresAt: null, retentionDays: 45 }, profile: null };
    expect(familyProfileReadSchema.parse(read)).toEqual(read);
    expect(familyProfileReadSchema.safeParse({ ...read, profile: { revision: 1, details: { primaryPerson: { id: id(1) } }, provenance: {}, idempotencyKey: id(9) } }).success).toBe(false);
  });
});
