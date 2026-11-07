import { z } from "zod";
import { receiptSchema } from "./policy";
import type { SnapProtectedReference } from "./snap-protected-operation";

export type SnapProtectedSubmissionIntent = {
  jobId: string;
  leaseToken: string;
  operationId: string;
  requestId: string;
  requestVersion: number;
  idempotencyKey: string;
  packetHash: string;
  protectedPacket: SnapProtectedReference;
  signal: AbortSignal;
};
const resultBinding = z.object({ operationId: z.uuid(), packetId: z.uuid(), contentSha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const snapTransportFailureSchema = z.object({ state: z.literal("delivery_unknown"), transportStatus: z.literal("FAILURE") }).strict();
export const snapProtectedSubmissionResultSchema = z.union([
  resultBinding.extend({ state: z.literal("delivery_unknown"), transportStatus: z.literal("FAILURE").optional() }).strict(),
  resultBinding.extend({ receipt: receiptSchema.refine(value =>
    (value.state === "sent" && value.source === "provider_api") ||
    (value.state === "agency_submitted" && value.source === "agency_receipt")) }).strict(),
]);
/** A sender must reserve durable exact intent under live DB authority before decrypt/send. */
export type SnapProtectedSubmissionPort = {
  execute(input: SnapProtectedSubmissionIntent): Promise<unknown>;
  /** Only DB-proved undispatched reservations may resume; uncertain transmissions are read-only. */
  reconcile(input: SnapProtectedSubmissionIntent): Promise<unknown | null>;
};
