import { z } from "zod";
import { parseSnapDirectCompletionInputs } from "./snap-direct-completion-core";
import { snapPacketAuthorizationResultSchema, snapPacketAuthorizationScopeSchema, type SnapPacketAuthorizationResult } from "./snap-packet-contract";

export const SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR = "The protected application data could not be prepared for storage. Check the current application and protected entries.";
const scopeSchema = snapPacketAuthorizationScopeSchema.extend({
  ownerId: snapPacketAuthorizationScopeSchema.shape.packetId, requestId: snapPacketAuthorizationScopeSchema.shape.packetId,
}).strict();
export type SnapDirectCompletionTransportScope = z.infer<typeof scopeSchema>;
const replySchema = z.object({ state: z.enum(["stored", "storage_unconfirmed"]), packetId: scopeSchema.shape.packetId }).strict();
export type SnapDirectCompletionStorageResult = z.infer<typeof replySchema>;
const wipe = (bytes?: Uint8Array) => { if (bytes?.byteLength) bytes.fill(0); };

function metadata(scopeInput: unknown, authorizationInput: unknown) {
  const scope = scopeSchema.parse(scopeInput), authorization = snapPacketAuthorizationResultSchema.parse(authorizationInput), intent = authorization.intent;
  if (intent.ownerId !== scope.ownerId || intent.requestId !== scope.requestId || intent.requestVersion !== scope.expectedVersion
    || intent.packetId !== scope.packetId || intent.snapshotId !== scope.snapshotId || intent.snapshotHash !== scope.snapshotHash
    || Date.parse(authorization.consentedAt) > Date.now() || Date.parse(authorization.authorizationExpiresAt) <= Date.now()) throw new Error();
  return { scope, authorization };
}

async function exchange(scope: SnapDirectCompletionTransportScope, authorization: SnapPacketAuthorizationResult,
  method: "POST" | "GET", body?: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<SnapDirectCompletionStorageResult> {
  const unconfirmed: SnapDirectCompletionStorageResult = { state: "storage_unconfirmed", packetId: scope.packetId };
  const timeout = new AbortController(), bounded = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, responseBody: ReadableStream<Uint8Array> | null = null;
  let bytes: Uint8Array | undefined, rejectAbort!: (error: Error) => void;
  const chunks: Uint8Array[] = [], aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const stop = () => { wipe(body); rejectAbort(new Error()); void reader?.cancel().catch(() => {}); };
  const timer = setTimeout(() => timeout.abort(), 30000);
  bounded.addEventListener("abort", stop, { once: true });
  try {
    bounded.throwIfAborted();
    if (Date.parse(authorization.authorizationExpiresAt) <= Date.now()) throw new Error();
    const response = await Promise.race([fetch(`/protected/snap/requests/${scope.requestId}/packets/${scope.packetId}/direct-completion?expectedVersion=${scope.expectedVersion}`, {
      method, body, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) }, signal: bounded,
    }).then(response => {
      wipe(body);
      if (bounded.aborted) { void response.body?.cancel().catch(() => {}); throw new Error(); }
      return response;
    }), aborted]);
    responseBody = response.body;
    const length = response.headers.get("content-length");
    if (response.redirected || ![200, ...(method === "POST" ? [201] : []), 202].includes(response.status)
      || response.headers.get("content-type") !== "application/json" || !response.body
      || (length !== null && (!/^[1-9][0-9]{0,3}$/.test(length) || Number(length) > 1024))) throw new Error();
    reader = response.body.getReader(); let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read().then(result => {
        if (bounded.aborted) { wipe(result.value); throw new Error(); }
        return result;
      }), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { wipe(value); throw new Error(); }
      chunks.push(value);
    }
    if (length !== null && size !== Number(length)) throw new Error();
    bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result = replySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    bounded.throwIfAborted();
    if (result.packetId !== scope.packetId || Date.parse(authorization.authorizationExpiresAt) <= Date.now()
      || (result.state === "stored" ? ![200, ...(method === "POST" ? [201] : [])].includes(response.status) : response.status !== 202)) throw new Error();
    return result;
  } catch { return unconfirmed; }
  finally {
    clearTimeout(timer); bounded.removeEventListener("abort", stop);
    if (reader) void reader.cancel().catch(() => {}); else void responseBody?.cancel().catch(() => {});
    wipe(body); wipe(bytes); for (const chunk of chunks) wipe(chunk);
  }
}

/** One explicit private upload, including a stored replay. Only the isolated server can verify construction. */
export async function sendSnapDirectCompletion(scopeInput: unknown, authorizationInput: unknown, trustedInput: unknown, completionInput: unknown,
  options: { signal?: AbortSignal } = {}): Promise<SnapDirectCompletionStorageResult> {
  let body: Uint8Array<ArrayBuffer> | undefined;
  try {
    const { scope, authorization } = metadata(scopeInput, authorizationInput);
    const input = parseSnapDirectCompletionInputs(trustedInput, completionInput, new Date()), intent = authorization.intent;
    if (!input.ok || input.trusted.requestId !== intent.requestId || input.trusted.context.requestVersion !== intent.requestVersion
      || input.trusted.context.snapshotId !== intent.snapshotId || input.trusted.context.snapshotHash !== intent.snapshotHash
      || input.trusted.context.source.templateId !== intent.templateId || input.trusted.context.source.templateVersion !== intent.templateVersion
      || input.trusted.context.source.templateSha256 !== intent.templateSha256
      || [...input.trusted.context.applyingSubjectIds].sort().join() !== [...authorization.subjectIds].sort().join()) throw new Error();
    // Owned UTF-8 bytes are cleared; immutable JavaScript strings and caller-owned entries cannot be erased here.
    body = new TextEncoder().encode(JSON.stringify(input.completion));
    if (!body.length || body.length > 256 * 1024) throw new Error();
    return await exchange(scope, authorization, "POST", body, options.signal);
  } catch { throw new Error(SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR); }
  finally { wipe(body); }
}

/** Recover only this known intent. An unknown result never authorizes another POST or proves absence. */
export async function recoverSnapDirectCompletion(scopeInput: unknown, authorizationInput: unknown,
  options: { signal?: AbortSignal } = {}): Promise<SnapDirectCompletionStorageResult> {
  try {
    const { scope, authorization } = metadata(scopeInput, authorizationInput);
    return await exchange(scope, authorization, "GET", undefined, options.signal);
  } catch { throw new Error(SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR); }
}
