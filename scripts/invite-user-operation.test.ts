import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { inviteUser } from "./invite-user-operation";

const input = { email: "staff@example.test", role: "case_manager", siteOrigin: "https://app.example.edu", actorLabel: "Test operator", reason: "Synthetic invitation test" };
const user = { id: "invited-id", email: input.email };
function client(confirmed = false) {
  const listUsers = vi.fn().mockResolvedValue({ data: { users: [{ ...user, email_confirmed_at: confirmed ? "2026-10-13" : null }] }, error: null });
  const createUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
  const inviteUserByEmail = vi.fn().mockResolvedValue({ error: null });
  const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: { is_active: true }, error: null });
  const query = { select: () => query, eq: () => query, maybeSingle };
  const supabase = { from: () => query, rpc, auth: { resetPasswordForEmail, admin: { listUsers, createUser, inviteUserByEmail } } } as unknown as SupabaseClient;
  return { supabase, listUsers, createUser, inviteUserByEmail, resetPasswordForEmail, rpc, maybeSingle };
}

it("creates without a password/email, saves permissions, and only then sends the invitation", async () => {
  const c = client();
  c.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
  expect(await inviteUser(c.supabase, input)).toEqual({ userId: user.id, delivery: "invitation" });
  expect(c.createUser).toHaveBeenCalledWith({ email: input.email, email_confirm: false });
  expect(c.createUser.mock.invocationCallOrder[0]).toBeLessThan(c.rpc.mock.invocationCallOrder[0]);
  expect(c.rpc.mock.invocationCallOrder[0]).toBeLessThan(c.inviteUserByEmail.mock.invocationCallOrder[0]);
  expect(c.inviteUserByEmail).toHaveBeenCalledWith(input.email, { redirectTo: "https://app.example.edu/auth/callback?next=%2Freset-password%3Fmode%3Dsetup" });
});
it("stops before email when provisioning fails, then retries the existing account", async () => {
  const c = client();
  c.rpc.mockResolvedValueOnce({ error: {} });
  await expect(inviteUser(c.supabase, input)).rejects.toThrow("permissions were not saved");
  expect(c.inviteUserByEmail).not.toHaveBeenCalled();
  await expect(inviteUser(c.supabase, input)).resolves.toMatchObject({ delivery: "invitation" });
  expect(c.createUser).not.toHaveBeenCalled();
});
it("resends an unopened/expired invitation without making a second account", async () => {
  const c = client();
  c.inviteUserByEmail.mockResolvedValueOnce({ error: {} });
  await expect(inviteUser(c.supabase, input)).rejects.toThrow("Permissions are saved");
  await inviteUser(c.supabase, input);
  expect(c.inviteUserByEmail).toHaveBeenCalledTimes(2);
  expect(c.createUser).not.toHaveBeenCalled();
});
it("recovers a duplicate creation race by finding the same account", async () => {
  const c = client();
  c.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
  c.createUser.mockResolvedValueOnce({ error: { code: "email_exists" } });
  await expect(inviteUser(c.supabase, input)).resolves.toMatchObject({ userId: user.id });
  expect(c.rpc).toHaveBeenCalledTimes(1);
});
it("does not email active users on a role update; explicit resend uses recovery", async () => {
  const c = client(true);
  await expect(inviteUser(c.supabase, input)).resolves.toMatchObject({ delivery: "none" });
  expect(c.resetPasswordForEmail).not.toHaveBeenCalled();
  await expect(inviteUser(c.supabase, { ...input, resend: true })).resolves.toMatchObject({ delivery: "recovery" });
  expect(c.inviteUserByEmail).not.toHaveBeenCalled();
  expect(c.resetPasswordForEmail).toHaveBeenCalledOnce();
});
it("preserves offboarding and rejects invalid input before mutation", async () => {
  const c = client();
  for (const value of [{ ...input, role: "owner" }, { ...input, reason: "" }, { ...input, email: "bad" }, { ...input, siteOrigin: "https://app.example.edu/path" }]) {
    await expect(inviteUser(c.supabase, value)).rejects.toThrow();
  }
  c.maybeSingle.mockResolvedValueOnce({ data: { is_active: false }, error: null });
  await expect(inviteUser(c.supabase, input)).rejects.toThrow("cannot reactivate");
  expect(c.rpc).not.toHaveBeenCalled();
  expect(c.createUser).not.toHaveBeenCalled();
  expect(c.inviteUserByEmail).not.toHaveBeenCalled();
});
