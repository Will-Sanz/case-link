/** Protected operator use only, after independent identity verification. */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";
import { recoverMfaUser } from "./recover-mfa-operation";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("A protected Supabase URL and service key are required.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchWithTimeout } });
  await recoverMfaUser(client, {
    targetUserId: process.env.CASELINK_RECOVERY_USER_ID,
    siteOrigin: process.env.NEXT_PUBLIC_SITE_URL,
    actorLabel: process.env.CASELINK_OPERATOR_LABEL,
    reason: process.env.CASELINK_CHANGE_REASON,
    identityVerified: process.env.CASELINK_RECOVERY_IDENTITY_VERIFIED === "1",
  });
  console.info("Recovery prepared: earlier credentials and sessions revoked; recovery email accepted for delivery. The user must reset their password and enroll an authenticator again before administrator case access.");
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recovery failed. Check the protected operator job.");
  process.exitCode = 1;
});
