import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureMandate, fixtureRequest } from "./test-fixtures";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  window: vi.fn(),
}));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
vi.mock("./authorization-window", () => ({
  getParentAuthorizationWindow: mocks.window,
}));
import { replaceParentMandate } from "./mutations";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2028-01-01T00:00:00Z"));
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.window.mockResolvedValue({
    issuedAt: "2026-10-26T12:00:00.000Z",
    expiresAt: "2026-11-25T12:00:00.000Z",
  });
});
afterEach(() => vi.useRealTimers());

describe("authoritative permission renewal", () => {
  it("preserves the exact quoted or shorter deadline and version despite a wrong web clock", async () => {
    for (const expiresAt of [
      "2026-11-25T12:00:00.000Z",
      "2026-10-27T12:00:00.000Z",
    ]) {
      const mandate = fixtureMandate({ expiresAt });
      await replaceParentMandate(fixtureRequest().id, mandate, 3);
      expect(mocks.rpc).toHaveBeenLastCalledWith("parent_replace_mandate", {
        p_request_id: fixtureRequest().id,
        p_mandate: mandate,
        p_expected_version: 3,
      });
    }
  });
  it("keeps the strict trusted thirty-day ceiling and fails closed if timing is unavailable", async () => {
    await expect(
      replaceParentMandate(
        fixtureRequest().id,
        fixtureMandate({ expiresAt: "2026-12-01T00:00:00.000Z" }),
        3,
      ),
    ).rejects.toThrow("Check the named programs and permission expiry");
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.window.mockRejectedValueOnce(
      new Error("Authorization timing is temporarily unavailable."),
    );
    await expect(
      replaceParentMandate(fixtureRequest().id, fixtureMandate(), 3),
    ).rejects.toThrow("Authorization timing is temporarily unavailable.");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
