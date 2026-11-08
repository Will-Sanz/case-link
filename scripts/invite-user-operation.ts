import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { parseInviteSiteOrigin } from "./provisioning-safety";

const invitationSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  role: z.enum(["case_manager", "admin"]),
  siteOrigin: z.string(),
  actorLabel: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(8).max(1000),
  resend: z.boolean().default(false),
});

async function findUser(supabase: SupabaseClient, email: string): Promise<User | undefined> {
  for (let page = 1; ; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Could not check existing accounts. Retry before inviting anyone.");
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email);
    if (found || result.data.users.length < 1000) return found;
  }
}

/** Provision permissions before sending a link; each incomplete stage can be retried. */
export async function inviteUser(supabase: SupabaseClient, input: unknown) {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) throw new Error("Provide a valid email, role, operator label, reason, and resend flag.");
  const value = parsed.data;
  const siteOrigin = parseInviteSiteOrigin(value.siteOrigin);
  let user = await findUser(supabase, value.email);
  if (!user) {
    const created = await supabase.auth.admin.createUser({ email: value.email, email_confirm: false });
    if (created.error?.code === "email_exists") user = await findUser(supabase, value.email);
    else if (!created.error) user = created.data.user;
    if (!user) throw new Error("Account creation could not be confirmed. No invitation was sent. Retry this operation.");
  }

  const account = await supabase.from("app_users").select("is_active").eq("id", user.id).maybeSingle();
  if (account.error) throw new Error("Could not verify account access. No invitation was sent. Retry this operation.");
  if (account.data?.is_active === false) throw new Error("This account was offboarded. Invitations cannot reactivate it.");
  const provisioned = await supabase.rpc("operator_set_user_role", {
    p_target_user_id: user.id, p_role: value.role, p_actor_label: value.actorLabel,
    p_reason: value.reason, p_action: user.email_confirmed_at ? "user.role_changed" : "user.invited",
  });
  if (provisioned.error) throw new Error("The Auth account exists, but permissions were not saved. No invitation was sent. Retry this operation.");

  const redirectTo = `${siteOrigin}/auth/callback?next=${encodeURIComponent("/reset-password?mode=setup")}`;
  if (!user.email_confirmed_at) {
    const sent = await supabase.auth.admin.inviteUserByEmail(value.email, { redirectTo });
    if (sent.error) throw new Error("Permissions are saved, but invitation delivery was not confirmed. Wait at least a minute, then retry. If the link was accepted meanwhile, use CASELINK_INVITE_RESEND=true.");
    return { userId: user.id, delivery: "invitation" as const };
  }
  if (value.resend) {
    const sent = await supabase.auth.resetPasswordForEmail(value.email, { redirectTo });
    if (sent.error) throw new Error("Permissions are saved, but recovery email delivery was not confirmed. Wait at least a minute, then retry with CASELINK_INVITE_RESEND=true.");
    return { userId: user.id, delivery: "recovery" as const };
  }
  return { userId: user.id, delivery: "none" as const };
}
