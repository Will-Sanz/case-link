import { describe, expect, it, vi } from "vitest";
import { signOutAction } from "./auth";
const m = vi.hoisted(() => ({ signOut: vi.fn(), redirect: vi.fn(() => { throw new Error("redirect marker"); }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signOut: m.signOut } }) }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
describe("sign out", () => {
  it.each(["returned", "thrown"])("does not claim success after a %s provider failure", async (kind) => {
    if (kind === "returned") m.signOut.mockResolvedValue({ error: {} });
    else m.signOut.mockRejectedValue(new Error("provider detail"));
    expect(await signOutAction()).toEqual({ error: expect.stringContaining("could not be confirmed") });
    expect(m.redirect).not.toHaveBeenCalled();
  });
  it("ends every refresh session before redirecting", async () => {
    m.signOut.mockResolvedValue({ error: null });
    await expect(signOutAction()).rejects.toThrow("redirect marker");
    expect(m.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(m.redirect).toHaveBeenCalledWith("/login");
  });
});
