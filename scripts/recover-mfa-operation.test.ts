import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { recoverMfaUser } from "./recover-mfa-operation";

const input = { targetUserId: "5507089c-906f-4a6c-9d56-2d34d9d36513", siteOrigin: "https://school.example", actorLabel: "Test operator", reason: "Independent identity check completed", identityVerified: true };
function fixture() {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const send = vi.fn().mockResolvedValue({ error: null });
  const client = { rpc, auth: { resetPasswordForEmail: send, admin: { getUserById: async () => ({ data: { user: { email: "staff@example.test" } } }), updateUserById: update, mfa: { listFactors: async () => ({ data: { factors: [{ id: "factor-id" }] } }), deleteFactor: remove } } } } as unknown as SupabaseClient;
  return { client, rpc, update, remove, send };
}
it("revokes sessions and invalidates the old password before removing factors or sending recovery", async () => {
  const f = fixture();
  await recoverMfaUser(f.client, input);
  expect(f.rpc).toHaveBeenCalledWith("operator_revoke_mfa_sessions", expect.objectContaining({ p_stage: "started" }));
  expect(f.rpc).toHaveBeenLastCalledWith("operator_revoke_mfa_sessions", expect.objectContaining({ p_stage: "ready" }));
  expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.update.mock.invocationCallOrder[0]);
  expect(f.update.mock.invocationCallOrder[0]).toBeLessThan(f.remove.mock.invocationCallOrder[0]);
  expect(f.remove.mock.invocationCallOrder[0]).toBeLessThan(f.rpc.mock.invocationCallOrder[1]);
  expect(f.rpc.mock.invocationCallOrder[1]).toBeLessThan(f.send.mock.invocationCallOrder[0]);
  expect(f.update.mock.calls[0][1].password.length).toBeGreaterThan(40);
});
it("refuses recovery without an explicit identity-check record", async () => {
  const f = fixture();
  await expect(recoverMfaUser(f.client, { ...input, identityVerified: false })).rejects.toThrow("identity check");
  expect(f.rpc).not.toHaveBeenCalled();
});
it.each(["start", "password", "factor", "cleanup", "email"])("stops and reports an incomplete %s stage", async (stage) => {
  const f = fixture();
  if (stage === "start") f.rpc.mockResolvedValueOnce({ error: {} });
  if (stage === "password") f.update.mockResolvedValueOnce({ error: {} });
  if (stage === "factor") f.remove.mockResolvedValueOnce({ error: {} });
  if (stage === "cleanup") f.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: {} });
  if (stage === "email") f.send.mockResolvedValueOnce({ error: {} });
  await expect(recoverMfaUser(f.client, input)).rejects.toThrow();
  if (stage !== "email") expect(f.send).not.toHaveBeenCalled();
  if (stage === "start" || stage === "password") expect(f.remove).not.toHaveBeenCalled();
});
