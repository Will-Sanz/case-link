import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), timing: vi.fn(), collection: vi.fn(), wicCollection: vi.fn(), pecoCollection: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getParentAuthorizationWindow } from "./authorization-window";
import { SNAP_APPLICATION_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION } from "./constants";
import { PECO_APPLICATION_NOTICE_VERSION } from "./peco-application-fields";

const timing = { issuedAt: "2026-10-26T12:00:00+00:00", expiresAt: "2026-11-25T12:00:00+00:00" };
beforeEach(() => {
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.timing.mockResolvedValue({ data: timing, error: null });
  mocks.collection.mockResolvedValue({ data: { collectionEnabled: false, noticeVersion: null }, error: null });
  mocks.wicCollection.mockResolvedValue({ data: { collectionEnabled: false, noticeVersion: null, expiresAt: null }, error: null });
  mocks.pecoCollection.mockResolvedValue({ data: { collectionEnabled: false, noticeVersion: null, expiresAt: null }, error: null });
  mocks.rpc.mockImplementation((name: string) => name === "parent_authorization_window" ? mocks.timing() : name === "parent_wic_application_collection" ? mocks.wicCollection() : name === "parent_peco_application_collection" ? mocks.pecoCollection() : mocks.collection());
});
describe("database-issued authorization timing", () => {
  it("preserves the original strict two-field RPC contract and composes separate collection status", async () => {
    await expect(getParentAuthorizationWindow()).resolves.toEqual({
      issuedAt: "2026-10-26T12:00:00.000Z", expiresAt: "2026-11-25T12:00:00.000Z",
      snapApplication: { collectionEnabled: false, noticeVersion: null },
      wicApplication: { collectionEnabled: false, noticeVersion: null, expiresAt: null },
      pecoApplication: { collectionEnabled: false, noticeVersion: null, expiresAt: null },
    });
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls).toEqual([["parent_authorization_window"], ["parent_snap_application_collection"], ["parent_wic_application_collection"], ["parent_peco_application_collection"]]);
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
      wicApplication: { collectionEnabled: false, noticeVersion: null, expiresAt: null },
      pecoApplication: { collectionEnabled: false, noticeVersion: null, expiresAt: null },
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
  it("keeps WIC independently closed while SNAP is approved, and closes WIC if its RPC is unavailable", async () => {
    mocks.collection.mockResolvedValue({ data: { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION }, error: null });
    expect((await getParentAuthorizationWindow()).wicApplication).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
    mocks.wicCollection.mockRejectedValue(new Error("private-wic-canary"));
    expect((await getParentAuthorizationWindow()).wicApplication).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
  });
  it("keeps PECO separate from SNAP/WIC and closes it on unavailable or malformed purpose evidence", async () => {
    const peco = { collectionEnabled: true, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, expiresAt: "2026-11-20T20:06:00Z" };
    mocks.pecoCollection.mockResolvedValue({ data: peco, error: null });
    const allowed = await getParentAuthorizationWindow();
    expect(allowed.pecoApplication).toEqual(peco);
    expect(allowed.wicApplication.collectionEnabled).toBe(false);
    expect(allowed.snapApplication.collectionEnabled).toBe(false);
    mocks.pecoCollection.mockRejectedValueOnce(new Error("private-peco-canary"));
    expect((await getParentAuthorizationWindow()).pecoApplication).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
    mocks.pecoCollection.mockResolvedValue({ data: { ...peco, noticeVersion: WIC_APPLICATION_NOTICE_VERSION }, error: null });
    await expect(getParentAuthorizationWindow()).rejects.toThrow("Authorization timing is temporarily unavailable.");
  });
  it("accepts only the separate WIC notice and refuses a SNAP notice or extra private fields", async () => {
    const wic = { collectionEnabled: true, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, expiresAt: "2026-11-20T18:57:45.283Z" };
    mocks.wicCollection.mockResolvedValue({ data: wic, error: null });
    expect((await getParentAuthorizationWindow()).wicApplication).toEqual(wic);
    for (const data of [{ collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION }, { ...wic, privateCanary: "health" }]) {
      mocks.wicCollection.mockResolvedValue({ data, error: null });
      await expect(getParentAuthorizationWindow()).rejects.toThrow("Authorization timing is temporarily unavailable.");
    }
  });
});
