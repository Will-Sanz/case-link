import type { SupportRequest } from "./domain";
import type { z } from "zod";
import {
  receiptSchema,
  type ProposedOperation,
  type ProviderCapability,
} from "./policy";
import { applicationReadiness } from "./application-readiness";

export type ExecutablePacket = {
  operationId: string;
  packet: Record<string, unknown>;
  packetHash: string;
};
export type ExecutionStore = {
  prepare(operation: ProposedOperation): Promise<string>;
  begin(operationId: string): Promise<ExecutablePacket>;
  finish(
    operationId: string,
    state: string,
    evidence: Record<string, unknown>,
  ): Promise<void>;
};
export type ProgramTransport = {
  execute(
    input: ExecutablePacket & { idempotencyKey: string; signal: AbortSignal },
  ): Promise<unknown>;
};
/** Only a registered, verified program transport can cross the external side-effect boundary. */
export async function executeSupportOperation(input: {
  request: SupportRequest;
  operation: ProposedOperation;
  capability: ProviderCapability;
  store: ExecutionStore;
  transport: ProgramTransport | undefined;
  now: Date;
  accountActive: boolean;
  attempts: number;
  revoked: boolean;
  documentsValid: boolean;
  statusReferences?: readonly string[];
  readiness: Pick<
    Parameters<typeof applicationReadiness>[0],
    "requiredFields" | "formVerified" | "modelJudgmentUsed" | "calibration"
  >;
}): Promise<{
  state: string;
  reason?: string;
  receipt?: z.infer<typeof receiptSchema>;
}> {
  const readiness = applicationReadiness({
    authority: input,
    ...input.readiness,
    transportReady: Boolean(input.transport),
  });
  if (!readiness.automaticHandlingAllowed)
    return {
      state: "blocked",
      reason:
        readiness.authorityDeniedReason ??
        (!input.transport
          ? "transport_not_configured"
          : "application_evidence_requires_resolution"),
    };
  const operationId = await input.store.prepare(input.operation);
  const frozen = await input.store.begin(operationId);
  try {
    const receipt = receiptSchema.parse(
      await input.transport!.execute({
        ...frozen,
        idempotencyKey: input.operation.idempotencyKey,
        signal: AbortSignal.timeout(60000),
      }),
    );
    await input.store.finish(operationId, receipt.state, receipt);
    return { state: receipt.state, receipt };
  } catch {
    // A timeout or malformed receipt does not prove failure; never blindly repeat a submission.
    await input.store.finish(operationId, "delivery_unknown", {
      reason: "receipt_requires_reconciliation",
      packetHash: frozen.packetHash,
    });
    return { state: "delivery_unknown" };
  }
}
