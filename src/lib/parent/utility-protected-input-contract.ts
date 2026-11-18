import { z } from "zod";

export const UTILITY_PROTECTED_INPUT_FORMAT = "caselink-utility-protected-input-v1";
export const UTILITY_PROTECTED_INPUT_NOTICE_VERSION = "utility-protected-input-2026-11-13.v1";
export const MAX_UTILITY_PROTECTED_INPUT_BYTES = 10 * 1024 * 1024;
const uuid = z.uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const version = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);

export const utilityProtectedProgramSchema = z.enum(["peco-cap", "pgw-crp", "pwd-tap"]);
export const utilityProtectedPurposeSchema = z.enum([
  "income_proof", "residency_proof", "required_identifier", "account_access", "application_recovery",
]);
export const utilityProtectedTargetSchema = z.object({
  subjectId: uuid,
  sourceId: uuid.nullable(),
  field: z.enum(["income", "residency", "pgw_household_identifier", "water_access_code", "water_application_recovery"]),
}).strict();
const targets = z.array(utilityProtectedTargetSchema).min(1).max(120).superRefine((value, context) => {
  if (new Set(value.map(target => `${target.subjectId}:${target.sourceId ?? "-"}:${target.field}`)).size !== value.length)
    context.addIssue({ code: "custom", message: "Each protected target must be distinct." });
});
function checkPurpose(value: { programId: string; purpose: string; targets: UtilityProtectedTarget[]; mediaType: string; byteLength: number; replacesInputId?: string; inputId?: string }, context: z.RefinementCtx) {
  const fields: Record<string, string> = { income_proof: "income", residency_proof: "residency", required_identifier: "pgw_household_identifier",
    account_access: "water_access_code", application_recovery: "water_application_recovery" };
  const field = fields[value.purpose];
  const scalar = ["required_identifier", "account_access", "application_recovery"].includes(value.purpose);
  if (!field || value.targets.some(target => target.field !== field || field !== "income" && target.sourceId !== null) ||
    (scalar ? value.mediaType !== "application/octet-stream" || value.byteLength > 1024 || value.targets.length !== 1
      : value.mediaType === "application/octet-stream" || value.byteLength < 12) ||
    value.programId === "peco-cap" && value.purpose !== "income_proof" ||
    value.programId === "pgw-crp" && !["income_proof", "required_identifier"].includes(value.purpose) ||
    value.purpose === "required_identifier" && value.programId !== "pgw-crp" ||
    ["account_access", "application_recovery"].includes(value.purpose) && value.programId !== "pwd-tap" ||
    value.replacesInputId !== undefined && (value.programId !== "pgw-crp" || value.purpose !== "required_identifier" || value.replacesInputId === value.inputId))
    context.addIssue({ code: "custom", message: "This protected purpose does not match its exact target." });
}

export const utilityProtectedScopeSchema = z.object({
  requestId: uuid, expectedVersion: z.number().int().positive(), programId: utilityProtectedProgramSchema,
  snapshotId: uuid, snapshotRevision: z.number().int().positive(), snapshotHash: hash,
}).strict();
export const utilityProtectedAuthorizationSchema = utilityProtectedScopeSchema.extend({
  inputId: uuid, purpose: utilityProtectedPurposeSchema, targets,
  mediaType: z.enum(["application/pdf", "image/jpeg", "image/png", "application/octet-stream"]),
  byteLength: z.number().int().min(1).max(MAX_UTILITY_PROTECTED_INPUT_BYTES),
  noticeVersion: z.literal(UTILITY_PROTECTED_INPUT_NOTICE_VERSION),
  consentAccepted: z.literal(true), subjectAuthorityDeclared: z.literal(true), accountAuthorityDeclared: z.literal(true),
  replacesInputId: uuid.optional(),
}).strict().superRefine(checkPurpose);

/** Safe sidecar metadata; no filename, secret, raw page, value commitment or plaintext content hash. */
export const utilityProtectedInputReferenceSchema = z.object({
  inputId: uuid, authorizationId: uuid, ownerId: uuid, requestId: uuid,
  requestVersion: z.number().int().positive(), programId: utilityProtectedProgramSchema,
  snapshotId: uuid, snapshotRevision: z.number().int().positive(), snapshotHash: hash,
  purpose: utilityProtectedPurposeSchema, targets,
  state: z.enum(["authorized", "stored", "revoked", "expired", "superseded"]),
  consentedAt: timestamp, expiresAt: timestamp,
  accountReference: uuid.nullable().default(null),
  validation: z.object({ id: uuid, validatorVersion: version, validatedAt: timestamp, expiresAt: timestamp }).strict().nullable(),
}).strict();
export type UtilityProtectedInputReference = z.infer<typeof utilityProtectedInputReferenceSchema>;
export type UtilityProtectedScope = z.infer<typeof utilityProtectedScopeSchema>;
export type UtilityProtectedAuthorization = z.infer<typeof utilityProtectedAuthorizationSchema>;
export type UtilityProtectedTarget = z.infer<typeof utilityProtectedTargetSchema>;
export const utilityProtectedWorkspaceSchema = z.object({
  requestVersion: z.number().int().positive(),
  collectionEnabled: z.boolean(), scope: utilityProtectedScopeSchema.nullable(), programId: utilityProtectedProgramSchema.nullable(), programLabel: z.string().max(160).nullable(),
  noticeVersion: z.literal(UTILITY_PROTECTED_INPUT_NOTICE_VERSION).nullable(), expiresAt: timestamp.nullable(), retentionSeconds: z.number().int().min(60).max(86400).nullable(),
  targets: z.array(z.object({ purpose: utilityProtectedPurposeSchema, target: utilityProtectedTargetSchema, displayName: z.string().max(200), sourceLabel: z.string().max(100).nullable(),
    available: z.boolean(), reason: z.string().max(500).nullable(), mediaTypes: z.array(z.enum(["application/pdf", "image/jpeg", "image/png", "application/octet-stream"])).min(1).max(3),
    maxBytes: z.number().int().positive().max(MAX_UTILITY_PROTECTED_INPUT_BYTES),
  }).strict()).max(4000), references: z.array(utilityProtectedInputReferenceSchema),
}).strict();
export type UtilityProtectedWorkspace = z.infer<typeof utilityProtectedWorkspaceSchema>;

/** Private-service binding only. It must never enter the ordinary worker, web API or routine export. */
export const utilityProtectedBindingSchema = utilityProtectedInputReferenceSchema.omit({ state: true, validation: true }).extend({
  format: z.literal(UTILITY_PROTECTED_INPUT_FORMAT), need: z.enum(["electricity", "gas", "water"]),
  policyVersion: version, retentionPolicyVersion: version,
  mediaType: z.enum(["application/pdf", "image/jpeg", "image/png", "application/octet-stream"]),
  byteLength: z.number().int().min(1).max(MAX_UTILITY_PROTECTED_INPUT_BYTES),
  contentDigest: hash,
}).strict().superRefine((value, context) => {
  checkPurpose(value, context);
  const need = { "peco-cap": "electricity", "pgw-crp": "gas", "pwd-tap": "water" }[value.programId];
  if (value.need !== need || Date.parse(value.expiresAt) <= Date.parse(value.consentedAt))
    context.addIssue({ code: "custom", message: "The protected binding is inconsistent." });
});
export type UtilityProtectedBinding = z.infer<typeof utilityProtectedBindingSchema>;

/** Local input/resource checks only; these are not provider identity or account validation. */
export const utilityProtectedScalarSchema = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("required_identifier"), type: z.enum(["ssn", "drivers_license", "student_id", "passport", "visa", "itin", "other"]),
    value: z.string().trim().min(1).max(256).refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value)),
    otherType: z.string().trim().min(1).max(80).optional(),
  }).strict().superRefine((value, context) => {
    if ((value.type === "other") !== !!value.otherType) context.addIssue({ code: "custom", message: "Describe only the selected other identifier type." });
  }),
  z.object({ purpose: z.literal("account_access"), accessCode: z.string().regex(/^[0-9]{9}$/), zip: z.string().regex(/^[0-9]{5}$/) }).strict(),
  z.object({ purpose: z.literal("application_recovery"), applicationId: z.string().regex(/^[0-9]{1,9}$/) }).strict(),
]);

export function utilityProtectedTargetKey(value: UtilityProtectedTarget): string {
  return `${value.subjectId}:${value.sourceId ?? "-"}:${value.field}`;
}

/** Matches PostgreSQL array_to_json(text[]); target order never changes the binding. */
export function utilityProtectedInputAad(input: unknown): Uint8Array {
  const value = utilityProtectedBindingSchema.parse(input);
  return new TextEncoder().encode(JSON.stringify([
    value.format, value.inputId, value.authorizationId, value.ownerId, value.requestId, String(value.requestVersion),
    value.programId, value.need, value.snapshotId, String(value.snapshotRevision), value.snapshotHash, value.purpose,
    value.targets.map(utilityProtectedTargetKey).sort().join(","), value.policyVersion, value.retentionPolicyVersion,
    value.mediaType, String(value.byteLength), value.contentDigest, value.consentedAt, value.expiresAt, value.accountReference ?? "-",
  ]));
}
