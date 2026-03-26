import "server-only";

import { getPublicSiteOrigin } from "@/lib/auth/public-site-url";

/** Where the auth callback sends users after they open a recovery link from email. */
export const PASSWORD_UPDATE_PATH = "/auth/update-password";

/**
 * `redirectTo` for `resetPasswordForEmail` — must match an allow-listed URL in Supabase
 * (typically `https://your-domain.com/auth/callback`).
 */
export async function buildPasswordRecoveryRedirectTo(): Promise<string | null> {
  const origin = await getPublicSiteOrigin();
  if (!origin) return null;
  return `${origin}/auth/callback?next=${encodeURIComponent(PASSWORD_UPDATE_PATH)}`;
}
