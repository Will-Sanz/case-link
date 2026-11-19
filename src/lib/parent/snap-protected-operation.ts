import { z } from "zod";
import { outcomeSchema } from "./domain";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";

const uuid = z.uuid().regex(/^[a-f0-9-]{36}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const SNAP_PARENT_CERTIFICATION_ACTS = ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"] as const;
export const snapProtectedReferenceSchema = z.object({
  packetId: uuid,
  authorizationId: uuid,
  snapshotId: uuid,
  snapshotHash: digest,
  contentSha256: digest,
  byteLength: z.number().int().min(1).max(MAX_SNAP_PACKET_BYTES),
  verificationId: uuid,
}).strict();
export type SnapProtectedReference = z.infer<typeof snapProtectedReferenceSchema>;
export const snapProtectedPacketSchema = z.object({ protectedSnapPacket: snapProtectedReferenceSchema }).strict();

/** Exact leased-operation metadata; neither these references nor a stored PDF assert that a filing occurred. */
export const snapProtectedOperationSchema = z.object({
  operationId: uuid,
  requestId: uuid,
  requestVersion: z.number().int().positive().max(2147483647),
  need: z.literal("snap_new"),
  programId: z.literal("snap-pa"),
  action: z.literal("submit"),
  state: z.union([outcomeSchema, z.literal("delivery_unknown"), z.literal("executing")]),
  packet: snapProtectedPacketSchema,
  packetHash: digest,
  dataCategories: z.array(z.enum(["household", "income"])).min(1).max(2)
    .refine(value => value.includes("household") && new Set(value).size === value.length),
  documentIds: z.array(uuid).length(0),
  artifactId: z.null(),
  idempotencyKey: z.string().min(1).max(200),
  permissionVersion: z.string().min(1).max(200),
  protectedPacketCurrent: z.boolean(),
  protectedParentSubmitReady: z.boolean(),
  personalActsComplete: z.boolean(),
  snapSubmissionAuthorized: z.boolean(),
}).strict().refine(value => value.idempotencyKey === `snap-final:${value.packet.protectedSnapPacket.packetId}`);
export type SnapProtectedOperation = z.infer<typeof snapProtectedOperationSchema>;
export function snapProtectedDeliveryAttempt(state: string): boolean {
  return ["executing", "delivery_unknown", "sent", "partner_received", "partner_accepted", "agency_submitted", "assistance_approved", "support_received", "declined", "unresolved"].includes(state);
}

export function sameSnapProtectedPacket(left: unknown, right: unknown): boolean {
  const a = snapProtectedPacketSchema.safeParse(left), b = snapProtectedPacketSchema.safeParse(right);
  return a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data);
}

export function sameSnapProtectedOperationBinding(left: SnapProtectedOperation, right: SnapProtectedOperation): boolean {
  const immutable = (value: SnapProtectedOperation) => ({ ...value, state: "prepared", protectedPacketCurrent: false, protectedParentSubmitReady: false, personalActsComplete: false, snapSubmissionAuthorized: false });
  return JSON.stringify(immutable(left)) === JSON.stringify(immutable(right));
}
