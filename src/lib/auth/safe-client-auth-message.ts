/**
 * Maps auth-related errors to strings safe for URLs and login UI.
 * In production, avoids surfacing provider or infrastructure wording.
 */

const GENERIC_SESSION = "Sign-in could not be completed. Try again or request a new link.";
const GENERIC_PASSWORD = "Could not sign in. Check your email and password and try again.";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** OAuth/query/hash `error_description` values: keep short, user-facing only. */
export function safeOAuthRedirectMessage(raw: string | undefined): string {
  const m = raw?.trim() ?? "";
  if (!m) return GENERIC_SESSION;
  if (!isProduction()) return m.slice(0, 500);
  return GENERIC_SESSION;
}

/** Supabase session exchange / OTP / setSession failures on the callback route. */
export function safeAuthSessionClientMessage(_raw: string | undefined): string {
  if (!isProduction()) {
    const m = _raw?.trim();
    return m && m.length > 0 ? m.slice(0, 500) : GENERIC_SESSION;
  }
  return GENERIC_SESSION;
}

/** Password sign-in: map only known safe states; otherwise return a generic message. */
export function safeSignInPasswordMessage(raw: string | undefined): string {
  const m = raw?.trim() ?? "";
  if (!m) return GENERIC_PASSWORD;
  if (!isProduction()) return m.slice(0, 500);
  if (/email not confirmed/i.test(m)) {
    return "Confirm your invitation email before signing in.";
  }
  if (/too many|rate.?limit/i.test(m)) {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }
  return GENERIC_PASSWORD;
}
