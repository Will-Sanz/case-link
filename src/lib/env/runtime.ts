/**
 * Tiny runtime flags without pulling the full env schema (safe from any module).
 * For validated config use `getEnv()` from `@/lib/env` on the server only.
 */
export function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

export function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}
