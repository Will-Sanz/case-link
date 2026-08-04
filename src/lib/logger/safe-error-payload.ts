import { createHash, randomUUID } from "node:crypto";

export function buildSafeErrorPayload(
  scope: string,
  error: unknown,
  options: { includeDetails: boolean; correlationId?: string },
) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const fingerprint = createHash("sha256")
    .update(`${normalized.name}\n${normalized.message}\n${normalized.stack ?? ""}`)
    .digest("hex")
    .slice(0, 16);

  return {
    event: "server.error",
    severity: "error",
    correlationId: options.correlationId ?? randomUUID(),
    scope: scope.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 100),
    errorName: normalized.name.slice(0, 100),
    fingerprint,
    timestamp: new Date().toISOString(),
    ...(options.includeDetails ? {
      message: normalized.message,
      stack: normalized.stack,
    } : {}),
  };
}
