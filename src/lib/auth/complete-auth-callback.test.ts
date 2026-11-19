import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AUTH_CALLBACK_ERROR_PATH, completeAuthCallback } from "./complete-auth-callback";

function fixture() {
  const session = { user: { id: "staff-a" } };
  const auth = {
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    setSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: session.user }, error: null }),
  };
  const factory = vi.fn(() => ({ auth }) as unknown as SupabaseClient);
  return { auth, factory };
}
const url = (suffix: string) => new URL(`https://school.example/auth/callback${suffix}`);
describe("callback contract", () => {
  it.each([
    ["?code=synthetic-code&next=/profile", "exchangeCodeForSession", "/profile"],
    ["?token_hash=synthetic-token&type=invite&next=/reset-password?mode=recovery", "verifyOtp", "/reset-password?mode=recovery"],
    ["?token_hash=synthetic-token&type=recovery", "verifyOtp", "/families"],
    ["#token_hash=synthetic-token&type=invite&next=%2Freset-password%3Fmode%3Dsetup", "verifyOtp", "/reset-password?mode=setup"],
    ["#token_hash=synthetic-token&type=recovery&next=%2Freset-password%3Fmode%3Drecovery", "verifyOtp", "/reset-password?mode=recovery"],
    ["#access_token=synthetic-access&refresh_token=synthetic-refresh", "setSession", "/families"],
    ["?code=synthetic-code&next=https://attacker.example", "exchangeCodeForSession", "/families"],
  ])("completes supported callback %s", async (suffix, method, destination) => {
    const f = fixture();
    expect(await completeAuthCallback(url(suffix), f.factory)).toBe(destination);
    expect(f.auth[method as keyof typeof f.auth]).toHaveBeenCalledTimes(1);
    expect(f.auth.getSession).toHaveBeenCalledTimes(1);
    expect(f.auth.getUser).toHaveBeenCalledTimes(1);
  });
  it.each(["", "?next=/families", "?token_hash=hash", "?type=invite", "?token_hash=hash&type=admin", "?token_hash=hash&type=signup", "?code=code&token_hash=hash&type=invite", "?code=first&code=second", "?token_hash=first&type=invite#token_hash=second&type=recovery", "?code=code#token_hash=hash&type=invite", "#token_hash=hash&type=recovery&access_token=access&refresh_token=refresh", "#access_token=access", "#refresh_token=refresh", "?error=internal-secret", "#error=expired&error_description=secret"])("rejects invalid or ambiguous input %s before contacting Auth", async (suffix) => {
    const f = fixture();
    expect(await completeAuthCallback(url(suffix), f.factory)).toBe(AUTH_CALLBACK_ERROR_PATH);
    expect(f.factory).not.toHaveBeenCalled();
  });
  it.each(["exchangeCodeForSession", "getSession", "getUser"] as const)("handles a thrown %s failure without exposing details", async (method) => {
    const f = fixture();
    f.auth[method].mockRejectedValue(new Error("private provider detail"));
    expect(await completeAuthCallback(url("?code=code"), f.factory)).toBe(AUTH_CALLBACK_ERROR_PATH);
  });
  it("rejects expired/reused codes and denied cookie storage", async () => {
    const f = fixture();
    f.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: { session: null }, error: { message: "Expired token" } });
    expect(await completeAuthCallback(url("?code=used"), f.factory)).toBe(AUTH_CALLBACK_ERROR_PATH);
    f.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await completeAuthCallback(url("?code=fresh"), f.factory)).toBe(AUTH_CALLBACK_ERROR_PATH);
  });
  it("rejects a changed account between exchange, storage, and verification", async () => {
    const f = fixture();
    f.auth.getUser.mockResolvedValueOnce({ data: { user: { id: "another-account" } }, error: null });
    expect(await completeAuthCallback(url("?code=code"), f.factory)).toBe(AUTH_CALLBACK_ERROR_PATH);
  });
});
