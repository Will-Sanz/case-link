import type { SupportRequest } from "./domain";
import type { z } from "zod";
import {
  authorizeOperation,
  receiptSchema,
  type ProposedOperation,
  type ProviderCapability,
} from "./policy";

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
}): Promise<{
  state: string;
  reason?: string;
  receipt?: z.infer<typeof receiptSchema>;
}> {
  const decision = authorizeOperation(input);
  if (!decision.allowed) return { state: "blocked", reason: decision.reason };
  if (!input.transport)
    return { state: "blocked", reason: "transport_not_configured" };
  const operationId = await input.store.prepare(input.operation);
  const frozen = await input.store.begin(operationId);
  try {
    const receipt = receiptSchema.parse(
      await input.transport.execute({
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
