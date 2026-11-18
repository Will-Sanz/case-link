import { z } from "zod";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_APPLICATION_REFERENCE, WATER_SUBJECT_AUTHORITY_STATEMENT, WATER_ACCOUNT_AUTHORITY_STATEMENT, waterApplicationFieldsValueSchema, waterApplicationLeaves } from "./water-application-fields";

export const waterApplicationWriteSchema = z.object({
  expectedVersion: z.number().int().positive(), details: waterApplicationFieldsValueSchema,
  noticeVersion: z.literal(WATER_APPLICATION_NOTICE_VERSION), subjectAuthorityDeclared: z.literal(true), accountAuthorityDeclared: z.literal(true),
}).strict();
export const waterApplicationCollectionSchema = z.discriminatedUnion("collectionEnabled", [
  z.object({ collectionEnabled: z.literal(false), noticeVersion: z.null(), expiresAt: z.null() }).strict(),
  z.object({ collectionEnabled: z.literal(true), noticeVersion: z.literal(WATER_APPLICATION_NOTICE_VERSION), expiresAt: z.iso.datetime({ offset: true }) }).strict(),
]);
export const waterApplicationSnapshotSchema = z.object({
  id: z.uuid(), request_id: z.uuid(), revision: z.number().int().positive(), base_version: z.number().int().positive(), request_version: z.number().int().positive(),
  details: waterApplicationFieldsValueSchema,
  provenance: z.record(z.string(), z.object({ source: z.literal("parent"), confirmedAt: z.iso.datetime({ offset: true }), asOf: z.iso.date() }).strict()),
  source: z.custom<typeof WATER_APPLICATION_REFERENCE>(value => !!value && typeof value === "object" &&
    Object.keys(value).length === Object.keys(WATER_APPLICATION_REFERENCE).length &&
    Object.entries(WATER_APPLICATION_REFERENCE).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected)),
  consent_evidence: z.object({
    subjectAuthorityDeclared: z.literal(true), subjectStatement: z.literal(WATER_SUBJECT_AUTHORITY_STATEMENT),
    accountAuthorityDeclared: z.literal(true), accountStatement: z.literal(WATER_ACCOUNT_AUTHORITY_STATEMENT), accountAuthority: z.enum(["self", "authorized_caregiver"]),
    actorId: z.uuid(), noticeVersion: z.literal(WATER_APPLICATION_NOTICE_VERSION), declaredAt: z.iso.datetime({ offset: true }),
    revision: z.number().int().positive(), detailsSha256: z.string().regex(/^[a-f0-9]{64}$/), subjects: z.array(z.string().max(70)).max(130),
  }).strict(),
  notice_version: z.literal(WATER_APPLICATION_NOTICE_VERSION), created_at: z.iso.datetime({ offset: true }), idempotency_key: z.uuid(),
}).strict().superRefine((snapshot, context) => {
  const leaves = waterApplicationLeaves(snapshot.details);
  const subjects = [...(snapshot.details.applicant ? [`applicant.${snapshot.details.applicant.id}`] : []),
    ...(snapshot.details.householdMembers ?? []).map(person => `householdMembers.${person.id}`), ...(snapshot.details.outsideSupporters ?? []).map(person => `outsideSupporters.${person.id}`)];
  if (snapshot.request_version < snapshot.base_version || snapshot.consent_evidence.revision !== snapshot.revision ||
    Date.parse(snapshot.consent_evidence.declaredAt) > Date.parse(snapshot.created_at) || snapshot.consent_evidence.subjects.length !== subjects.length ||
    subjects.some(subject => !snapshot.consent_evidence.subjects.includes(subject)) || Object.keys(leaves).length !== Object.keys(snapshot.provenance).length ||
    Object.keys(leaves).some(path => !Object.hasOwn(snapshot.provenance, path)) ||
    Object.values(snapshot.provenance).some(value => Date.parse(value.confirmedAt) > Date.parse(snapshot.created_at) || Date.parse(value.asOf) > Date.parse(value.confirmedAt)))
    context.addIssue({ code: "custom", path: ["provenance"], message: "The saved source evidence needs a service check." });
});
export type WaterApplicationSnapshot = z.infer<typeof waterApplicationSnapshotSchema>;
