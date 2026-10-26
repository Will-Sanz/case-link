import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getParentAuthorizationWindow } from "./authorization-window";

beforeEach(() => {
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});
describe("database-issued authorization timing", () => {
  it("uses the authenticated database window and normalizes only the timestamp representation", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        issuedAt: "2026-10-26T12:00:00+00:00",
        expiresAt: "2026-11-25T12:00:00+00:00",
      },
      error: null,
    });
    await expect(getParentAuthorizationWindow()).resolves.toEqual({
      issuedAt: "2026-10-26T12:00:00.000Z",
      expiresAt: "2026-11-25T12:00:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("parent_authorization_window");
  });
  it("requires a current parent session and fails closed on unavailable or malformed timing", async () => {
    mocks.session.mockRejectedValueOnce(new Error("Authentication required"));
    await expect(getParentAuthorizationWindow()).rejects.toThrow(
      "Authentication required",
    );
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "private-provider-canary" },
    });
    await expect(getParentAuthorizationWindow()).rejects.toThrow(
      "Authorization timing is temporarily unavailable.",
    );
    mocks.rpc.mockResolvedValueOnce({
      data: { issuedAt: "invalid", expiresAt: "invalid" },
      error: null,
    });
    await expect(getParentAuthorizationWindow()).rejects.toThrow();
  });
});
