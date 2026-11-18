import { z } from "zod";
import { snapFormTemplateIdSchema, snapFormSource, snapFormTemplateSourceSchema } from "./snap-form-source";

export const SNAP_FINAL_PACKET_FORMAT = "caselink-snap-final-packet-v1";
export const MAX_SNAP_PACKET_BYTES = 10 * 1024 * 1024;
const uuid = z.uuid().regex(/^[a-f0-9-]{36}$/);
const inputUuid = z.uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive().max(2147483647);
const policyVersion = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const timestamp = z.iso.datetime({ precision: 3 }).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

// Pure metadata contract: shared by browser-safe validation and the isolated cryptographic client.
const packetBinding = z.object({
  format: z.literal(SNAP_FINAL_PACKET_FORMAT),
  packetId: uuid,
  ownerId: uuid,
  requestId: uuid,
  requestVersion: version,
  recipient: z.literal("snap-pa"),
  need: z.literal("snap_new"),
  purpose: z.literal("snap_final_application_packet"),
  authorizationId: uuid,
  policyVersion,
  retentionPolicyVersion: policyVersion,
  templateId: snapFormTemplateIdSchema,
  templateVersion: z.string(),
  templateSha256: hash,
  snapshotId: uuid,
  snapshotHash: hash,
  contentSha256: hash,
  byteLength: z.number().int().min(1).max(MAX_SNAP_PACKET_BYTES),
  expiresAt: timestamp,
}).strict();
const exactSource = (value: { templateId: string; templateVersion: string; templateSha256: string }) => snapFormTemplateSourceSchema.safeParse({ templateId: value.templateId, templateVersion: value.templateVersion, templateSha256: value.templateSha256 }).success;
export const snapFinalPacketBindingSchema = packetBinding.refine(exactSource);
export type SnapFinalPacketBinding = z.infer<typeof snapFinalPacketBindingSchema>;
export const snapFinalizerIntentSchema = packetBinding.omit({ expiresAt: true }).refine(exactSource);
export type SnapFinalizerIntent = z.infer<typeof snapFinalizerIntentSchema>;

export const snapPacketAuthorizationScopeSchema = z.object({
  packetId: inputUuid,
  expectedVersion: version,
  snapshotId: inputUuid,
  snapshotHash: hash,
}).strict();
export type SnapPacketAuthorizationScope = z.infer<typeof snapPacketAuthorizationScopeSchema>;
export const snapPacketAuthorizationInputSchema = snapPacketAuthorizationScopeSchema.extend({
  contentSha256: hash,
  byteLength: z.number().int().min(1).max(MAX_SNAP_PACKET_BYTES),
  policyVersion,
  retentionPolicyVersion: policyVersion,
  subjectIds: z.array(inputUuid).min(1).max(30).refine(values => new Set(values).size === values.length),
  authorityDeclared: z.literal(true),
}).strict();
export type SnapPacketAuthorizationInput = z.infer<typeof snapPacketAuthorizationInputSchema>;

export const snapPacketAuthorizationResultSchema = z.object({
  intent: snapFinalizerIntentSchema,
  authorizationExpiresAt: timestamp,
  subjectIds: z.array(uuid).min(1).max(30).refine(values => new Set(values).size === values.length),
  authorityDeclaration: z.literal("parent_declared_household_data_authority"),
  consentedAt: timestamp,
  // These are metadata states, not proof of upload absence, cryptographic verification or completion.
  state: z.enum(["authorized", "stored"]),
}).strict().refine(value => Date.parse(value.authorizationExpiresAt) > Date.parse(value.consentedAt)
  && Date.parse(value.authorizationExpiresAt) <= Date.parse(snapFormSource(value.intent.templateId).contract.verifiedUntil));
export type SnapPacketAuthorizationResult = z.infer<typeof snapPacketAuthorizationResultSchema>;
