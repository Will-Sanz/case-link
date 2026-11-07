import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { openSnapFinalPacket, snapFinalPacketAad } from "./snap-final-packet";
import { inspectSnapFinalPdf } from "./snap-final-pdf";
import { snapSenderIntentSchema, SNAP_SENDER_ERROR, type SnapSenderAttempt, type SnapSenderIntent } from "./snap-sender-contract";
import { snapSenderEnvelopeSchema, validateSnapDeliveryAttempt, type SnapSenderStore, type SnapSenderEnvelope } from "./snap-sender-store";
import { snapProtectedSubmissionResultSchema } from "./snap-protected-submission-port";
import type { SnapSenderCarrier, SnapCarrierObservation } from "./snap-sender-carrier";
import { boundedSnapSenderWork, readSnapSenderJson } from "./snap-sender-http";

type DeliveryResult = z.infer<typeof snapProtectedSubmissionResultSchema>;
export type SnapProtectedDelivery = {
  execute(intent: SnapSenderIntent, signal: AbortSignal): Promise<DeliveryResult>;
  reconcile(intent: SnapSenderIntent, signal: AbortSignal): Promise<DeliveryResult>;
};
function decode(value: string, expected: number) {
  if (value.length > Math.ceil(expected / 3) * 4 + Math.ceil(expected / 57) || !/^[A-Za-z0-9+/=\n]+$/.test(value)) throw new Error(SNAP_SENDER_ERROR);
  const compact = value.replaceAll("\n", ""), bytes = Buffer.from(compact, "base64");
  if (bytes.length !== expected || bytes.toString("base64") !== compact) { bytes.fill(0); throw new Error(SNAP_SENDER_ERROR); }
  return bytes;
}
function frozen(attempt: SnapSenderAttempt) {
  const { expiresAt: _, providerId: __, providerStatus: ___, dispatchAuthorizedAt: ____, ...value } = attempt; void _; void __; void ___; void ____;
  return JSON.stringify(value);
}

/** Only this isolated process receives/decrypts the PDF; ordinary workers receive a bound result only. */
export function createSnapProtectedDelivery(options: { store: SnapSenderStore; carrier: SnapSenderCarrier }): SnapProtectedDelivery {
  const { store, carrier } = options;
  const unknown = (intent: SnapSenderIntent): DeliveryResult => ({ state: "delivery_unknown", operationId: intent.operationId,
    packetId: intent.protectedPacket.packetId, contentSha256: intent.protectedPacket.contentSha256 });
  function result(intent: SnapSenderIntent, observed: SnapCarrierObservation, saved: SnapSenderAttempt): DeliveryResult {
    if (saved.providerStatus === "FAILURE" && saved.providerId) return { ...unknown(intent), transportStatus: "FAILURE" };
    if (observed.providerStatus !== "COMPLETED" || !observed.providerId || !observed.completedAt
      || saved.providerId !== observed.providerId || saved.providerStatus !== "COMPLETED") return unknown(intent);
    return { operationId: intent.operationId, packetId: intent.protectedPacket.packetId, contentSha256: intent.protectedPacket.contentSha256,
      receipt: { state: "sent", source: "provider_api", reference: `sinch-fax:${observed.providerId}`, recordedAt: observed.completedAt } };
  }
  async function reconcile(input: SnapSenderIntent, signal: AbortSignal): Promise<DeliveryResult> {
    const intent = snapSenderIntentSchema.parse(input);
    try {
      const attempt = await store.read(intent, signal);
      if (!attempt) return unknown(intent);
      validateSnapDeliveryAttempt(intent, attempt); carrier.validateAttempt(attempt, true); signal.throwIfAborted();
      if (attempt.providerStatus === "FAILURE") return result(intent, { providerId: attempt.providerId, providerStatus: "FAILURE" }, attempt);
      if (attempt.dispatchAuthorizedAt === null) {
        // DB-proved no dispatch: resume only the same still-current exact Submit, never an uncertain provider POST.
        await carrier.checkConfiguration(signal);
        const resumed = await store.resume(intent, signal);
        if (resumed.state !== "dispatch_allowed" || frozen(resumed.attempt) !== frozen(attempt)) return unknown(intent);
        return dispatch(intent, resumed, signal);
      }
      // After dispatch, current follow-up authority uses metadata only, even after raw-file/signature expiry.
      const observed = await carrier.reconcile(attempt, signal);
      const saved = await store.record(intent, observed.providerId, observed.providerStatus, signal);
      validateSnapDeliveryAttempt(intent, saved);
      if (frozen(saved) !== frozen(attempt)) throw new Error();
      signal.throwIfAborted(); return result(intent, observed, saved);
    } catch { return unknown(intent); }
  }
  async function dispatch(intent: SnapSenderIntent, reserved: { attempt: SnapSenderAttempt; envelope: SnapSenderEnvelope }, signal: AbortSignal): Promise<DeliveryResult> {
    let bytes: Uint8Array | undefined, key: Buffer | undefined, aad: Buffer | undefined;
    try {
      const attempt = carrier.validateAttempt(validateSnapDeliveryAttempt(intent, reserved.attempt));
      if (attempt.dispatchAuthorizedAt !== null || attempt.providerId !== null || attempt.providerStatus !== "UNKNOWN") throw new Error();
      const envelope = snapSenderEnvelopeSchema.parse(reserved.envelope), binding = envelope.binding, ref = intent.protectedPacket;
      if (binding.requestId !== intent.requestId || binding.requestVersion !== intent.requestVersion || binding.packetId !== ref.packetId
        || binding.authorizationId !== ref.authorizationId || binding.snapshotId !== ref.snapshotId || binding.snapshotHash !== ref.snapshotHash
        || binding.contentSha256 !== ref.contentSha256 || binding.byteLength !== ref.byteLength) throw new Error();
      aad = decode(envelope.aad, snapFinalPacketAad(binding).length);
      if (!aad.equals(Buffer.from(snapFinalPacketAad(binding)))) throw new Error();
      key = decode(envelope.keyBase64, 32);
      bytes = openSnapFinalPacket({ binding, iv: decode(envelope.iv, 12), tag: decode(envelope.tag, 16), ciphertext: decode(envelope.ciphertext, binding.byteLength) }, key, new Date());
      key.fill(0); key = undefined;
      const structure = await inspectSnapFinalPdf({ bytes, contentSha256: binding.contentSha256, byteLength: binding.byteLength,
        source: { templateId: binding.templateId, templateVersion: binding.templateVersion, templateSha256: binding.templateSha256 } },
      { signal, deadline: new Date(Date.now() + 10_000) });
      if (!structure.ok || structure.pageCount !== attempt.pageCount) throw new Error();
      const observed = await carrier.send(attempt, bytes, async () => {
        const current = carrier.validateAttempt(validateSnapDeliveryAttempt(intent, await store.recheck(intent, signal)));
        if (frozen(current) !== frozen(attempt) || current.dispatchAuthorizedAt === null || current.providerId !== null || current.providerStatus !== "UNKNOWN") throw new Error();
        signal.throwIfAborted(); return current;
      }, signal);
      let saved = await store.record(intent, observed.providerId, observed.providerStatus, signal);
      validateSnapDeliveryAttempt(intent, saved);
      if (frozen(saved) !== frozen(attempt) || !saved.providerId) return unknown(intent);
      if (saved.providerStatus === "FAILURE") return result(intent, observed, saved);
      // A POST acknowledgement alone does not publish success; read the exact carrier ID and persist it first.
      const confirmed = await carrier.reconcile(saved, signal);
      saved = await store.record(intent, confirmed.providerId, confirmed.providerStatus, signal);
      validateSnapDeliveryAttempt(intent, saved);
      if (frozen(saved) !== frozen(attempt)) throw new Error();
      signal.throwIfAborted(); return result(intent, confirmed, saved);
    } catch { return unknown(intent); }
    finally { bytes?.fill(0); key?.fill(0); aad?.fill(0); }
  }
  return {
    reconcile,
    async execute(input, signal) {
      const intent = snapSenderIntentSchema.parse(input);
      try {
        signal.throwIfAborted(); await carrier.checkConfiguration(signal);
        const reserved = await store.reserve(intent, signal);
        if (reserved.state === "reservation_unknown") return unknown(intent);
        if (reserved.state === "reconcile_only") return reconcile(intent, signal);
        return dispatch(intent, reserved, signal);
      } catch { return unknown(intent); }
    },
  };
}

/** Private metadata RPC only; it never returns an envelope, private bytes, carrier credentials or provider response bodies. */
export function createSnapProtectedSenderHandler(options: { origin: string; secret: string; delivery: SnapProtectedDelivery }) {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port
    || Number(origin.port) < 1024 || !/^[\x21-\x7e]{32,256}$/.test(options.secret)) throw new Error(SNAP_SENDER_ERROR);
  const secretHash = createHash("sha256").update(`Bearer ${options.secret}`).digest();
  const reply = (value: unknown, status: number) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  return async (request: Request): Promise<Response> => {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
    try {
      const url = new URL(request.url);
      if (!timingSafeEqual(secretHash, createHash("sha256").update(request.headers.get("authorization") ?? "").digest())) return reply({ error: SNAP_SENDER_ERROR }, 401);
      const length = request.headers.get("content-length");
      if (url.origin !== options.origin || request.headers.get("host") !== origin.host || url.search || url.hash || request.method !== "POST"
        || !["/snap/execute", "/snap/reconcile"].includes(url.pathname) || request.headers.has("origin") || request.headers.has("cookie")
        || request.headers.has("transfer-encoding") || request.headers.has("content-encoding")
        || !length || !/^[1-9][0-9]{0,3}$/.test(length) || Number(length) > 4096
        || [...request.headers].reduce((size, [name, value]) => size + name.length + value.length + 4, 0) > 16384) return reply({ error: SNAP_SENDER_ERROR }, 400);
      const parsed = snapSenderIntentSchema.safeParse(await readSnapSenderJson(request, 4096, signal));
      if (!parsed.success) return reply({ error: SNAP_SENDER_ERROR }, 400);
      const intent = parsed.data;
      const result = snapProtectedSubmissionResultSchema.parse(await boundedSnapSenderWork(signal, () =>
        url.pathname === "/snap/execute" ? options.delivery.execute(intent, signal) : options.delivery.reconcile(intent, signal)));
      if (result.operationId !== intent.operationId || result.packetId !== intent.protectedPacket.packetId || result.contentSha256 !== intent.protectedPacket.contentSha256) throw new Error();
      if ("receipt" in result && (result.receipt.state !== "sent" || result.receipt.source !== "provider_api")) throw new Error();
      return reply({ result }, "receipt" in result ? 200 : 202);
    } catch { return reply({ error: SNAP_SENDER_ERROR }, 503); }
  };
}
