import "server-only";

import { isDev } from "@/lib/env/runtime";

/**
 * Logs unexpected failures on the server only. Never pass the returned details to clients.
 */
export function logServerError(scope: string, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const payload = {
    scope,
    message: err.message,
    name: err.name,
    ...(isDev() ? { stack: err.stack } : {}),
  };
  console.error("[server-error]", payload);
}
