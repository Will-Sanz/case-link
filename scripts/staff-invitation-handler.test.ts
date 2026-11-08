import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { handleStaffInvitation } from "../supabase/functions/invite-staff/handler";

function fixture() {
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "admin-id" } }, error: null });
  const permission = vi.fn().mockResolvedValue({ data: true, error: null });
  const listUsers = vi.fn().mockResolvedValue({ data: { users: [{ id: "staff-id", email: "staff@example.test" }] }, error: null });
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: "staff-id" } }, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: { is_active: true, role: "case_manager" }, error: null });
  const query = { select: () => query, eq: vi.fn(() => query), maybeSingle };
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const inviteUserByEmail = vi.fn().mockResolvedValue({ error: null });
  const generateLink = vi.fn().mockResolvedValue({ data: { properties: { hashed_token: "a".repeat(64) } }, error: null });
  const from = vi.fn(() => query);
  const caller = { auth: { getUser }, rpc: permission } as unknown as SupabaseClient;
  const operator = { from, rpc, auth: { admin: { listUsers, createUser, inviteUserByEmail, generateLink } } } as unknown as SupabaseClient;
  const call = (body: unknown = { email: "staff@example.test", delivery: "link" }) => handleStaffInvitation(new Request("https://synthetic.test", { method: "POST", body: JSON.stringify(body) }), caller, operator);
  return { call, caller, operator, getUser, permission, listUsers, createUser, maybeSingle, from, query, rpc, inviteUserByEmail, generateLink };
}
it.each([false, null])("denies non-administrators before any privileged operation: %s", async data => {
  const f = fixture(); f.permission.mockResolvedValue({ data, error: null });
  expect((await f.call()).status).toBe(403); expect(f.from).not.toHaveBeenCalled(); expect(f.listUsers).not.toHaveBeenCalled();
});
it("denies missing and unavailable sessions without trusting user metadata", async () => {
  const f = fixture(); f.getUser.mockResolvedValueOnce({ data: { user: null }, error: {} });
  expect((await f.call()).status).toBe(401);
  f.permission.mockResolvedValueOnce({ data: null, error: {} });
  expect((await f.call()).status).toBe(503); expect(f.listUsers).not.toHaveBeenCalled();
});
it.each([{ email: "bad", delivery: "link" }, { email: "staff@example.test", delivery: "link", role: "admin" }, { email: "staff@example.test", delivery: "recovery" }])("rejects invalid or expanded invite authority: %j", async body => {
  const f = fixture(); expect((await f.call(body)).status).toBe(400); expect(f.listUsers).not.toHaveBeenCalled();
});
it("provisions a new case manager before generating the one-use link, with a verified actor", async () => {
  const f = fixture(); f.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
  const response = await f.call(); expect(await response.json()).toEqual({ status: "link", tokenHash: "a".repeat(64) });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(f.createUser).toHaveBeenCalledExactlyOnceWith({ email: "staff@example.test", email_confirm: false });
  expect(f.rpc).toHaveBeenCalledWith("operator_set_user_role", expect.objectContaining({ p_target_user_id: "staff-id", p_role: "case_manager", p_actor_label: "Workspace administrator admin-id" }));
  expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.generateLink.mock.invocationCallOrder[0]); expect(f.inviteUserByEmail).not.toHaveBeenCalled();
});
it("sends a normal invitation only after permissions save", async () => {
  const f = fixture(); expect(await (await f.call({ email: "staff@example.test", delivery: "email" })).json()).toEqual({ status: "sent" });
  expect(f.inviteUserByEmail).toHaveBeenCalledExactlyOnceWith("staff@example.test"); expect(f.generateLink).not.toHaveBeenCalled();
});
it("never creates account-takeover links or changes roles for confirmed accounts", async () => {
  const f = fixture(); f.listUsers.mockResolvedValue({ data: { users: [{ id: "staff-id", email: "staff@example.test", email_confirmed_at: "2026-10-18" }] }, error: null });
  expect(await (await f.call()).json()).toEqual({ status: "existing" }); expect(f.rpc).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
});
it.each([{ is_active: false, role: "case_manager" }, { is_active: true, role: "admin" }])("does not reactivate or demote an existing invitee: %j", async data => {
  const f = fixture(); f.maybeSingle.mockResolvedValue({ data, error: null }); expect((await f.call()).status).toBe(409); expect(f.rpc).not.toHaveBeenCalled(); expect(f.generateLink).not.toHaveBeenCalled();
});
it("preserves the partially provisioned account for retry and sends no link on a permission failure", async () => {
  const f = fixture(); f.rpc.mockResolvedValueOnce({ error: {} }); expect((await f.call()).status).toBe(503); expect(f.generateLink).not.toHaveBeenCalled();
  expect((await f.call()).status).toBe(200); expect(f.createUser).not.toHaveBeenCalled();
});
it("returns a safe failure after an ambiguous delivery and honors the provider cooldown", async () => {
  const f = fixture(); f.inviteUserByEmail.mockResolvedValue({ error: { status: 429, message: "private provider detail" } });
  const response = await f.call({ email: "staff@example.test", delivery: "email" }); expect(response.status).toBe(429); expect(await response.text()).not.toContain("private provider detail");
});
