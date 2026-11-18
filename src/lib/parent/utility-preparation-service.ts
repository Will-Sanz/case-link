import { createHash, timingSafeEqual } from "node:crypto";
import { utilityPreparationJobSchema, storeUtilityPreparedArtifact, type UtilityPreparedRenderer } from "./utility-prepared-artifact-client";
import { getUtilityProtectedApplicationContext, listUtilityProtectedInputs, validateUtilityProtectedConnection, withUtilityProtectedDatabase, type UtilityProtectedOptions } from "./utility-protected-client";
import { utilityProtectedOperationSchema } from "./utility-protected-operation";
import { utilityProtectedPreparationResultSchema, utilityPreparationMatchesJob, UTILITY_PREPARATION_SERVICE_ERROR, UTILITY_PREPARATION_SOURCE_UNAVAILABLE } from "./utility-preparation-port";
import { reuseUtilityProtectedInputs } from "./utility-protected-reuse";
import { validateStoredUtilityIncomeProof } from "./utility-protected-preparation";
import { UTILITY_INCOME_PROOF_VERSION } from "./utility-income-proof";
import { boundedSnapSenderWork, readSnapSenderJson } from "./snap-sender-http";

/** Closed local test service. A worker's exact live job lease replaces any browser session; no provider transport exists here. */
export function createUtilityPreparationHandler(config: { origin: string; secret: string; utilityDatabaseUrl: string }, render: UtilityPreparedRenderer) {
  const origin = new URL(config.origin), target = validateUtilityProtectedConnection(config.utilityDatabaseUrl);
  if (origin.origin !== config.origin || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || Number(origin.port) < 1024 || !target.local ||
    new URL(config.utilityDatabaseUrl).hostname !== "127.0.0.1" || !/^[\x21-\x7e]{32,256}$/.test(config.secret)) throw new Error(UTILITY_PREPARATION_SERVICE_ERROR);
  const secret = createHash("sha256").update(`Bearer ${config.secret}`).digest();
  return async (request: Request): Promise<Response> => {
    const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]), options: UtilityProtectedOptions = { connectionString: config.utilityDatabaseUrl, signal, deadline: new Date(Date.now() + 25_000) };
    let prepared: Awaited<ReturnType<UtilityPreparedRenderer>> = null;
    try {
      if (!timingSafeEqual(secret, createHash("sha256").update(request.headers.get("authorization") ?? "").digest())) return reply({ error: UTILITY_PREPARATION_SERVICE_ERROR }, 401);
      const url = new URL(request.url), length = request.headers.get("content-length");
      if (url.origin !== config.origin || request.headers.get("host") !== origin.host || url.pathname !== "/utility/prepare" || url.search || url.hash || request.method !== "POST" ||
        request.headers.has("cookie") || request.headers.has("origin") || request.headers.has("transfer-encoding") || request.headers.has("content-encoding") ||
        [...request.headers.keys()].some(name => name === "forwarded" || name.startsWith("x-forwarded-")) || !length || !/^[1-9][0-9]{0,3}$/.test(length) || Number(length) > 2048 ||
        [...request.headers].reduce((size, [name, value]) => size + name.length + value.length + 4, 0) > 16384) return reply({ error: UTILITY_PREPARATION_SERVICE_ERROR }, 400);
      const parsed = utilityPreparationJobSchema.safeParse(await readSnapSenderJson(request, 2048, signal));
      if (!parsed.success) return reply({ error: UTILITY_PREPARATION_SERVICE_ERROR }, 400);
      options.job = { jobId: parsed.data.jobId, leaseToken: parsed.data.leaseToken, requestId: parsed.data.scope.requestId, requestVersion: parsed.data.scope.expectedVersion };
      const job = await reuseUtilityProtectedInputs(parsed.data, options);
      const existing = await withUtilityProtectedDatabase(options, async session => {
        const result = await session.query("select parent_private.parent_find_utility_prepared_operation($1,$2,$3) value", [job.jobId, job.leaseToken, job.inputSetHash]);
        if (result.rows.length !== 1) throw new Error(); return result.rows[0].value === null ? null : utilityProtectedOperationSchema.parse(result.rows[0].value);
      });
      if (existing) {
        if (!utilityPreparationMatchesJob(existing, job)) throw new Error();
        return reply(utilityProtectedPreparationResultSchema.parse({ state: "prepared", operation: existing }));
      }
      let references = await listUtilityProtectedInputs(job.scope, options);
      for (const reference of references.filter(ref => ref.purpose === "income_proof" && (ref.validation?.validatorVersion !== UTILITY_INCOME_PROOF_VERSION || Date.parse(ref.validation.expiresAt) <= Date.now()))) {
        try { await validateStoredUtilityIncomeProof(reference.inputId, options); }
        catch { return reply({ state: "service_blocked", reason: "protected_inputs_unresolved" }); }
      }
      const fresh = await reuseUtilityProtectedInputs(job, options);
      const context = await getUtilityProtectedApplicationContext(fresh.scope, options);
      references = await listUtilityProtectedInputs(fresh.scope, options);
      prepared = await boundedSnapSenderWork(signal, () => {
        const rendering = render({ context, references, options });
        void rendering.then(result => { if (signal.aborted && result?.bytes instanceof Uint8Array) result.bytes.fill(0); }, () => {});
        return rendering;
      });
      if (!prepared) return reply({ state: "service_blocked", reason: "missing_preparation_answers" });
      const result = utilityProtectedPreparationResultSchema.parse(await storeUtilityPreparedArtifact(fresh, prepared, options));
      if (result.state === "prepared" && !utilityPreparationMatchesJob(result.operation, fresh)) throw new Error();
      signal.throwIfAborted(); return reply(result, result.state === "commit_unknown" ? 202 : 200);
    } catch (error) {
      if (error instanceof Error && error.message === UTILITY_PREPARATION_SOURCE_UNAVAILABLE) return reply({ state: "service_blocked", reason: "source_unavailable" });
      return reply({ error: UTILITY_PREPARATION_SERVICE_ERROR }, 503);
    }
    finally { prepared?.bytes.fill(0); }
  };
}
