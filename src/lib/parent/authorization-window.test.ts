import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), timing: vi.fn(), collection: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getParentAuthorizationWindow } from "./authorization-window";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";

const timing = { issuedAt: "2026-10-26T12:00:00+00:00", expiresAt: "2026-11-25T12:00:00+00:00" };
beforeEach(() => {
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.timing.mockResolvedValue({ data: timing, error: null });
  mocks.collection.mockResolvedValue({ data: { collectionEnabled: false, noticeVersion: null }, error: null });
  mocks.rpc.mockImplementation((name: string) => name === "parent_authorization_window" ? mocks.timing() : mocks.collection());
});
describe("database-issued authorization timing", () => {
  it("preserves the original strict two-field RPC contract and composes separate collection status", async () => {
    await expect(getParentAuthorizationWindow()).resolves.toEqual({
      issuedAt: "2026-10-26T12:00:00.000Z", expiresAt: "2026-11-25T12:00:00.000Z",
      snapApplication: { collectionEnabled: false, noticeVersion: null },
    });
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls).toEqual([["parent_authorization_window"], ["parent_snap_application_collection"]]);
  });
  it("exposes only a separately approved SNAP collection purpose and its accepted notice", async () => {
    const snapApplication = { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION };
    mocks.collection.mockResolvedValue({ data: snapApplication, error: null });
    expect((await getParentAuthorizationWindow()).snapApplication).toEqual(snapApplication);
  });
  it.each(["42883", "PGRST202", "42501", "XX000"])("keeps collection closed when its separate RPC is unavailable (%s)", async code => {
    mocks.collection.mockResolvedValue({ data: null, error: { code, message: "private-provider-canary" } });
    expect(await getParentAuthorizationWindow()).toEqual({
      issuedAt: "2026-10-26T12:00:00.000Z", expiresAt: "2026-11-25T12:00:00.000Z",
      snapApplication: { collectionEnabled: false, noticeVersion: null },
    });
  });
  it("keeps collection closed if its separate request rejects", async () => {
    mocks.collection.mockRejectedValue(new Error("private-provider-canary"));
    expect((await getParentAuthorizationWindow()).snapApplication).toEqual({ collectionEnabled: false, noticeVersion: null });
  });
  it.each([
    null, { collectionEnabled: true, noticeVersion: null }, { collectionEnabled: true, noticeVersion: "unreviewed-purpose" },
    { collectionEnabled: false, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION }, { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, "private-value-canary": true },
  ])("fails closed with a fixed error for a malformed successful collection response: %j", async data => {
    mocks.collection.mockResolvedValue({ data, error: null });
    await expect(getParentAuthorizationWindow()).rejects.toThrow("Authorization timing is temporarily unavailable.");
  });
  it("rejects any extra timing fields rather than changing the original RPC contract", async () => {
    mocks.timing.mockResolvedValue({ data: { ...timing, snapApplication: { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION } }, error: null });
    await expect(getParentAuthorizationWindow()).rejects.toThrow("Authorization timing is temporarily unavailable.");
  });
  it("requires a current parent session and fails closed on unavailable or malformed timing", async () => {
    mocks.session.mockRejectedValueOnce(new Error("Authentication required"));
    await expect(getParentAuthorizationWindow()).rejects.toThrow("Authentication required");
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.timing.mockResolvedValueOnce({ data: null, error: { message: "private-provider-canary" } });
    await expect(getParentAuthorizationWindow()).rejects.toThrow("Authorization timing is temporarily unavailable.");
    mocks.timing.mockResolvedValueOnce({ data: { issuedAt: "invalid", expiresAt: "invalid" }, error: null });
    await expect(getParentAuthorizationWindow()).rejects.toThrow("Authorization timing is temporarily unavailable.");
  });
});
