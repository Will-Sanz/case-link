export const PASSWORD_REQUIREMENTS = "Use at least 14 characters, including an uppercase letter, a lowercase letter, a number, and a symbol.";

/** Mirrors the pilot's Supabase password requirements; Auth remains the final authority. */
export function passwordMeetsPolicy(password: string): boolean {
  return password.length >= 14 && /[a-z]/.test(password) && /[A-Z]/.test(password)
    && /[0-9]/.test(password) && /[!@#$%^&*()_+\-=\[\]{};'\\:"|<>?,./`~]/.test(password);
}
