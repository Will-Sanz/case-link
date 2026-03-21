import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getEnv, requireServiceRoleKey } from "@/lib/env";

/**
 * Full-access client for trusted server-only code (e.g. CSV import, cron).
 * Never import this into Client Components or pass the key to the browser.
 */
export function createServiceRoleClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getEnv();
  const serviceKey = requireServiceRoleKey();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
