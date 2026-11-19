import { z } from "zod";
import { canonicalProjectOrigin, isLoopbackHost } from "./project-origin";
import { snapProtectedSubmissionResultSchema, type SnapProtectedSubmissionIntent, type SnapProtectedSubmissionPort } from "./snap-protected-submission-port";
import { snapSenderIntentSchema, SNAP_SENDER_ERROR } from "./snap-sender-contract";
import { boundedSnapSenderWork, readSnapSenderJson } from "./snap-sender-http";

const replySchema = z.object({ result: snapProtectedSubmissionResultSchema }).strict();

/** Metadata-only private RPC. PDF bytes and carrier/database credentials never enter this worker. */
export function createSnapProtectedSubmissionClient(options: { origin: string; secret: string; fetcher?: typeof fetch }): SnapProtectedSubmissionPort {
  const origin = canonicalProjectOrigin(options.origin);
  if (!origin || origin !== options.origin || !/^[\x21-\x7e]{32,256}$/.test(options.secret)
    || (new URL(origin).protocol !== "https:" && !isLoopbackHost(new URL(origin).hostname))) throw new Error(SNAP_SENDER_ERROR);
  const fetcher = options.fetcher ?? fetch;
  async function exchange(input: SnapProtectedSubmissionIntent, action: "execute" | "reconcile") {
    try {
      const { signal: caller, ...metadata } = input, intent = snapSenderIntentSchema.parse(metadata);
      const signal = AbortSignal.any([caller, AbortSignal.timeout(55_000)]);
      signal.throwIfAborted();
      const response = await boundedSnapSenderWork(signal, () => fetcher(`${origin}/snap/${action}`, {
        method: "POST", redirect: "error", cache: "no-store", signal,
        headers: { Authorization: `Bearer ${options.secret}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      }));
      if (![200, 202].includes(response.status) || response.redirected || (response.url && new URL(response.url).origin !== origin)) {
        void response.body?.cancel().catch(() => {}); throw new Error();
      }
      const { result } = replySchema.parse(await readSnapSenderJson(response, 2048, signal));
      if (result.operationId !== intent.operationId || result.packetId !== intent.protectedPacket.packetId
        || result.contentSha256 !== intent.protectedPacket.contentSha256
        || ("receipt" in result ? response.status !== 200 : response.status !== 202)) throw new Error();
      signal.throwIfAborted(); return result;
    } catch { throw new Error(SNAP_SENDER_ERROR); }
  }
  return {
    execute: input => exchange(input, "execute"),
    // This internal metadata RPC may POST; the isolated carrier reconciliation performs GETs only.
    async reconcile(input) { try { return await exchange(input, "reconcile"); } catch { return null; } },
  };
}
