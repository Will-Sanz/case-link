import { beforeEach, expect, it, vi } from "vitest";
import { fixtureMandate, fixtureRequest } from "./test-fixtures";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() } }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { applySupportUpdate, getSupportUpdateContext } from "./support-update-data";
import { parentError } from "./http";
const id = fixtureRequest().id, key = "22222222-2222-4222-8222-222222222222", ownerId = "33333333-3333-4333-8333-333333333333";
const receipt = { id: key, key, requestId: id, action: "replace_mandate", baseVersion: 1, resultVersion: 2, recordedAt: "2026-11-18T12:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: ownerId }, supabase: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockResolvedValue({ data: receipt, error: null }); mocks.from.mockReturnValue(mocks.query);
  mocks.query.select.mockReturnValue(mocks.query); mocks.query.eq.mockReturnValue(mocks.query);
  mocks.query.maybeSingle.mockResolvedValue({ data: null, error: null });
});
it("delegates a structurally valid exact historical mandate without a new authorization quote", async () => {
  const value = { action: "replace_mandate" as const, version: 1, mandate: fixtureMandate({ expiresAt: "2020-01-01T00:00:00Z" }) };
  expect(await applySupportUpdate(id, key, value)).toEqual({ ownerId, receipt });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_apply_support_update", { p_request_id: id, p_idempotency_key: key, p_update: value });
});
it.each([["PT409", "This request changed"], ["40001", "This request changed"], ["42501", "This request is unavailable"], ["23514", "parent_invalid_input"]])("maps %s without leaking private database details", async (code, expected) => {
  mocks.rpc.mockResolvedValueOnce({ error: { code, message: "PrivateFactCanary" } });
  await expect(applySupportUpdate(id, key, { action: "booking_preference", version: 1, preference: "any_weekday" })).rejects.toThrow(expected);
});
it("does not quote another deadline when an owned receipt already exists", async () => {
  mocks.query.maybeSingle.mockResolvedValueOnce({ data: { id: key, idempotency_key: key, request_id: id, action: receipt.action, base_version: 1, result_version: 2, created_at: receipt.recordedAt }, error: null });
  expect(await getSupportUpdateContext(id, key)).toEqual({ ownerId, receipt, expiresAt: null, issuedAt: null });
  expect(mocks.query.eq).toHaveBeenCalledWith("request_id", id); expect(mocks.query.eq).toHaveBeenCalledWith("idempotency_key", key);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("uses only the existing authoritative timing RPC for a new quote, and preserves readback if it is unavailable", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { issuedAt: "2026-11-18T12:00:00Z", expiresAt: "2026-12-18T12:00:00Z" }, error: null });
  expect(await getSupportUpdateContext(id, key)).toEqual({ ownerId, receipt: null, issuedAt: "2026-11-18T12:00:00Z", expiresAt: "2026-12-18T12:00:00Z" });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_authorization_window");
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect(await getSupportUpdateContext(id, key)).toEqual({ ownerId, receipt: null, issuedAt: null, expiresAt: null });
});
it("fails closed on history/session failures rather than treating them as an absent receipt", async () => {
  mocks.query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "private" } });
  await expect(getSupportUpdateContext(id, key)).rejects.toThrow("history is temporarily unavailable"); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.session.mockRejectedValueOnce(new Error("Sign in again"));
  await expect(applySupportUpdate(id, key, { action: "booking_preference", version: 1, preference: "any_weekday" })).rejects.toThrow("Sign in again");
});
it("reports malformed post-commit or history metadata as unknown500 rather than an uncommitted400", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: {}, error: null });
  const postError = await applySupportUpdate(id, key, { action: "booking_preference", version: 1, preference: "any_weekday" }).then(() => null, cause => cause);
  expect(postError).toBeInstanceOf(Error); expect(parentError(postError).status).toBe(500);
  mocks.query.maybeSingle.mockResolvedValueOnce({ data: { id: key }, error: null });
  const readError = await getSupportUpdateContext(id, key).then(() => null, cause => cause);
  expect(readError).toBeInstanceOf(Error); expect(parentError(readError).status).toBe(500);
});
