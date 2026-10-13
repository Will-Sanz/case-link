/** Invite or update a provisioned user without creating or printing a password. */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parseInviteSiteOrigin, parseProvisioningRole } from "./provisioning-safety";
import { inviteUser } from "./invite-user-operation";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const siteOrigin = parseInviteSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  const email = requireEnv("CASELINK_INVITE_EMAIL").toLowerCase();
  const role = parseProvisioningRole(process.env.CASELINK_INVITE_ROLE);
  const actorLabel = requireEnv("CASELINK_OPERATOR_LABEL");
  const reason = requireEnv("CASELINK_CHANGE_REASON");
  const resend = process.env.CASELINK_INVITE_RESEND?.trim() || "false";
  if (resend !== "true" && resend !== "false") throw new Error("CASELINK_INVITE_RESEND must be true or false.");

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout },
  });
  const result = await inviteUser(supabase, { email, role, siteOrigin, actorLabel, reason, resend: resend === "true" });
  console.info(`${role === "admin" ? "Administrator" : "Case manager"} permissions saved. ${result.delivery === "none" ? "Existing confirmed account; no email sent. Use CASELINK_INVITE_RESEND=true if a fresh setup/recovery link is needed." : `${result.delivery === "invitation" ? "Invitation" : "Recovery email"} accepted for delivery.`}`);
  if (role === "admin") console.info("Require TOTP enrollment before granting production access.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "User provisioning failed.");
  process.exit(1);
});
