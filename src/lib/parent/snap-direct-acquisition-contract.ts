import { z } from "zod";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";
import { snapCaptureContextSchema } from "./snap-capture-context";
import { snapFinalPacketBindingSchema, snapPacketAuthorizationScopeSchema } from "./snap-packet-contract";

export const SNAP_DIRECT_ACQUISITION_METHOD = "pa600fs-direct-completion-2026-11-05.v1";
export const SNAP_DIRECT_ACQUISITION_FIELDS = [
  "applicant_ssn", "applicant_signature_printed_page_1", "applicant_signature_date_printed_page_1",
  "rights_certification_printed_page_5", "rights_certification_date_printed_page_5",
] as const;
const binding = snapFinalPacketBindingSchema.shape;
const subjects = z.array(binding.ownerId).min(1).max(source.limits.householdRows)
  .refine(values => new Set(values).size === values.length);

export const snapDirectAcquisitionScopeSchema = snapPacketAuthorizationScopeSchema.omit({ packetId: true });
export type SnapDirectAcquisitionScope = z.infer<typeof snapDirectAcquisitionScopeSchema>;
export const snapDirectAcquisitionInputSchema = snapDirectAcquisitionScopeSchema.extend({
  acquisitionId: snapDirectAcquisitionScopeSchema.shape.snapshotId,
  policyVersion: binding.policyVersion,
  retentionPolicyVersion: binding.retentionPolicyVersion,
  acceptedExpiresAt: binding.expiresAt.refine(value => Date.parse(value) <= Date.parse(source.verifiedUntil)),
  subjectIds: z.array(snapDirectAcquisitionScopeSchema.shape.snapshotId).min(1).max(source.limits.householdRows)
    .refine(values => new Set(values).size === values.length),
  authorityDeclared: z.literal(true),
}).strict();
export type SnapDirectAcquisitionInput = z.infer<typeof snapDirectAcquisitionInputSchema>;
export const snapDirectAcquisitionRevokeSchema = z.object({
  acquisitionId: snapDirectAcquisitionScopeSchema.shape.snapshotId,
}).strict();
export type SnapDirectAcquisitionRevoke = z.infer<typeof snapDirectAcquisitionRevokeSchema>;

export const snapDirectPacketScopeSchema = snapPacketAuthorizationScopeSchema;
export type SnapDirectPacketScope = z.infer<typeof snapDirectPacketScopeSchema>;
export const snapDirectPacketReadScopeSchema = snapDirectPacketScopeSchema.partial({ packetId: true });
export type SnapDirectPacketReadScope = z.infer<typeof snapDirectPacketReadScopeSchema>;
export const snapDirectPacketInputSchema = snapDirectPacketScopeSchema.extend({
  acquisitionId: snapDirectAcquisitionRevokeSchema.shape.acquisitionId,
  contentSha256: binding.contentSha256,
  byteLength: binding.byteLength,
}).strict();
export type SnapDirectPacketInput = z.infer<typeof snapDirectPacketInputSchema>;

const metadata = {
  ownerId: binding.ownerId, requestId: binding.requestId, requestVersion: binding.requestVersion,
  snapshotId: binding.snapshotId, snapshotHash: binding.snapshotHash,
  recipient: binding.recipient, need: binding.need, purpose: binding.purpose,
  method: z.literal(SNAP_DIRECT_ACQUISITION_METHOD),
  fieldScope: z.tuple([
    z.literal(SNAP_DIRECT_ACQUISITION_FIELDS[0]), z.literal(SNAP_DIRECT_ACQUISITION_FIELDS[1]),
    z.literal(SNAP_DIRECT_ACQUISITION_FIELDS[2]), z.literal(SNAP_DIRECT_ACQUISITION_FIELDS[3]),
    z.literal(SNAP_DIRECT_ACQUISITION_FIELDS[4]),
  ]),
  source: snapCaptureContextSchema.shape.source, subjectIds: subjects,
  policyVersion: binding.policyVersion, retentionPolicyVersion: binding.retentionPolicyVersion,
  expiresAt: binding.expiresAt,
};

// Permission metadata alone never establishes acquisition, personal acts, storage or submission.
export const snapDirectAcquisitionResultSchema = z.discriminatedUnion("state", [
  z.object({ ...metadata, state: z.literal("permission_needed"), acquisitionId: z.null(), authorityDeclaration: z.null(), consentedAt: z.null() }).strict(),
  z.object({ ...metadata, state: z.literal("authorized"), acquisitionId: binding.authorizationId,
    authorityDeclaration: z.literal("parent_declared_household_data_authority"), consentedAt: binding.expiresAt }).strict(),
]).refine(value => Date.parse(value.expiresAt) <= Date.parse(source.verifiedUntil)
  && (value.state === "permission_needed" || Date.parse(value.expiresAt) > Date.parse(value.consentedAt)));
export type SnapDirectAcquisitionResult = z.infer<typeof snapDirectAcquisitionResultSchema>;
