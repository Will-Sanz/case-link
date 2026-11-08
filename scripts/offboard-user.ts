/** Run only from a protected operator environment; never place the service key in arguments. */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { offboardUser } from "./offboard-user-operation";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("A protected Supabase URL and service key are required.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await offboardUser(supabase, {
    targetUserId: process.env.CASELINK_OFFBOARD_USER_ID,
    replacementUserId: process.env.CASELINK_REASSIGN_USER_ID,
    actorLabel: process.env.CASELINK_OPERATOR_LABEL,
    reason: process.env.CASELINK_CHANGE_REASON,
  });
  console.info("Offboarding complete: workspace access disabled, cases reassigned, sign-in disabled, and sessions revoked.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Offboarding failed. Check the protected operator job.");
  process.exitCode = 1;
});
