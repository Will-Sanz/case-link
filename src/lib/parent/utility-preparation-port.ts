import { z } from "zod";
import { utilityProtectedOperationSchema } from "./utility-protected-operation";
import { utilityProtectedScopeSchema } from "./utility-protected-input-contract";

export const utilityPreparationJobSchema = z.object({ jobId: z.uuid(), leaseToken: z.uuid(), scope: utilityProtectedScopeSchema, inputSetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type UtilityPreparationJob = z.infer<typeof utilityPreparationJobSchema>;

export const utilityProtectedPreparationResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("prepared"), operation: utilityProtectedOperationSchema }).strict(),
  z.object({ state: z.literal("commit_unknown"), packetId: z.uuid(), operationId: z.uuid() }).strict(),
  z.object({ state: z.literal("service_blocked"), reason: z.enum(["source_unavailable", "missing_preparation_answers", "protected_inputs_unresolved", "service_validation_required"]) }).strict(),
]);
export type UtilityProtectedPreparationResult = z.infer<typeof utilityProtectedPreparationResultSchema>;
export type UtilityProtectedPreparationPort = {
  prepare(input: UtilityPreparationJob & { signal: AbortSignal }): Promise<UtilityProtectedPreparationResult>;
};
export const UTILITY_PREPARATION_SERVICE_ERROR = "The isolated utility preparation service is unavailable.";
export const UTILITY_PREPARATION_SOURCE_UNAVAILABLE = "utility_preparation_source_unavailable";
export function utilityPreparationMatchesJob(operation: z.infer<typeof utilityProtectedOperationSchema>, job: UtilityPreparationJob): boolean {
  const reference = operation.packet.protectedUtilityPacket;
  return operation.protectedPacketCurrent && operation.requestId === job.scope.requestId && operation.requestVersion === job.scope.expectedVersion && operation.programId === job.scope.programId &&
    reference.snapshotId === job.scope.snapshotId && reference.snapshotRevision === job.scope.snapshotRevision && reference.snapshotHash === job.scope.snapshotHash;
}
