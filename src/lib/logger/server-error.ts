import "server-only";

import { isDev } from "@/lib/env/runtime";
import { buildSafeErrorPayload } from "@/lib/logger/safe-error-payload";

/**
 * Logs unexpected failures on the server only. Never pass the returned details to clients.
 */
export function logServerError(scope: string, error: unknown): void {
  console.error(JSON.stringify(buildSafeErrorPayload(scope, error, {
    includeDetails: isDev(),
  })));
}
