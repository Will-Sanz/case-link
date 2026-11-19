import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { offboardUser } from "./offboard-user-operation";

const input = { targetUserId: "b885ceec-2701-4c0a-94ad-b5f426a1a9ce", replacementUserId: "a5a04f2f-30c0-48b4-a8a9-d17a854ef1df", actorLabel: "Test operator", reason: "Synthetic offboarding rehearsal" };
function client() {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const updateUserById = vi.fn().mockResolvedValue({ error: null });
  return { rpc, updateUserById, supabase: { rpc, auth: { admin: { updateUserById } } } as unknown as SupabaseClient };
}

describe("offboarding", () => {
  it("denies database access before banning Auth and revokes sessions again afterward", async () => {
    const c = client();
    await offboardUser(c.supabase, input);
    expect(c.rpc).toHaveBeenCalledTimes(2);
    expect(c.rpc).toHaveBeenCalledWith("operator_offboard_user", expect.objectContaining({ p_target_user_id: input.targetUserId, p_reassign_user_id: input.replacementUserId }));
    expect(c.updateUserById).toHaveBeenCalledWith(input.targetUserId, { ban_duration: "876000h" });
    expect(c.rpc.mock.invocationCallOrder[0]).toBeLessThan(c.updateUserById.mock.invocationCallOrder[0]);
    expect(c.rpc.mock.invocationCallOrder[1]).toBeGreaterThan(c.updateUserById.mock.invocationCallOrder[0]);
  });
  it.each(["database", "auth", "cleanup"])("reports a recoverable %s failure without a success message", async (stage) => {
    const c = client();
    if (stage === "database") c.rpc.mockResolvedValueOnce({ error: {} });
    if (stage === "auth") c.updateUserById.mockResolvedValueOnce({ error: {} });
    if (stage === "cleanup") c.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: {} });
    await expect(offboardUser(c.supabase, input)).rejects.toThrow(stage === "database" ? "did not complete" : "Retry this operation");
    if (stage === "database") expect(c.updateUserById).not.toHaveBeenCalled();
  });
  it("rejects invalid or self replacement before any change", async () => {
    const c = client();
    await expect(offboardUser(c.supabase, { ...input, replacementUserId: input.targetUserId })).rejects.toThrow("valid target/replacement");
    await expect(offboardUser(c.supabase, { ...input, reason: "" })).rejects.toThrow("valid target/replacement");
    expect(c.rpc).not.toHaveBeenCalled();
  });
});
