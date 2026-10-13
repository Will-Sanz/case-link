import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { PasswordSetupRequiredError, SessionUnavailableError } from "./session-errors";
import { ensureAppUserWithClient } from "./session";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const user = { id: "staff-id", email: "staff@example.test" } as User;
it.each([false, undefined])("denies an inactive or missing account access flag: %s", async (is_active) => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: user.id, email: user.email, role: "admin", is_active }, error: null }) };
  await expect(ensureAppUserWithClient({ from: () => query } as unknown as SupabaseClient, user)).rejects.toThrow("no longer has workspace access");
});
describe("active account", () => {
  it("keeps the existing invited user's workspace identity", async () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: user.id, email: user.email, role: "case_manager", is_active: true }, error: null }) };
    expect(await ensureAppUserWithClient({ from: () => query, rpc: async () => ({ data: true, error: null }) } as unknown as SupabaseClient, user)).toEqual({ id: user.id, email: user.email, role: "case_manager" });
  });
});

it.each([false, null])("requires password sign-in when the signed session result is %s", async (data) => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: user.id, email: user.email, role: "case_manager", is_active: true }, error: null }) };
  await expect(ensureAppUserWithClient({ from: () => query, rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient, user)).rejects.toBeInstanceOf(PasswordSetupRequiredError);
});
it("fails closed when the password sign-in check is unavailable", async () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: user.id, email: user.email, role: "case_manager", is_active: true }, error: null }) };
  await expect(ensureAppUserWithClient({ from: () => query, rpc: async () => ({ data: null, error: {} }) } as unknown as SupabaseClient, user)).rejects.toBeInstanceOf(SessionUnavailableError);
});
