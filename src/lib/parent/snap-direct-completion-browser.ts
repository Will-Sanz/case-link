import { z } from "zod";
import { parseSnapDirectCompletionInputs, snapDirectCompletionResultSchema, type SnapDirectCompletionResult } from "./snap-direct-completion-core";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";

export const SNAP_DIRECT_COMPLETION_ERROR = "The application candidate could not be completed. Check the current application and protected entries.";
const replySchema = z.object({ ok: z.literal(true), result: snapDirectCompletionResultSchema }).strict();
const wipe = (value?: Uint8Array) => { if (value?.byteLength) value.fill(0); };
type Inputs = Extract<ReturnType<typeof parseSnapDirectCompletionInputs>, { ok: true }>;

function completeInWorker(unsigned: Uint8Array, input: Inputs, now: Date, signal?: AbortSignal): Promise<SnapDirectCompletionResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./snap-direct-completion-worker.ts", import.meta.url), { type: "module" });
    let finished = false, received = false, pending: Uint8Array<ArrayBuffer> | undefined;
    const finish = (result?: SnapDirectCompletionResult) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
      wipe(pending); pending = undefined;
      if (result) resolve(result); else reject(new Error());
    };
    const abort = () => finish(), timer = setTimeout(abort, 10000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(); };
    worker.onmessageerror = () => finish();
    worker.onmessage = async event => {
      try {
        if (finished || received) return;
        received = true;
        const parsed = replySchema.safeParse(event.data);
        if (!parsed.success) { finish(); return; }
        const result = parsed.data.result;
        if (!result.bytes) { finish(result); return; }
        if (result.byteLength !== result.bytes.length || result.readiness.requestId !== input.trusted.requestId
          || result.readiness.unsignedContentSha256 !== input.trusted.unsignedContentSha256
          || [...result.readiness.outstandingIdentifierSubjectIds].sort().join() !== input.completion.identifiers
            .filter(identifier => identifier.kind === "provide_to_agency_later").map(identifier => identifier.personId).sort().join()
          || JSON.stringify(result.readiness.context) !== JSON.stringify(input.trusted.context)) { finish(); return; }
        pending = Uint8Array.from(result.bytes);
        wipe(result.bytes);
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", pending))].map(value => value.toString(16).padStart(2, "0")).join("");
        if (finished) return;
        if (digest !== result.contentSha256) { finish(); return; }
        const bytes = pending; pending = undefined;
        finish({ ...result, bytes });
      } catch { finish(); }
      finally {
        const bytes = event.data?.result?.bytes;
        if (bytes instanceof Uint8Array) wipe(bytes);
      }
    };
    if (signal?.aborted) { finish(); return; }
    // Clone private inputs into one fresh worker; transfer only its owned output back.
    try { worker.postMessage({ unsigned, trusted: input.trusted, completion: input.completion, now: now.toISOString() }); }
    catch { finish(); }
  });
}

/** Private browser memory only. This candidate does not establish authority, signature acceptance or submission readiness. */
export async function completeSnapDirectCompletionInBrowser(unsignedInput: Uint8Array, trustedInput: unknown, completionInput: unknown, now: Date,
  options: { signal?: AbortSignal } = {}): Promise<SnapDirectCompletionResult> {
  let unsigned: Uint8Array | undefined;
  try {
    if (options.signal?.aborted) throw new Error();
    const input = parseSnapDirectCompletionInputs(trustedInput, completionInput, now);
    if (!input.ok) return input.result;
    if (!(unsignedInput instanceof Uint8Array) || !unsignedInput.length || unsignedInput.length > MAX_SNAP_PACKET_BYTES) throw new Error();
    unsigned = Uint8Array.from(unsignedInput);
    return await completeInWorker(unsigned, input, new Date(now.getTime()), options.signal);
  } catch { throw new Error(SNAP_DIRECT_COMPLETION_ERROR); }
  finally { wipe(unsigned); }
}
