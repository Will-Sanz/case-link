import type { SupabaseClient } from "@supabase/supabase-js";
import { SessionUnavailableError } from "@/lib/auth/session-errors";

export type ParentSession = { supabase: SupabaseClient; user: { id: string; email: string } };

/** Shared live-identity/account check; each runtime supplies its own request-scoped cookie client. */
export async function verifyParentSession(supabase: SupabaseClient): Promise<ParentSession | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    if ([400, 401, 403].includes(error.status ?? 0)) return null;
    throw new SessionUnavailableError();
  }
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous) return null;
  const ensured = await supabase.rpc("parent_ensure_account");
  if (ensured.error) {
    if (ensured.error.code === "42501") return null;
    throw new SessionUnavailableError();
  }
  return { supabase, user: { id: user.id, email: user.email } };
}
