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
  if (process.env.NODE_ENV === "development") {
    return msg;
  }
  return generic;
}
