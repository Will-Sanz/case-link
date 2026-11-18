import { z } from "zod";
import { PGW_APPLICATION_NOTICE_VERSION, PGW_APPLICATION_SOURCE, PGW_SUBJECT_AUTHORITY_STATEMENT, PGW_ACCOUNT_AUTHORITY_STATEMENT, pgwApplicationFieldsValueSchema, pgwApplicationLeaves } from "./pgw-application-fields";

export const pgwApplicationWriteSchema = z.object({
  expectedVersion: z.number().int().positive(), details: pgwApplicationFieldsValueSchema,
  noticeVersion: z.literal(PGW_APPLICATION_NOTICE_VERSION), subjectAuthorityDeclared: z.literal(true), accountAuthorityDeclared: z.literal(true),
}).strict();
export const pgwApplicationCollectionSchema = z.discriminatedUnion("collectionEnabled", [
  z.object({ collectionEnabled: z.literal(false), noticeVersion: z.null(), expiresAt: z.null() }).strict(),
  z.object({ collectionEnabled: z.literal(true), noticeVersion: z.literal(PGW_APPLICATION_NOTICE_VERSION), expiresAt: z.iso.datetime({ offset: true }) }).strict(),
]);
export const pgwApplicationSnapshotSchema = z.object({
  id: z.uuid(), request_id: z.uuid(), revision: z.number().int().positive(), base_version: z.number().int().positive(), request_version: z.number().int().positive(),
  details: pgwApplicationFieldsValueSchema,
  provenance: z.record(z.string(), z.object({ source: z.literal("parent"), confirmedAt: z.iso.datetime({ offset: true }), asOf: z.iso.date() }).strict()),
  source: z.custom<typeof PGW_APPLICATION_SOURCE>(value => !!value && typeof value === "object" &&
    Object.keys(value).length === Object.keys(PGW_APPLICATION_SOURCE).length &&
    Object.entries(PGW_APPLICATION_SOURCE).every(([key, expected]) => JSON.stringify((value as Record<string, unknown>)[key]) === JSON.stringify(expected))),
  consent_evidence: z.object({
    subjectAuthorityDeclared: z.literal(true), subjectStatement: z.literal(PGW_SUBJECT_AUTHORITY_STATEMENT),
    accountAuthorityDeclared: z.literal(true), accountStatement: z.literal(PGW_ACCOUNT_AUTHORITY_STATEMENT), accountAuthority: z.enum(["self", "authorized_caregiver"]),
    actorId: z.uuid(), noticeVersion: z.literal(PGW_APPLICATION_NOTICE_VERSION), declaredAt: z.iso.datetime({ offset: true }),
    revision: z.number().int().positive(), detailsSha256: z.string().regex(/^[a-f0-9]{64}$/), accountNumberSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    subjects: z.array(z.string().max(80)).max(101),
  }).strict(),
  notice_version: z.literal(PGW_APPLICATION_NOTICE_VERSION), created_at: z.iso.datetime({ offset: true }), idempotency_key: z.uuid(),
}).strict().superRefine((snapshot, context) => {
  const leaves = pgwApplicationLeaves(snapshot.details);
  const subjects = [...(snapshot.details.customer ? [`customer.${snapshot.details.customer.id}`] : []), ...(snapshot.details.householdMembers ?? []).map(person => `householdMembers.${person.id}`), ...(snapshot.details.outsideSupport?.supporter ? [`outsideSupport.supporter.${snapshot.details.outsideSupport.supporter.id}`] : [])];
  if (snapshot.request_version < snapshot.base_version || snapshot.consent_evidence.revision !== snapshot.revision ||
    (snapshot.details.accountNumber !== undefined) !== (snapshot.consent_evidence.accountNumberSha256 !== null) ||
    Date.parse(snapshot.consent_evidence.declaredAt) > Date.parse(snapshot.created_at) ||
    snapshot.consent_evidence.subjects.length !== subjects.length || subjects.some(subject => !snapshot.consent_evidence.subjects.includes(subject)) ||
    Object.keys(leaves).length !== Object.keys(snapshot.provenance).length || Object.keys(leaves).some(path => !Object.hasOwn(snapshot.provenance, path)) ||
    Object.values(snapshot.provenance).some(value => Date.parse(value.confirmedAt) > Date.parse(snapshot.created_at) || Date.parse(value.asOf) > Date.parse(value.confirmedAt)))
    context.addIssue({ code: "custom", path: ["provenance"], message: "The saved source evidence needs a service check." });
});
export type PgwApplicationSnapshot = z.infer<typeof pgwApplicationSnapshotSchema>;
