import { z } from "zod";
import { snapProtectedOperationSchema, snapProtectedReferenceSchema } from "./snap-protected-operation";

const uuid = z.uuid().regex(/^[a-f0-9-]{36}$/);
/** Only leased exact-operation metadata crosses from the ordinary worker. */
export const snapSenderIntentSchema = z.object({
  jobId: uuid, leaseToken: uuid, operationId: uuid, requestId: uuid,
  requestVersion: snapProtectedOperationSchema.shape.requestVersion,
  idempotencyKey: z.string().min(1).max(200), packetHash: z.string().regex(/^[a-f0-9]{64}$/),
  protectedPacket: snapProtectedReferenceSchema,
}).strict().refine(value => value.idempotencyKey === `snap-final:${value.protectedPacket.packetId}`);
export type SnapSenderIntent = z.infer<typeof snapSenderIntentSchema>;
export const SNAP_SENDER_ERROR = "The protected SNAP delivery could not be confirmed.";

export const snapSenderCarrierId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const snapSenderPhone = z.string().regex(/^\+1[2-9][0-9]{9}$/).refine(value => value !== "+19898989898");
export const snapSenderStatus = z.enum(["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILURE", "UNKNOWN"]);
export const snapSenderAttemptSchema = z.object({
  operationId: uuid, packetId: uuid, contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  operationRef: z.string().regex(/^[a-f0-9]{64}$/), attemptedAt: z.iso.datetime({ offset: true }),
  dispatchAuthorizedAt: z.iso.datetime({ offset: true }).nullable(),
  projectId: snapSenderCarrierId, serviceId: snapSenderCarrierId, from: snapSenderPhone, to: snapSenderPhone,
  destinationId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/), destinationVersion: z.string().min(1).max(200),
  expiresAt: z.iso.datetime({ offset: true }), pageCount: z.literal(12),
  providerId: snapSenderCarrierId.nullable(), providerStatus: snapSenderStatus,
}).strict();
export type SnapSenderAttempt = z.infer<typeof snapSenderAttemptSchema>;
