import { createHash } from "node:crypto";
import { utilityPreparationJobSchema, type UtilityPreparationJob } from "./utility-preparation-port";
import { z } from "zod";
import { withUtilityProtectedDatabase, decodeUtilityProtectedBase64 as decode, type UtilityProtectedOptions, type UtilityProtectedApplicationContext, type UtilityProtectedDatabaseSession } from "./utility-protected-client";
import { type UtilityProtectedScope, type UtilityProtectedInputReference } from "./utility-protected-input-contract";
import { MAX_UTILITY_PREPARED_BYTES, utilityPreparedAad, utilityPreparedBindingSchema, utilityPreparedInputBindingSchema, utilityProtectedOperationSchema, sameUtilityProtectedOperationBinding, type UtilityProtectedOperation, type UtilityPreparedBinding } from "./utility-protected-operation";
import { sealUtilityPreparedArtifact, openUtilityPreparedArtifact, UTILITY_PREPARED_ARTIFACT_ERROR } from "./utility-prepared-artifact";

const uuid = z.uuid(), version = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
export const utilityPreparedSourceSchema = z.object({ kind: z.enum(["official_public_form", "local_test_issued_form"]), id: version, version,
  sha256: z.string().regex(/^[a-f0-9]{64}$/), rendererVersion: version }).strict();
export const utilityPreparedBuildMetadataSchema = z.object({
  inputs: z.array(utilityPreparedInputBindingSchema).max(256).refine(inputs => new Set(inputs.map(input => input.inputId)).size === inputs.length)
    .transform(inputs => [...inputs].sort((a, b) => a.inputId.localeCompare(b.inputId))),
  source: utilityPreparedSourceSchema, expiresAt: z.iso.datetime({ offset: true }),
}).strict();
export type UtilityPreparedRendererOutput = z.infer<typeof utilityPreparedBuildMetadataSchema> & { bytes: Uint8Array };
export type UtilityPreparedRenderer = (input: { context: UtilityProtectedApplicationContext; references: UtilityProtectedInputReference[]; options: UtilityProtectedOptions }) => Promise<UtilityPreparedRendererOutput | null>;
export { utilityPreparationJobSchema, type UtilityPreparationJob } from "./utility-preparation-port";
export type UtilityPreparedStoreResult = { state: "prepared"; operation: UtilityProtectedOperation } | { state: "commit_unknown"; packetId: string; operationId: string };
const unavailable = () => new Error(UTILITY_PREPARED_ARTIFACT_ERROR);
const envelopeSchema = z.object({ binding: utilityPreparedBindingSchema, keyBase64: z.unknown(), aad: z.unknown(), iv: z.unknown(), tag: z.unknown(), ciphertext: z.unknown() }).strict();
const beginSchema = envelopeSchema.extend({ state: z.enum(["pending", "stored"]) });
function row(value: { rows: Record<string, unknown>[] }): unknown { if (value.rows.length !== 1) throw unavailable(); return value.rows[0].value; }
function matches(binding: UtilityPreparedBinding, scope: UtilityProtectedScope, spec: z.infer<typeof utilityPreparedBuildMetadataSchema>, bytes: Uint8Array) {
  const operation = binding.operation, reference = operation.packet.protectedUtilityPacket;
  if (operation.requestId !== scope.requestId || operation.requestVersion !== scope.expectedVersion || operation.programId !== scope.programId ||
    reference.snapshotId !== scope.snapshotId || reference.snapshotRevision !== scope.snapshotRevision || reference.snapshotHash !== scope.snapshotHash ||
    JSON.stringify(reference.inputs) !== JSON.stringify(spec.inputs) || reference.sourceKind !== spec.source.kind || reference.templateId !== spec.source.id ||
    reference.templateVersion !== spec.source.version || reference.templateSha256 !== spec.source.sha256 || reference.rendererVersion !== spec.source.rendererVersion ||
    reference.contentSha256 !== createHash("sha256").update(bytes).digest("hex") || reference.byteLength !== bytes.byteLength ||
    Date.parse(reference.expiresAt) > Date.parse(spec.expiresAt) || !operation.protectedPacketCurrent) throw unavailable();
}
function opened(envelope: z.infer<typeof envelopeSchema>, key: Uint8Array): Uint8Array {
  const aad = Buffer.from(utilityPreparedAad(envelope.binding));
  if (!decode(envelope.aad, aad.length).equals(aad)) throw unavailable();
  return openUtilityPreparedArtifact({ binding: envelope.binding, iv: decode(envelope.iv, 12), tag: decode(envelope.tag, 16),
    ciphertext: decode(envelope.ciphertext, envelope.binding.operation.packet.protectedUtilityPacket.byteLength) }, key, new Date());
}
async function current(session: UtilityProtectedDatabaseSession, job: UtilityPreparationJob, expected: UtilityProtectedOperation) {
  const value = utilityProtectedOperationSchema.parse(row(await session.query("select parent_private.parent_get_utility_prepared_operation($1,$2,$3) value", [job.jobId, job.leaseToken, expected.packet.protectedUtilityPacket.packetId])));
  if (!value.protectedPacketCurrent || !sameUtilityProtectedOperationBinding(value, expected)) throw unavailable();
  return value;
}

/** Private trusted-renderer port only. There is no parent upload or public prepared-PDF purpose. */
export async function storeUtilityPreparedArtifact(input: unknown, output: UtilityPreparedRendererOutput, options: UtilityProtectedOptions): Promise<UtilityPreparedStoreResult> {
  const job = utilityPreparationJobSchema.parse(structuredClone(input));
  const metadata = utilityPreparedBuildMetadataSchema.parse(structuredClone({ inputs: output.inputs, source: output.source, expiresAt: output.expiresAt }));
  if (!(output.bytes instanceof Uint8Array) || output.bytes.length < 64 || output.bytes.length > MAX_UTILITY_PREPARED_BYTES) throw unavailable();
  const bytes = Uint8Array.from(output.bytes), spec = { scope: job.scope, inputSetHash: job.inputSetHash, ...metadata, contentSha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
  try {
    return await withUtilityProtectedDatabase(options, async session => {
      let key: Buffer | undefined, operation: UtilityProtectedOperation | undefined, commitDispatched = false;
      try {
        await session.query("begin");
        const start = beginSchema.parse(row(await session.query("select parent_private.parent_begin_utility_prepared_artifact($1,$2,$3) value", [job.jobId, job.leaseToken, JSON.stringify(spec)])));
        matches(start.binding, job.scope, metadata, bytes); operation = start.binding.operation;
        if (start.binding.inputSetHash !== job.inputSetHash) throw unavailable();
        key = decode(start.keyBase64, 32);
        if (start.state === "stored") {
          const original = opened(start, key);
          try { if (!Buffer.from(original).equals(bytes)) throw unavailable(); } finally { original.fill(0); }
        } else {
          const sealed = sealUtilityPreparedArtifact(bytes, key, start.binding, new Date());
          const result = utilityProtectedOperationSchema.parse(row(await session.query("select parent_private.parent_seal_utility_prepared_artifact($1,$2,$3,$4,$5,$6) value",
            [job.jobId, job.leaseToken, operation.packet.protectedUtilityPacket.packetId, sealed.iv, sealed.tag, sealed.ciphertext])));
          if (!sameUtilityProtectedOperationBinding(result, operation)) throw unavailable();
        }
        operation = await current(session, job, operation);
        session.check(); commitDispatched = true; await session.query("commit"); return { state: "prepared", operation };
      } catch {
        if (commitDispatched && operation) return { state: "commit_unknown", packetId: operation.packet.protectedUtilityPacket.packetId, operationId: operation.operationId };
        try { await session.query("rollback"); } catch {} throw unavailable();
      } finally { key?.fill(0); }
    });
  } finally { bytes.fill(0); }
}

/** The isolated caller verifies the fresh parent identity; these exact owner/case IDs are checked again in SQL. */
export async function readUtilityPreparedArtifactForOwner(input: { packetId: string; ownerId: string; requestId: string }, options: UtilityProtectedOptions) {
  if (options.job) throw unavailable();
  const value = z.object({ packetId: uuid, ownerId: uuid, requestId: uuid }).strict().parse(structuredClone(input));
  return withUtilityProtectedDatabase(options, async session => {
    let key: Buffer | undefined, bytes: Uint8Array | undefined;
    try {
      const envelope = envelopeSchema.parse(row(await session.query("select parent_private.parent_read_utility_prepared_artifact($1,$2,$3) value", [value.packetId, value.ownerId, value.requestId])));
      if (envelope.binding.ownerId !== value.ownerId || envelope.binding.operation.requestId !== value.requestId || envelope.binding.operation.packet.protectedUtilityPacket.packetId !== value.packetId) throw unavailable();
      key = decode(envelope.keyBase64, 32); bytes = opened(envelope, key);
      const checked = utilityProtectedOperationSchema.parse(row(await session.query("select parent_private.parent_check_utility_prepared_artifact($1,$2,$3) value", [value.packetId, value.ownerId, value.requestId])));
      if (!sameUtilityProtectedOperationBinding(checked, envelope.binding.operation)) throw unavailable();
      session.check(); return { operation: checked, bytes: Uint8Array.from(bytes) };
    } catch { throw unavailable(); }
    finally { key?.fill(0); bytes?.fill(0); }
  });
}
