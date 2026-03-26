"use server";

import { createClient } from "@supabase/supabase-js";
import { buildPasswordRecoveryRedirectTo } from "@/lib/auth/password-recovery-redirect";
import { getEnv } from "@/lib/env";

export type PasswordResetRequestState = { ok: boolean; message: string };

/**
 * Sends Supabase "Reset password" / recovery email (logged-out or any email).
 * Does not reveal whether the address is registered.
 */
export async function requestPasswordResetForEmail(
  rawEmail: string,
): Promise<PasswordResetRequestState> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const redirectTo = await buildPasswordRecoveryRedirectTo();
  if (!redirectTo) {
    return {
      ok: false,
      message: "Could not build the reset link for this site. Contact support.",
    };
  }

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getEnv();
  const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("rate limit") || m.includes("too many")) {
      return {
        ok: false,
        message: "Too many reset emails were sent. Please wait up to an hour before trying again.",
      };
    }
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    message: "Check your email for a password reset link.",
  };
}
