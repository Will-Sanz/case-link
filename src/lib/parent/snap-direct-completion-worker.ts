import { z } from "zod";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";
import type { SnapDirectCompletionResult } from "./snap-direct-completion-core";

const inputSchema = z.object({
  unsigned: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= MAX_SNAP_PACKET_BYTES),
  trusted: z.unknown(), completion: z.unknown(), now: z.iso.datetime({ precision: 3 }),
}).strict();
const wipe = (value?: Uint8Array) => { if (value?.byteLength) value.fill(0); };
const scope = globalThis as typeof globalThis & {
  postMessage?: (message: unknown, transfer: Transferable[]) => void;
  onmessage?: ((event: MessageEvent<unknown>) => void) | null;
  close?: () => void;
};
if (typeof window === "undefined" && typeof scope.postMessage === "function") {
  // This worker has one private task; suppress parser diagnostics before importing the rendering core.
  let diagnostic = false;
  for (const name of ["log", "warn", "error", "info", "debug"] as const) console[name] = () => { diagnostic = true; };
  scope.onmessage = async event => {
    scope.onmessage = null;
    let result: SnapDirectCompletionResult | undefined;
    const input = inputSchema.safeParse(event.data);
    try {
      if (!input.success) throw new Error();
      const { completeSnapDirectCompletionCopy } = await import("./snap-direct-completion-core");
      result = await completeSnapDirectCompletionCopy(input.data.unsigned, input.data.trusted, input.data.completion, new Date(input.data.now));
      if (diagnostic) throw new Error();
      scope.postMessage!({ ok: true, result }, result.bytes ? [result.bytes.buffer as ArrayBuffer] : []);
    } catch { scope.postMessage!({ ok: false }, []); }
    finally {
      wipe(result?.bytes ?? undefined);
      if (input.success) wipe(input.data.unsigned);
      scope.close?.();
    }
  };
}
