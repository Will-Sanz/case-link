import { SNAP_SENDER_ERROR } from "./snap-sender-contract";

/** Bound headers and response-body waits, including transports that ignore cancellation. */
export async function boundedSnapSenderWork<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => { abort = () => reject(new Error(SNAP_SENDER_ERROR)); });
  signal.addEventListener("abort", abort, { once: true });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }), stopped]); }
  finally { signal.removeEventListener("abort", abort); }
}

export async function readSnapSenderJson(source: Pick<Response, "headers" | "body">, maximum: number, signal: AbortSignal): Promise<unknown> {
  const length = source.headers.get("content-length");
  if (!source.body || source.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
    || (length !== null && (!/^[1-9][0-9]*$/.test(length) || Number(length) > maximum))) {
    void source.body?.cancel().catch(() => {}); throw new Error(SNAP_SENDER_ERROR);
  }
  const reader = source.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, bytes: Uint8Array | undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const part = await boundedSnapSenderWork(signal, () => reader.read());
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { part.value.fill(0); throw new Error(SNAP_SENDER_ERROR); }
      chunks.push(part.value);
    }
    if (length !== null && size !== Number(length)) throw new Error(SNAP_SENDER_ERROR);
    bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    signal.removeEventListener("abort", cancel); cancel();
    bytes?.fill(0); for (const chunk of chunks) chunk.fill(0);
  }
}
