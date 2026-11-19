import { z } from "zod";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE, PECO_SUBJECT_AUTHORITY_STATEMENT, PECO_ACCOUNT_AUTHORITY_STATEMENT, pecoApplicationFieldsValueSchema, pecoApplicationLeaves } from "./peco-application-fields";

export const pecoApplicationWriteSchema = z.object({
  expectedVersion: z.number().int().positive(), details: pecoApplicationFieldsValueSchema,
  noticeVersion: z.literal(PECO_APPLICATION_NOTICE_VERSION), subjectAuthorityDeclared: z.literal(true), accountAuthorityDeclared: z.literal(true),
}).strict();
export const pecoApplicationCollectionSchema = z.discriminatedUnion("collectionEnabled", [
  z.object({ collectionEnabled: z.literal(false), noticeVersion: z.null(), expiresAt: z.null() }).strict(),
  z.object({ collectionEnabled: z.literal(true), noticeVersion: z.literal(PECO_APPLICATION_NOTICE_VERSION), expiresAt: z.iso.datetime({ offset: true }) }).strict(),
]);
export const pecoApplicationSnapshotSchema = z.object({
  id: z.uuid(), request_id: z.uuid(), revision: z.number().int().positive(), base_version: z.number().int().positive(), request_version: z.number().int().positive(),
  details: pecoApplicationFieldsValueSchema,
  provenance: z.record(z.string(), z.object({ source: z.literal("parent"), confirmedAt: z.iso.datetime({ offset: true }), asOf: z.iso.date() }).strict()),
  source: z.custom<typeof PECO_APPLICATION_SOURCE>(value => !!value && typeof value === "object" &&
    Object.keys(value).length === Object.keys(PECO_APPLICATION_SOURCE).length &&
    Object.entries(PECO_APPLICATION_SOURCE).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected)),
  consent_evidence: z.object({
    subjectAuthorityDeclared: z.literal(true), subjectStatement: z.literal(PECO_SUBJECT_AUTHORITY_STATEMENT),
    accountAuthorityDeclared: z.literal(true), accountStatement: z.literal(PECO_ACCOUNT_AUTHORITY_STATEMENT), accountAuthority: z.enum(["self", "authorized_caregiver"]),
    actorId: z.uuid(), noticeVersion: z.literal(PECO_APPLICATION_NOTICE_VERSION), declaredAt: z.iso.datetime({ offset: true }),
    revision: z.number().int().positive(), detailsSha256: z.string().regex(/^[a-f0-9]{64}$/), accountNumberSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    subjects: z.array(z.string().max(60)).max(100),
  }).strict(),
  notice_version: z.literal(PECO_APPLICATION_NOTICE_VERSION), created_at: z.iso.datetime({ offset: true }), idempotency_key: z.uuid(),
}).strict().superRefine((snapshot, context) => {
  const leaves = pecoApplicationLeaves(snapshot.details);
  const subjects = [...(snapshot.details.applicant ? [`applicant.${snapshot.details.applicant.id}`] : []), ...(snapshot.details.householdMembers ?? []).map(person => `householdMembers.${person.id}`)];
  if (snapshot.request_version < snapshot.base_version || snapshot.consent_evidence.revision !== snapshot.revision ||
    (snapshot.details.accountNumber !== undefined) !== (snapshot.consent_evidence.accountNumberSha256 !== null) ||
    Date.parse(snapshot.consent_evidence.declaredAt) > Date.parse(snapshot.created_at) ||
    snapshot.consent_evidence.subjects.length !== subjects.length || subjects.some(subject => !snapshot.consent_evidence.subjects.includes(subject)) ||
    Object.keys(leaves).length !== Object.keys(snapshot.provenance).length || Object.keys(leaves).some(path => !Object.hasOwn(snapshot.provenance, path)) ||
    Object.values(snapshot.provenance).some(value => Date.parse(value.confirmedAt) > Date.parse(snapshot.created_at) || Date.parse(value.asOf) > Date.parse(value.confirmedAt)))
    context.addIssue({ code: "custom", path: ["provenance"], message: "The saved source evidence needs a service check." });
});
export type PecoApplicationSnapshot = z.infer<typeof pecoApplicationSnapshotSchema>;
