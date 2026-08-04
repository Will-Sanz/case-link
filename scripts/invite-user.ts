/** Invite or update a provisioned user without creating or printing a password. */
import { config as loadEnv } from "dotenv";
import { createClient, type User } from "@supabase/supabase-js";
import { parseInviteSiteOrigin, parseProvisioningRole } from "./provisioning-safety";

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
  if (actorLabel.length < 3 || reason.length < 8) {
    throw new Error("Operator label and change reason are too short for an auditable role change.");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let targetUser: User | undefined;
  for (let page = 1; !targetUser; page += 1) {
    const listed = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) throw listed.error;
    targetUser = listed.data.users.find((user) => user.email?.toLowerCase() === email);
    if (listed.data.users.length < 1000) break;
  }
  let action: "user.invited" | "user.role_changed" = "user.role_changed";
  if (!targetUser) {
    const next = encodeURIComponent("/reset-password?mode=recovery");
    const invited = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteOrigin}/auth/callback?next=${next}`,
    });
    if (invited.error) throw invited.error;
    targetUser = invited.data.user;
    action = "user.invited";
  }
  if (!targetUser?.email) throw new Error("The invited user could not be resolved.");

  const roleChange = await supabase.rpc("operator_set_user_role", {
    p_target_user_id: targetUser.id,
    p_role: role,
    p_actor_label: actorLabel,
    p_reason: reason,
    p_action: action,
  });
  if (roleChange.error) throw roleChange.error;
  console.info(`${role === "admin" ? "Administrator" : "Case manager"} ${action === "user.invited" ? "invited" : "updated"}: ${email}`);
  if (role === "admin") console.info("Require TOTP enrollment before granting production access.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "User provisioning failed.");
  process.exit(1);
});
