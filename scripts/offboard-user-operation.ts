import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const offboardingSchema = z.object({
  targetUserId: z.string().uuid(),
  replacementUserId: z.string().uuid(),
  actorLabel: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(8).max(1000),
}).refine((input) => input.targetUserId !== input.replacementUserId, "Choose a different replacement account.");

export async function offboardUser(supabase: SupabaseClient, input: unknown) {
  const parsed = offboardingSchema.safeParse(input);
  if (!parsed.success) throw new Error("Provide valid target/replacement user IDs, operator label, and reason.");
  const value = parsed.data;
  const args = {
    p_target_user_id: value.targetUserId,
    p_reassign_user_id: value.replacementUserId,
    p_actor_label: value.actorLabel,
    p_reason: value.reason,
  };
  // Deny data access first, even if the Auth service is temporarily unavailable.
  const denied = await supabase.rpc("operator_offboard_user", args);
  if (denied.error) throw new Error("Offboarding did not complete. Check the target, replacement account, and database access.");
  const banned = await supabase.auth.admin.updateUserById(value.targetUserId, { ban_duration: "876000h" });
  if (banned.error) throw new Error("Workspace access is disabled and cases are reassigned, but Auth sign-in could not be disabled. Retry this operation.");
  // Close any session issued between the first transaction and the Auth ban.
  const revoked = await supabase.rpc("operator_offboard_user", args);
  if (revoked.error) throw new Error("Workspace access and sign-in are disabled, but the final session cleanup failed. Retry this operation.");
}
