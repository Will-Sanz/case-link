import { describe, expect, it, vi } from "vitest";
const getWindow = vi.hoisted(() => vi.fn());
vi.mock("@/lib/parent/authorization-window", () => ({
  getParentAuthorizationWindow: getWindow,
}));
import { GET } from "./route";

describe("authorization deadline endpoint", () => {
  it("returns an authenticated, uncached window without accepting a caller clock", async () => {
    const authorization = {
      issuedAt: "2026-10-26T12:00:00.000Z",
      expiresAt: "2026-11-25T12:00:00.000Z",
    };
    getWindow.mockResolvedValueOnce(authorization);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, authorization });
  });
  it("denies access when the parent session is unavailable", async () => {
    getWindow.mockRejectedValueOnce(new Error("Authentication required"));
    expect((await GET()).status).toBe(401);
  });
});
