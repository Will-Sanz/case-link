import { createHash } from "node:crypto";
import { z } from "zod";
import { utilityPreparationJobSchema, type UtilityPreparationJob } from "./utility-prepared-artifact-client";
import { utilityProtectedInputReferenceSchema } from "./utility-protected-input-contract";
import { listUtilityProtectedInputs, rebindUtilityProtectedInput, withUtilityProtectedDatabase, type UtilityProtectedOptions } from "./utility-protected-client";
import { validateStoredUtilityIncomeProof } from "./utility-protected-preparation";

const candidatesSchema = z.array(z.object({ reference: utilityProtectedInputReferenceSchema, originAuthorizationId: z.uuid() }).strict()).max(256);
const unavailable = () => new Error("Previously saved protected information needs a service check.");
function rebindId(origin: string, job: UtilityPreparationJob): string {
  const bytes = createHash("sha256").update(JSON.stringify(["utility-rebind-v1", origin, job.scope])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x80; bytes[8] = (bytes[8] & 63) | 0x80;
  const value = bytes.toString("hex"); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** Refreshes only metadata. Private source reuse is ordinary service work, independent of an open family page. */
export async function reuseUtilityProtectedInputs(input: unknown, sourceOptions: UtilityProtectedOptions): Promise<UtilityPreparationJob> {
  const initial = utilityPreparationJobSchema.parse(structuredClone(input));
  const job = { jobId: initial.jobId, leaseToken: initial.leaseToken, requestId: initial.scope.requestId, requestVersion: initial.scope.expectedVersion };
  if (sourceOptions.job && (sourceOptions.job.jobId !== job.jobId || sourceOptions.job.leaseToken !== job.leaseToken || sourceOptions.job.requestId !== job.requestId || sourceOptions.job.requestVersion !== job.requestVersion)) throw unavailable();
  const options: UtilityProtectedOptions = { ...sourceOptions, job };
  const target = async () => withUtilityProtectedDatabase(options, async session => {
    const result = await session.query("select parent_private.parent_get_utility_preparation_target($1,$2) value", [initial.jobId, initial.leaseToken]);
    if (result.rows.length !== 1) throw unavailable(); const next = utilityPreparationJobSchema.parse(result.rows[0].value);
    if (next.jobId !== initial.jobId || next.leaseToken !== initial.leaseToken || JSON.stringify(next.scope) !== JSON.stringify(initial.scope)) throw unavailable(); return next;
  });
  let current = await target();
  for (let count = 0; count <= 256; count++) {
    const { scope } = current;
    const candidates = await withUtilityProtectedDatabase(options, async session => {
      const result = await session.query("select parent_private.parent_get_utility_reuse_candidates($1,$2,$3,$4,$5,$6,$7,$8) value", [current.jobId, current.leaseToken,
        scope.requestId, scope.expectedVersion, scope.programId, scope.snapshotId, scope.snapshotRevision, scope.snapshotHash]);
      if (result.rows.length !== 1) throw unavailable(); return candidatesSchema.parse(result.rows[0].value);
    });
    const candidate = candidates.sort((a, b) => Number(b.reference.purpose === "account_access") - Number(a.reference.purpose === "account_access"))[0];
    if (!candidate) return target();
    if (count === 256) throw unavailable();
    const old = candidate.reference;
    if (old.requestId !== scope.requestId || old.programId !== scope.programId || !["stored", "superseded"].includes(old.state) || Date.parse(old.expiresAt) <= Date.now()) throw unavailable();
    const inputId = rebindId(candidate.originAuthorizationId, current);
    const saved = await rebindUtilityProtectedInput(old.inputId, inputId, scope, options);
    const reference = saved.state === "stored" ? saved.reference : (await listUtilityProtectedInputs(scope, options)).find(ref => ref.inputId === inputId);
    if (!reference || reference.inputId !== inputId || reference.state !== "stored" || reference.consentedAt !== old.consentedAt || Date.parse(reference.expiresAt) > Date.parse(old.expiresAt)) throw unavailable();
    if (reference.purpose === "income_proof") await validateStoredUtilityIncomeProof(inputId, options);
    current = await target();
  }
  throw unavailable();
}
