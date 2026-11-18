import { z } from "zod";
import { PECO_APPLICATION_SOURCE } from "./peco-application-fields";
import { PGW_APPLICATION_SOURCE } from "./pgw-application-fields";
import { WATER_APPLICATION_REFERENCE } from "./water-application-fields";

export const UTILITY_PREPARED_PACKET_FORMAT = "caselink-utility-preparation-v1";
export const MAX_UTILITY_PREPARED_BYTES = 10 * 1024 * 1024;
const uuid = z.uuid().regex(/^[a-f0-9-]{36}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const timestamp = z.iso.datetime({ offset: true });
export const utilityPreparationProgramSchema = z.enum(["peco-cap", "pgw-crp", "pwd-tap"]);
export const utilityPreparedInputBindingSchema = z.object({
  inputId: uuid, authorizationId: uuid, validationId: uuid.nullable(),
}).strict();

export type UtilityPreparedInputBinding = z.infer<typeof utilityPreparedInputBindingSchema>;

/** Opaque preparation metadata only. No member identifier, account code, page, filename or retrieval authority. */
export const utilityPreparedReferenceSchema = z.object({
  packetId: uuid,
  requestId: uuid, requestVersion: z.number().int().positive().max(2147483647), programId: utilityPreparationProgramSchema,
  snapshotId: uuid, snapshotRevision: z.number().int().positive().max(2147483647), snapshotHash: digest,
  inputs: z.array(utilityPreparedInputBindingSchema).max(256).superRefine((inputs, context) => {
    if (new Set(inputs.map(input => input.inputId)).size !== inputs.length)
      context.addIssue({ code: "custom", message: "Each protected input must be bound once." });
  }).transform(inputs => [...inputs].sort((a, b) => a.inputId.localeCompare(b.inputId))),
  sourceKind: z.enum(["official_public_form", "local_test_issued_form"]),
  templateId: version, templateVersion: version, templateSha256: digest, rendererVersion: version,
  policyVersion: version, retentionPolicyVersion: version,
  preparedAt: timestamp, expiresAt: timestamp,
  contentSha256: digest, byteLength: z.number().int().min(64).max(MAX_UTILITY_PREPARED_BYTES),
  preparationOnly: z.literal(true),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.preparedAt))
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "The prepared file needs its original bounded lifetime." });
  if (value.programId === "pwd-tap" && (value.sourceKind !== "local_test_issued_form" || value.templateId !== "caselink-local-water-issued-form" || value.templateSha256 === WATER_APPLICATION_REFERENCE.sampleSha256))
    context.addIssue({ code: "custom", path: ["sourceKind"], message: "No actual account-issued City water form has been verified." });
  if (value.programId !== "pwd-tap" && value.sourceKind !== "official_public_form")
    context.addIssue({ code: "custom", path: ["sourceKind"], message: "Use the program's checked public form for unsigned preparation." });
  const source = value.programId === "peco-cap" ? { id: PECO_APPLICATION_SOURCE.contractId, version: PECO_APPLICATION_SOURCE.contractVersion, hash: PECO_APPLICATION_SOURCE.sourceSha256 }
    : value.programId === "pgw-crp" ? { id: PGW_APPLICATION_SOURCE.id, version: PGW_APPLICATION_SOURCE.version, hash: PGW_APPLICATION_SOURCE.sourceSha256 } : null;
  if (source && (value.templateId !== source.id || value.templateVersion !== source.version || value.templateSha256 !== source.hash))
    context.addIssue({ code: "custom", path: ["templateSha256"], message: "The unsigned preparation must bind the checked program-specific form." });
});
export type UtilityPreparedReference = z.infer<typeof utilityPreparedReferenceSchema>;
export const utilityPreparedPacketSchema = z.object({ protectedUtilityPacket: utilityPreparedReferenceSchema }).strict();

/** A trusted current leased row, never a permission to send or a completed personal act. */
export const utilityProtectedOperationSchema = z.object({
  operationId: uuid, requestId: uuid, requestVersion: z.number().int().positive().max(2147483647),
  need: z.enum(["electricity", "gas", "water"]), programId: utilityPreparationProgramSchema,
  action: z.literal("prepare"), state: z.literal("prepared"),
  packet: utilityPreparedPacketSchema, packetHash: digest,
  dataCategories: z.array(z.enum(["household", "income", "utility", "documents"])).min(3).max(4).refine(categories =>
    new Set(categories).size === categories.length && (["household", "income", "utility"] as const).every(category => categories.includes(category))),
  documentIds: z.array(uuid).length(0), artifactId: z.null(),
  idempotencyKey: z.string().min(1).max(200), protectedPacketCurrent: z.boolean(),
}).strict().superRefine((value, context) => {
  const reference = value.packet.protectedUtilityPacket;
  if (value.requestId !== reference.requestId || value.requestVersion !== reference.requestVersion || value.programId !== reference.programId ||
    value.need !== ({ "peco-cap": "electricity", "pgw-crp": "gas", "pwd-tap": "water" } as const)[value.programId] ||
    value.idempotencyKey !== `utility-prepare:${reference.packetId}`)
    context.addIssue({ code: "custom", message: "The preparation must match its exact request, program and operation key." });
});
export type UtilityProtectedOperation = z.infer<typeof utilityProtectedOperationSchema>;

/** Private-service encryption binding; never returned by an ordinary worker or routine export. */
export const utilityPreparedBindingSchema = z.object({
  format: z.literal(UTILITY_PREPARED_PACKET_FORMAT), ownerId: uuid, mandateHash: digest, inputSetHash: digest,
  operation: utilityProtectedOperationSchema,
}).strict();
export type UtilityPreparedBinding = z.infer<typeof utilityPreparedBindingSchema>;

export function sameUtilityPreparedPacket(left: unknown, right: unknown): boolean {
  const a = utilityPreparedPacketSchema.safeParse(left), b = utilityPreparedPacketSchema.safeParse(right);
  return a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data);
}
export function sameUtilityProtectedOperationBinding(left: UtilityProtectedOperation, right: UtilityProtectedOperation): boolean {
  return JSON.stringify({ ...left, protectedPacketCurrent: false }) === JSON.stringify({ ...right, protectedPacketCurrent: false });
}

/** PostgreSQL uses the same ordered text-array encoding; mutable currentness never changes authenticated bytes. */
export function utilityPreparedAad(input: unknown): Uint8Array {
  const binding = utilityPreparedBindingSchema.parse(input), operation = binding.operation, value = operation.packet.protectedUtilityPacket;
  return new TextEncoder().encode(JSON.stringify([
    binding.format, binding.ownerId, binding.mandateHash, binding.inputSetHash, operation.operationId, operation.packetHash, operation.idempotencyKey,
    value.packetId, value.requestId, String(value.requestVersion), value.programId, value.snapshotId, String(value.snapshotRevision), value.snapshotHash,
    value.inputs.map(input => `${input.inputId}:${input.authorizationId}:${input.validationId ?? "-"}`).join(","),
    value.sourceKind, value.templateId, value.templateVersion, value.templateSha256, value.rendererVersion, value.policyVersion, value.retentionPolicyVersion,
    value.preparedAt, value.expiresAt, value.contentSha256, String(value.byteLength), operation.dataCategories.join(","),
  ]));
}
