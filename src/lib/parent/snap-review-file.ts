import { snapProtectedOperationSchema } from "./snap-protected-operation";
import { snapPacketAuthorizationResultSchema, type SnapFinalizerIntent } from "./snap-packet-contract";

export const SNAP_REVIEW_FILE_ERROR = "The exact application could not be loaded for review. Check access and try again before choosing Submit.";

export async function loadSnapReviewFile(input: unknown, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const review = snapProtectedOperationSchema.safeParse(input);
  if (!review.success) throw new Error(SNAP_REVIEW_FILE_ERROR);
  return loadBoundSnapReviewFile({ ...review.data.packet.protectedSnapPacket, requestId: review.data.requestId, requestVersion: review.data.requestVersion }, signal);
}

/** A stored candidate can be reviewed before a Submit operation exists. Server access checks remain authoritative. */
export async function loadSnapPacketReviewFile(input: unknown, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const authorization = snapPacketAuthorizationResultSchema.safeParse(input);
  if (!authorization.success || authorization.data.state !== "stored" || Date.parse(authorization.data.consentedAt) > Date.now()
    || Date.parse(authorization.data.authorizationExpiresAt) <= Date.now()) throw new Error(SNAP_REVIEW_FILE_ERROR);
  const bytes = await loadBoundSnapReviewFile(authorization.data.intent, signal);
  if (Date.parse(authorization.data.authorizationExpiresAt) <= Date.now()) { bytes.fill(0); throw new Error(SNAP_REVIEW_FILE_ERROR); }
  return bytes;
}

/** Browser memory only. The caller must clear returned bytes after creating its local PDF viewer. */
async function loadBoundSnapReviewFile(ref: Pick<SnapFinalizerIntent, "requestId" | "requestVersion" | "packetId" | "byteLength" | "contentSha256">,
  signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, bytes: Uint8Array<ArrayBuffer> | undefined;
  let body: ReadableStream<Uint8Array> | null = null;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = () => { rejectAbort(new Error(SNAP_REVIEW_FILE_ERROR)); void reader?.cancel().catch(() => {}); };
  bounded.addEventListener("abort", stop, { once: true });
  try {
    bounded.throwIfAborted();
    const response = await Promise.race([fetch(`/protected/snap/requests/${ref.requestId}/packets/${ref.packetId}?expectedVersion=${ref.requestVersion}`, {
      credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/pdf" }, signal: bounded,
    }).then(response => {
      if (bounded.aborted) { void response.body?.cancel().catch(() => {}); throw new Error(SNAP_REVIEW_FILE_ERROR); }
      return response;
    }), aborted]);
    body = response.body;
    if (!response.ok || response.redirected || response.headers.get("content-type") !== "application/pdf"
      || response.headers.get("content-length") !== String(ref.byteLength) || !response.body) throw new Error(SNAP_REVIEW_FILE_ERROR);
    reader = response.body.getReader(); let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read().then(result => {
        if (bounded.aborted) { result.value?.fill(0); throw new Error(SNAP_REVIEW_FILE_ERROR); }
        return result;
      }), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > ref.byteLength) { value.fill(0); throw new Error(SNAP_REVIEW_FILE_ERROR); }
      chunks.push(value);
    }
    if (size !== ref.byteLength) throw new Error(SNAP_REVIEW_FILE_ERROR);
    bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    bounded.throwIfAborted();
    if (digest !== ref.contentSha256) throw new Error(SNAP_REVIEW_FILE_ERROR);
    return bytes;
  } catch { bytes?.fill(0); throw new Error(SNAP_REVIEW_FILE_ERROR); }
  finally {
    bounded.removeEventListener("abort", stop);
    if (reader) void reader.cancel().catch(() => {});
    else void body?.cancel().catch(() => {});
    for (const chunk of chunks) chunk.fill(0);
  }
}
