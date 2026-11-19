/**
 * Maps auth-related errors to strings safe for URLs and login UI.
 * In production, avoids surfacing provider or infrastructure wording.
 */

const GENERIC_SESSION = "Sign-in could not be completed. Try again or request a new link.";
const GENERIC_PASSWORD = "Could not sign in. Check your email and password and try again.";

export const AUTH_LINK_ERROR_MESSAGE = GENERIC_SESSION;

/** Password sign-in: map only known safe states; otherwise return a generic message. */
export function safeSignInPasswordMessage(raw: string | undefined): string {
  const m = raw?.trim() ?? "";
  if (!m) return GENERIC_PASSWORD;
  if (/email not confirmed/i.test(m)) {
    return "Confirm your invitation email before signing in.";
  }
  if (/too many|rate.?limit/i.test(m)) {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }
  return GENERIC_PASSWORD;
}
