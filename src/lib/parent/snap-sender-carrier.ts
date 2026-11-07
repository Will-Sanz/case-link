import { createHash } from "node:crypto";
import { z } from "zod";
import { snapSenderAttemptSchema, snapSenderCarrierId, snapSenderPhone, snapSenderStatus, SNAP_SENDER_ERROR, type SnapSenderAttempt } from "./snap-sender-contract";
import { boundedSnapSenderWork, readSnapSenderJson } from "./snap-sender-http";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";

const destinationSchema = z.object({ id: snapSenderAttemptSchema.shape.destinationId, version: snapSenderAttemptSchema.shape.destinationVersion,
  number: snapSenderPhone, verifiedUntil: z.iso.datetime({ offset: true }) }).strict();
export const snapSenderCarrierConfigSchema = z.object({
  projectId: snapSenderCarrierId, serviceId: snapSenderCarrierId, fromNumber: snapSenderPhone,
  accessKey: z.string().min(1).max(256).regex(/^[^:\s]+$/), secretKey: z.string().min(1).max(256).regex(/^\S+$/),
  destinations: z.array(destinationSchema).min(1).max(100).refine(values => new Set(values.map(value => value.id)).size === values.length),
}).strict();
export type SnapSenderCarrierConfig = z.infer<typeof snapSenderCarrierConfigSchema>;
export type SnapCarrierObservation = { providerId: string | null; providerStatus: z.infer<typeof snapSenderStatus>; completedAt?: string };
export type SnapSenderCarrier = {
  checkConfiguration(signal: AbortSignal): Promise<void>;
  validateAttempt(input: unknown, recovery?: boolean): SnapSenderAttempt;
  send(attempt: SnapSenderAttempt, bytes: Uint8Array, beforeSend: () => Promise<SnapSenderAttempt>, signal: AbortSignal): Promise<SnapCarrierObservation>;
  reconcile(attempt: SnapSenderAttempt, signal: AbortSignal): Promise<SnapCarrierObservation>;
};

const timestamp = z.iso.datetime({ offset: true });
const faxSchema = z.object({
  id: snapSenderCarrierId, projectId: snapSenderCarrierId, serviceId: snapSenderCarrierId, from: snapSenderPhone, to: snapSenderPhone,
  direction: z.literal("OUTBOUND"), status: z.enum(["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILURE"]),
  createTime: timestamp, completedTime: timestamp.optional(), numberOfPages: z.number().int().nonnegative().optional(),
  pagesSentSuccessfully: z.number().int().nonnegative().optional(), maxRetries: z.literal(0), retryCount: z.literal(0).optional(),
  labels: z.object({ operationRef: z.string(), sourceSha256: z.string(), pageCount: z.string() }),
  contentUrl: z.unknown().optional(), callbackUrl: z.unknown().optional(), coverPageId: z.unknown().optional(),
  errorType: z.unknown().optional(), errorCode: z.unknown().optional(), errorMessage: z.unknown().optional(),
}).passthrough();
const empty = (value: unknown) => value === undefined || value === null || value === "";

/** Live, allowlisted byte delivery only. The emulator remains a separate implementation. */
export function createSinchSnapFaxCarrier(options: SnapSenderCarrierConfig & { fetcher?: typeof fetch }): SnapSenderCarrier {
  const { fetcher = fetch, ...raw } = options;
  let config: SnapSenderCarrierConfig;
  try { config = snapSenderCarrierConfigSchema.parse(raw); } catch { throw new Error(SNAP_SENDER_ERROR); }
  const project = `https://fax.api.sinch.com/v3/projects/${config.projectId}`;
  const authorization = `Basic ${Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64")}`;
  const unknown = (attempt: SnapSenderAttempt): SnapCarrierObservation => ({ providerId: attempt.providerId, providerStatus: "UNKNOWN" });
  function validateAttempt(input: unknown, recovery = false) {
    try {
      const attempt = snapSenderAttemptSchema.parse(input), target = config.destinations.find(value => value.id === attempt.destinationId);
      if (attempt.projectId !== config.projectId || attempt.serviceId !== config.serviceId || attempt.from !== config.fromNumber
        || (!recovery && (!target || target.version !== attempt.destinationVersion || target.number !== attempt.to || Date.parse(target.verifiedUntil) <= Date.now()))
        || Date.parse(attempt.expiresAt) <= Date.now()
        || Date.parse(attempt.attemptedAt) > Date.now()) throw new Error();
      return attempt;
    } catch { throw new Error(SNAP_SENDER_ERROR); }
  }
  async function request(path: string, method: "GET" | "POST", signal: AbortSignal, body?: FormData) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    const response = await boundedSnapSenderWork(bounded, () => fetcher(`${project}${path}`, {
      method, body, redirect: "error", cache: "no-store", signal: bounded,
      headers: { Authorization: authorization, Accept: "application/json" },
    }));
    if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== "https://fax.api.sinch.com")) {
      void response.body?.cancel().catch(() => {}); throw new Error(SNAP_SENDER_ERROR);
    }
    return readSnapSenderJson(response, 256 * 1024, bounded);
  }
  function classify(attempt: SnapSenderAttempt, value: unknown, expectedId?: string): SnapCarrierObservation {
    const parsed = faxSchema.safeParse(value);
    if (!parsed.success) return unknown(attempt);
    if (!attempt.dispatchAuthorizedAt) return unknown(attempt);
    const fax = parsed.data, created = Date.parse(fax.createTime), dispatched = Date.parse(attempt.dispatchAuthorizedAt);
    if ((expectedId && fax.id !== expectedId) || fax.projectId !== attempt.projectId || fax.serviceId !== attempt.serviceId
      || fax.from !== attempt.from || fax.to !== attempt.to || fax.labels.operationRef !== attempt.operationRef
      || fax.labels.sourceSha256 !== attempt.contentSha256 || fax.labels.pageCount !== String(attempt.pageCount)
      || created < dispatched - 60_000 || created > dispatched + 90_000 || created > Date.now() + 60_000
      || !empty(fax.contentUrl) || !empty(fax.callbackUrl) || !empty(fax.coverPageId)) return unknown(attempt);
    if (fax.status !== "FAILURE" && (fax.errorType || fax.errorCode || fax.errorMessage)) return unknown(attempt);
    if (fax.status === "QUEUED" || fax.status === "IN_PROGRESS") {
      if ((fax.numberOfPages !== undefined && fax.numberOfPages !== attempt.pageCount)
        || (fax.pagesSentSuccessfully ?? 0) > attempt.pageCount || fax.completedTime) return unknown(attempt);
      return { providerId: fax.id, providerStatus: fax.status };
    }
    if (fax.status === "FAILURE") return { providerId: fax.id, providerStatus: "FAILURE" };
    const completed = Date.parse(fax.completedTime ?? "");
    if (fax.numberOfPages !== attempt.pageCount || fax.pagesSentSuccessfully !== attempt.pageCount
      || !Number.isFinite(completed) || completed < created || completed > Date.now() + 60_000) return unknown(attempt);
    return { providerId: fax.id, providerStatus: "COMPLETED", completedAt: fax.completedTime };
  }
  return {
    validateAttempt,
    async checkConfiguration(signal) {
      try {
        const [service, emails, numbers] = await Promise.all([
          request(`/services/${config.serviceId}`, "GET", signal), request(`/services/${config.serviceId}/emails?pageSize=1`, "GET", signal),
          request(`/services/${config.serviceId}/numbers?pageSize=100`, "GET", signal),
        ]);
        const settings = z.object({ id: z.literal(config.serviceId), projectId: z.literal(config.projectId),
          saveOutboundFaxDocuments: z.literal(false), numberOfRetries: z.literal(0), inProgressNotifications: z.literal(false),
          coverPageId: z.unknown().optional(), callbackUrl: z.unknown().optional(), defaultFrom: z.unknown().optional() }).passthrough().parse(service);
        if (!empty(settings.coverPageId) || !empty(settings.callbackUrl) || (!empty(settings.defaultFrom) && settings.defaultFrom !== config.fromNumber)) throw new Error();
        z.object({ emails: z.array(z.unknown()).length(0), totalItems: z.literal(0), totalPages: z.number().int().min(0).max(1) }).passthrough().parse(emails);
        const assigned = z.object({ numbers: z.array(z.object({ phoneNumber: z.string(), projectId: snapSenderCarrierId, serviceId: snapSenderCarrierId }).passthrough()).max(100),
          page: z.number().int().min(0).max(1), pageSize: z.number().int().min(1).max(100), totalItems: z.number().int().min(1).max(100), totalPages: z.literal(1) }).passthrough().parse(numbers);
        const matches = assigned.numbers.filter(number => number.phoneNumber === config.fromNumber);
        if (assigned.numbers.length !== assigned.totalItems || assigned.totalItems > assigned.pageSize || matches.length !== 1
          || matches[0].projectId !== config.projectId || matches[0].serviceId !== config.serviceId) throw new Error();
        signal.throwIfAborted();
      } catch { throw new Error(SNAP_SENDER_ERROR); }
    },
    async send(input, bytes, beforeSend, signal) {
      const attempt = validateAttempt(input);
      let copy: Uint8Array<ArrayBuffer> | undefined;
      try {
        if (attempt.dispatchAuthorizedAt !== null || !(bytes instanceof Uint8Array) || bytes.byteLength < 8 || bytes.byteLength > MAX_SNAP_PACKET_BYTES
          || createHash("sha256").update(bytes).digest("hex") !== attempt.contentSha256
          || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error();
        copy = Uint8Array.from(bytes);
        const form = new FormData();
        // Labels bind our checked upload; the source hash is not independently computed by the carrier.
        for (const [key, value] of Object.entries({ to: attempt.to, from: attempt.from,
          maxRetries: "0", resolution: "FINE", headerText: "", headerPageNumbers: "false", inProgressNotifications: "false",
          "labels[operationRef]": attempt.operationRef, "labels[sourceSha256]": attempt.contentSha256, "labels[pageCount]": String(attempt.pageCount) })) form.append(key, value);
        form.append("file", new Blob([copy], { type: "application/pdf" }), "application.pdf");
        signal.throwIfAborted();
        const current = validateAttempt(await beforeSend());
        signal.throwIfAborted();
        if (!current.dispatchAuthorizedAt || current.operationRef !== attempt.operationRef || current.contentSha256 !== attempt.contentSha256
          || current.operationId !== attempt.operationId || current.packetId !== attempt.packetId || current.to !== attempt.to) throw new Error();
        return classify(current, await request("/faxes", "POST", signal, form));
      } catch { return unknown(attempt); }
      finally { copy?.fill(0); }
    },
    async reconcile(input, signal) {
      // The DB authorizes the frozen historical route for status only; old submission-route expiry cannot force re-signing.
      const attempt = validateAttempt(input, true);
      try {
        if (!attempt.dispatchAuthorizedAt) return unknown(attempt);
        if (attempt.providerId) return classify(attempt, await request(`/faxes/${attempt.providerId}`, "GET", signal), attempt.providerId);
        const dispatched = Date.parse(attempt.dispatchAuthorizedAt), query = new URLSearchParams({ serviceId: attempt.serviceId, direction: "OUTBOUND",
          to: attempt.to, from: attempt.from, "createTime>": new Date(dispatched - 60_000).toISOString(), "createTime<": new Date(dispatched + 90_000).toISOString(), pageSize: "100" });
        const list = z.object({ faxes: z.array(z.unknown()).max(100), page: z.number().int().min(0).max(1), totalPages: z.number().int().min(0).max(1),
          pageSize: z.number().int().min(1).max(100), totalItems: z.number().int().min(0).max(100) }).passthrough().parse(await request(`/faxes?${query}`, "GET", signal));
        if (list.faxes.length !== list.totalItems || list.totalItems > list.pageSize || (list.totalItems > 0 && list.totalPages !== 1)) return unknown(attempt);
        const matches = list.faxes.filter(value => z.object({ labels: z.object({ operationRef: z.literal(attempt.operationRef) }) }).safeParse(value).success);
        return matches.length === 1 ? classify(attempt, matches[0]) : unknown(attempt);
      } catch { return unknown(attempt); }
    },
  };
}
