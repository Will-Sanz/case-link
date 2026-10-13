import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseInviteSiteOrigin } from "./provisioning-safety";

const recoverySchema = z.object({
  targetUserId: z.string().uuid(),
  siteOrigin: z.string(),
  actorLabel: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(8).max(1000),
  identityVerified: z.literal(true),
});

export async function recoverMfaUser(supabase: SupabaseClient, input: unknown) {
  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) throw new Error("Provide a valid account ID, operator, reason, and confirmation of an independent identity check.");
  const value = parsed.data;
  const siteOrigin = parseInviteSiteOrigin(value.siteOrigin);
  const target = await supabase.auth.admin.getUserById(value.targetUserId);
  if (target.error || !target.data.user?.email) throw new Error("The recovery account could not be verified. No change was made.");
  const args = { p_target_user_id: value.targetUserId, p_actor_label: value.actorLabel, p_reason: value.reason };
  const started = await supabase.rpc("operator_revoke_mfa_sessions", { ...args, p_stage: "started" });
  if (started.error) throw new Error("Recovery could not start. Verify the account is active and the operator has access.");
  // Invalidate the old password before removing MFA; this random replacement is never disclosed.
  const locked = await supabase.auth.admin.updateUserById(value.targetUserId, { password: `${randomBytes(32).toString("base64url")}!aA1` });
  if (locked.error) throw new Error("Sessions were revoked, but the old password could not be invalidated. No factors were removed. Retry recovery.");
  const listed = await supabase.auth.admin.mfa.listFactors({ userId: value.targetUserId });
  if (listed.error) throw new Error("The old password is invalidated, but verification methods could not be loaded. Retry recovery.");
  for (const factor of listed.data.factors) {
    const removed = await supabase.auth.admin.mfa.deleteFactor({ userId: value.targetUserId, id: factor.id });
    if (removed.error) throw new Error("Verification method removal is incomplete. Retry recovery before telling the user it is ready.");
  }
  const ready = await supabase.rpc("operator_revoke_mfa_sessions", { ...args, p_stage: "ready" });
  if (ready.error) throw new Error("Verification methods were removed, but final session cleanup could not be confirmed. Retry recovery.");
  const sent = await supabase.auth.resetPasswordForEmail(target.data.user.email, {
    redirectTo: `${siteOrigin}/auth/callback?next=${encodeURIComponent("/reset-password?mode=recovery")}`,
  });
  if (sent.error) throw new Error("Recovery is prepared, but email delivery was not confirmed. Wait at least one minute, then retry recovery.");
}
