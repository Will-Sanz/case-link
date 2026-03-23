import "server-only";

import { requireAppUserWithClient } from "@/lib/auth/session";
import type { AppUserRow } from "@/types/database";

/** Full `app_users` row for the signed-in user (profile + account fields). */
export async function fetchCaseManagerProfileForCurrentUser(): Promise<AppUserRow> {
  const { user, supabase } = await requireAppUserWithClient();
  const { data, error } = await supabase.from("app_users").select("*").eq("id", user.id).single();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("No profile row found. Try signing out and back in.");
  }

  return data as AppUserRow;
}
