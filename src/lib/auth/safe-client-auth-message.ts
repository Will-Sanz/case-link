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
  if (m.length > 280) return GENERIC_SESSION;
  if (/internal|server error|database|relation |sql|jwt|exception|stack|trace/i.test(m)) {
    return GENERIC_SESSION;
  }
  return m;
}

/** Supabase session exchange / OTP / setSession failures on the callback route. */
export function safeAuthSessionClientMessage(_raw: string | undefined): string {
  if (!isProduction()) {
    const m = _raw?.trim();
    return m && m.length > 0 ? m.slice(0, 500) : GENERIC_SESSION;
  }
  return GENERIC_SESSION;
}

/** Password sign-in: allow common Supabase user-facing strings; otherwise generic. */
export function safeSignInPasswordMessage(raw: string | undefined): string {
  const m = raw?.trim() ?? "";
  if (!m) return GENERIC_PASSWORD;
  if (!isProduction()) return m.slice(0, 500);
  if (m.length > 280) return GENERIC_PASSWORD;
  if (/internal|server error|database|relation |sql|jwt|exception|fetch failed|network/i.test(m)) {
    return GENERIC_PASSWORD;
  }
  return m;
}

const GENERIC_SIGNUP = "Could not create an account. Check your details and try again.";

/** Sign-up errors from Supabase Auth (client). */
export function safeSignUpMessage(raw: string | undefined): string {
  const m = raw?.trim() ?? "";
  if (!m) return GENERIC_SIGNUP;
  if (!isProduction()) return m.slice(0, 500);
  if (m.length > 280) return GENERIC_SIGNUP;
  if (/internal|server error|database|relation |sql|jwt|exception|fetch failed|network/i.test(m)) {
    return GENERIC_SIGNUP;
  }
  return m;
}
