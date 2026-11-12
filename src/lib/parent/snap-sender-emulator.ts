import { createHash } from "node:crypto";
import { z } from "zod";
import { createSinchFaxEmulator, SINCH_FAX_EMULATOR_NUMBER, type SinchFaxEmulationEvidence } from "./sinch-fax";
import { snapEmulatorAttemptSchema, snapSenderCarrierId, snapSenderPhone, SNAP_SENDER_ERROR, type SnapSenderAttempt } from "./snap-sender-contract";
import type { SnapSenderCarrier, SnapCarrierObservation } from "./snap-sender-carrier";

export const snapEmulatorConfigSchema = z.object({
  requestId: z.uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: snapSenderCarrierId, serviceId: snapSenderCarrierId, fromNumber: snapSenderPhone,
  accessKey: z.string().min(1).max(256).regex(/^[^:\s]+$/), secretKey: z.string().min(1).max(256).regex(/^\S+$/),
}).strict();

/** The only destination is Sinch's free emulator. No caller can supply a telephone number. */
export function createSinchSnapFaxEmulatorCarrier(input: z.infer<typeof snapEmulatorConfigSchema> & { fetcher?: typeof fetch }): SnapSenderCarrier {
  const { fetcher, ...raw } = input, config = snapEmulatorConfigSchema.parse(raw);
  const client = createSinchFaxEmulator({ projectId: config.projectId, serviceId: config.serviceId, fromNumber: config.fromNumber,
    accessKey: config.accessKey, secretKey: config.secretKey, ...(fetcher ? { fetcher } : {}) });
  function validateAttempt(input: unknown) {
    const attempt = snapEmulatorAttemptSchema.parse(input);
    if (attempt.requestId !== config.requestId || attempt.snapshotHash !== config.snapshotHash || attempt.projectId !== config.projectId || attempt.serviceId !== config.serviceId
      || attempt.from !== config.fromNumber || Date.parse(attempt.expiresAt) <= Date.now() || Date.parse(attempt.attemptedAt) > Date.now()
      || attempt.operationRef !== createHash("sha256").update(`snap-final:${attempt.packetId}`).digest("hex")) throw new Error(SNAP_SENDER_ERROR);
    return attempt;
  }
  function observed(value: SinchFaxEmulationEvidence): SnapCarrierObservation {
    return { providerId: value.faxId ?? null, providerStatus: value.state === "completed" ? "COMPLETED" : value.state === "pending" ? "QUEUED" : "UNKNOWN",
      ...(value.completedAt ? { completedAt: value.completedAt } : {}) };
  }
  const unknown = (attempt: SnapSenderAttempt): SnapCarrierObservation => ({ providerId: attempt.providerId, providerStatus: "UNKNOWN" });
  return {
    validateAttempt,
    checkConfiguration: signal => client.checkConfiguration(signal),
    async send(input, bytes, beforeSend, signal) {
      const attempt = validateAttempt(input);
      try {
        if (attempt.dispatchAuthorizedAt !== null || !(bytes instanceof Uint8Array)
          || createHash("sha256").update(bytes).digest("hex") !== attempt.contentSha256) throw new Error();
        const current = validateAttempt(await beforeSend());
        if (!current.dispatchAuthorizedAt || current.operationRef !== attempt.operationRef || current.operationId !== attempt.operationId
          || current.packetId !== attempt.packetId || current.contentSha256 !== attempt.contentSha256) throw new Error();
        signal.throwIfAborted();
        return observed(await client.sendSyntheticTest({ bytes, contentSha256: current.contentSha256, pageCount: 12,
          idempotencyKey: `snap-final:${current.packetId}` }, signal, async operation => {
          if (operation.to !== SINCH_FAX_EMULATOR_NUMBER || operation.operationRef !== current.operationRef
            || operation.contentSha256 !== current.contentSha256) throw new Error();
        }));
      } catch { return unknown(attempt); }
    },
    async reconcile(input, signal) {
      const attempt = validateAttempt(input);
      if (!attempt.dispatchAuthorizedAt) return unknown(attempt);
      const at = Date.parse(attempt.dispatchAuthorizedAt);
      const operation = { projectId: attempt.projectId, serviceId: attempt.serviceId, from: attempt.from,
        to: SINCH_FAX_EMULATOR_NUMBER, operationRef: attempt.operationRef, contentSha256: attempt.contentSha256,
        pageCount: attempt.pageCount, attemptedAt: attempt.dispatchAuthorizedAt } as const;
      return observed(attempt.providerId ? await client.inspect(operation, attempt.providerId, signal)
        : await client.reconcile(operation, { fromTime: new Date(at - 60000).toISOString(), toTime: new Date(at + 90000).toISOString() }, signal));
    },
  };
}
