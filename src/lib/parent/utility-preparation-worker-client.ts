import { utilityPreparationJobSchema } from "./utility-preparation-port";
import { utilityProtectedPreparationResultSchema, utilityPreparationMatchesJob, UTILITY_PREPARATION_SERVICE_ERROR, type UtilityProtectedPreparationPort } from "./utility-preparation-port";
import { boundedSnapSenderWork, readSnapSenderJson } from "./snap-sender-http";

/** Metadata only. Documents, identifiers, private database credentials and raw answers never enter the worker. */
export function createUtilityProtectedPreparationClient(options: { origin: string; secret: string; fetcher?: typeof fetch }): UtilityProtectedPreparationPort {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || Number(origin.port) < 1024 || !/^[\x21-\x7e]{32,256}$/.test(options.secret))
    throw new Error(UTILITY_PREPARATION_SERVICE_ERROR);
  return { async prepare(input) {
    try {
      const { signal: caller, ...metadata } = input, job = utilityPreparationJobSchema.parse(metadata);
      const signal = AbortSignal.any([caller, AbortSignal.timeout(30_000)]);
      const response = await boundedSnapSenderWork(signal, () => (options.fetcher ?? fetch)(`${origin.origin}/utility/prepare`, {
        method: "POST", redirect: "error", cache: "no-store", signal,
        headers: { Authorization: `Bearer ${options.secret}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(job),
      }));
      if (![200, 202].includes(response.status) || response.redirected || response.url && new URL(response.url).origin !== origin.origin) {
        void response.body?.cancel().catch(() => {}); throw new Error();
      }
      const value = await readSnapSenderJson(response, 65536, signal);
      const result = utilityProtectedPreparationResultSchema.parse(value);
      if (response.status === 202 ? result.state !== "commit_unknown" : result.state === "commit_unknown") throw new Error();
      if (result.state === "prepared" && !utilityPreparationMatchesJob(result.operation, job)) throw new Error();
      signal.throwIfAborted(); return result;
    } catch { throw new Error(UTILITY_PREPARATION_SERVICE_ERROR); }
  } };
}
