import { isDev } from "@/lib/env/runtime";
import { logServerError } from "@/lib/logger/server-error";

/**
 * Maps PostgREST / Supabase errors to safe client-facing messages.
 * Full detail stays in server logs when callers log separately.
 */
export function publicMessageFromSupabaseError(
  error: { message?: string } | null | undefined,
  generic = "Could not complete the request.",
): string {
  const msg = error?.message?.trim();
  if (!msg) return generic;
  const lower = msg.toLowerCase();
  if (lower.includes("row-level security") || lower.includes("rls policy") || lower.includes("permission denied")) {
    return "You do not have permission for this action.";
  }
  if (isDev()) {
    return msg;
  }
  return generic;
}

const GENERIC_UNEXPECTED = "Something went wrong. Please try again.";

/**
 * Use in catch blocks for server actions: log full detail, return a safe string for the UI.
 */
export function publicMessageFromCaughtError(
  scope: string,
  error: unknown,
  generic = GENERIC_UNEXPECTED,
): string {
  logServerError(scope, error);
  if (isDev() && error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return generic;
}
