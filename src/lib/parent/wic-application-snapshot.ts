import { z } from "zod";
import { WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "./constants";
import { WIC_APPLICATION_SOURCE, wicApplicationFieldsValueSchema, wicApplicationLeaves } from "./wic-application-fields";

export const wicApplicationWriteSchema = z.object({
  expectedVersion: z.number().int().positive(), details: wicApplicationFieldsValueSchema,
  noticeVersion: z.literal(WIC_APPLICATION_NOTICE_VERSION),
  subjectAuthorityDeclared: z.literal(true),
}).strict();
export const wicApplicationSnapshotSchema = z.object({
  id: z.uuid(), request_id: z.uuid(), revision: z.number().int().positive(), base_version: z.number().int().positive(), request_version: z.number().int().positive(),
  details: wicApplicationFieldsValueSchema,
  provenance: z.record(z.string(), z.object({ source: z.literal("parent"), confirmedAt: z.iso.datetime({ offset: true }), asOf: z.iso.date() }).strict()),
  source: z.custom<typeof WIC_APPLICATION_SOURCE>(value => !!value && typeof value === "object" &&
    Object.keys(value).length === Object.keys(WIC_APPLICATION_SOURCE).length &&
    Object.entries(WIC_APPLICATION_SOURCE).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected)),
  consent_evidence: z.object({
    subjectAuthorityDeclared: z.literal(true), statement: z.literal(WIC_SUBJECT_AUTHORITY_STATEMENT), actorId: z.uuid(),
    noticeVersion: z.literal(WIC_APPLICATION_NOTICE_VERSION), declaredAt: z.iso.datetime({ offset: true }),
    revision: z.number().int().positive(), detailsSha256: z.string().regex(/^[a-f0-9]{64}$/), subjects: z.array(z.string().max(50)).max(32),
  }).strict(),
  notice_version: z.literal(WIC_APPLICATION_NOTICE_VERSION), created_at: z.iso.datetime({ offset: true }), idempotency_key: z.uuid(),
}).strict().superRefine((snapshot, context) => {
  const leaves = wicApplicationLeaves(snapshot.details);
  if (snapshot.request_version < snapshot.base_version || snapshot.consent_evidence.revision !== snapshot.revision ||
    Date.parse(snapshot.consent_evidence.declaredAt) > Date.parse(snapshot.created_at) ||
    Object.keys(leaves).length !== Object.keys(snapshot.provenance).length ||
    Object.keys(leaves).some(path => !Object.hasOwn(snapshot.provenance, path)) ||
    Object.values(snapshot.provenance).some(value => Date.parse(value.confirmedAt) > Date.parse(snapshot.created_at) || Date.parse(value.asOf) > Date.parse(value.confirmedAt)))
    context.addIssue({ code: "custom", path: ["provenance"], message: "The saved source evidence needs a service check." });
});
export type WicApplicationSnapshot = z.infer<typeof wicApplicationSnapshotSchema>;
