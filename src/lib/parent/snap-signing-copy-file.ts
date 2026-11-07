import { z } from "zod";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";
import { mandateSchema } from "./domain";
import { snapCaptureContextSchema } from "./snap-capture-context";
import { assessSnapApplicationSnapshot, snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";
import type { SnapDirectCompletionContext } from "./snap-direct-completion-core";

export const SNAP_SIGNING_COPY_FILE_ERROR = "The prepared application could not be loaded. Check the current application and permission before continuing.";
const inputSchema = z.object({
  requestId: z.uuid().transform(value => value.toLowerCase()), requestVersion: snapCaptureContextSchema.shape.requestVersion,
  status: z.literal("active"), mandate: mandateSchema, context: snapCaptureContextSchema, snapshot: snapApplicationSnapshotSchema,
}).strict();
export type SnapSigningCopyFileInput = z.input<typeof inputSchema>;

/** Nonprotected preparation only. The caller owns returned bytes and must clear them after use. */
export async function loadSnapSigningCopyFile(input: unknown, signal: AbortSignal): Promise<{
  bytes: Uint8Array<ArrayBuffer>; trusted: SnapDirectCompletionContext;
}> {
  const chunks: Uint8Array[] = [];
  let bytes: Uint8Array<ArrayBuffer> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let body: ReadableStream<Uint8Array> | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new AbortController(), bounded = AbortSignal.any([signal, deadline.signal]);
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = () => { bytes?.fill(0); rejectAbort(new Error(SNAP_SIGNING_COPY_FILE_ERROR)); void reader?.cancel().catch(() => {}); };
  bounded.addEventListener("abort", stop, { once: true });
  try {
    bounded.throwIfAborted();
    const value = inputSchema.parse(input), { context, snapshot, mandate } = value;
    // The snapshot's custom source schema does not copy this object.
    snapshot.source = { ...snapshot.source };
    const preparedAt = new Date(snapshot.created_at).toISOString();
    const current = () => {
      bounded.throwIfAborted();
      const now = new Date();
      if (Date.parse(mandate.expiresAt) <= now.getTime() || Date.parse(source.verifiedUntil) <= now.getTime()
        || Date.parse(preparedAt) > now.getTime() || !assessSnapApplicationSnapshot(snapshot, now).readiness.nonProtectedDataReadyForReview) throw new Error();
    };
    if (context.requestVersion !== value.requestVersion || snapshot.request_id.toLowerCase() !== value.requestId
      || snapshot.id.toLowerCase() !== context.snapshotId || snapshot.request_version > value.requestVersion
      || !Object.entries(context.source).every(([key, expected]) => snapshot.source[key as keyof typeof snapshot.source] === expected)
      || [...context.applyingSubjectIds].sort().join() !== (snapshot.details.household ?? []).filter(person => person.requestingSnap).map(person => person.id.toLowerCase()).sort().join()
      || !mandate.recipientIds.includes("snap-pa") || !mandate.allowedActions.includes("prepare")
      || !mandate.allowedData.includes("household") || !mandate.allowedData.includes("income")) throw new Error();
    current();
    timer = setTimeout(() => deadline.abort(), Math.min(30_000, Date.parse(mandate.expiresAt) - Date.now(), Date.parse(source.verifiedUntil) - Date.now()));
    const query = new URLSearchParams({ expectedVersion: String(value.requestVersion), snapshotId: context.snapshotId });
    const response = await Promise.race([fetch(`/api/parent/requests/${value.requestId}/snap-signing-copy?${query}`, {
      credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { Accept: "application/pdf" }, signal: bounded,
    }).then(response => {
      if (bounded.aborted) { void response.body?.cancel().catch(() => {}); throw new Error(); }
      return response;
    }), aborted]);
    body = response.body;
    // Next strips transport Content-Length; this descriptor counts the decoded PDF bytes.
    const length = response.headers.get("x-caselink-snap-unsigned-byte-length"), hash = response.headers.get("x-caselink-snap-unsigned-sha256");
    if (response.status !== 200 || response.redirected || response.headers.get("content-type") !== "application/pdf" || !body
      || !length || !/^[1-9][0-9]{0,7}$/.test(length) || Number(length) > MAX_SNAP_PACKET_BYTES
      || !hash || !/^[a-f0-9]{64}$/.test(hash) || response.headers.get("x-caselink-snap-prepared-at") !== preparedAt) throw new Error();
    current();
    reader = body.getReader(); let size = 0;
    for (;;) {
      const { done, value: chunk } = await Promise.race([reader.read().then(result => {
        if (bounded.aborted) { result.value?.fill(0); throw new Error(); }
        return result;
      }), aborted]);
      if (done) break;
      size += chunk.byteLength;
      if (size > Number(length)) { chunk.fill(0); throw new Error(); }
      chunks.push(chunk);
    }
    if (size !== Number(length)) throw new Error();
    bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = await Promise.race([crypto.subtle.digest("SHA-256", bytes), aborted]);
    if ([...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("") !== hash) throw new Error();
    current();
    return { bytes, trusted: { requestId: value.requestId, context, snapshot, preparedAt, unsignedContentSha256: hash } };
  } catch { bytes?.fill(0); throw new Error(SNAP_SIGNING_COPY_FILE_ERROR); }
  finally {
    clearTimeout(timer); bounded.removeEventListener("abort", stop);
    if (reader) void reader.cancel().catch(() => {}); else void body?.cancel().catch(() => {});
    for (const chunk of chunks) chunk.fill(0);
  }
}
