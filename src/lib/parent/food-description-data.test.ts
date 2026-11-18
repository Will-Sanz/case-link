import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), require: vi.fn(), identity: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ createParentClient: mocks.client, requireParentSession: mocks.require }));
vi.mock("./account-deletion", () => ({ getParentDeletionStatus: mocks.identity }));
import { authorizeFoodDescriptionCollection, getFoodDescriptionArchive, mutateFoodDescription } from "./food-description-data";
import { FOOD_DESCRIPTION_NOTICE_VERSION } from "./food-description-draft";
const owner = "00000000-0000-4000-8000-000000000001", key = "00000000-0000-4000-8000-000000000002";
const create = { action: "create", expectedOwnerId: owner, idempotencyKey: key, noticeVersion: FOOD_DESCRIPTION_NOTICE_VERSION, consentAccepted: true };
beforeEach(() => { vi.clearAllMocks(); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.require.mockResolvedValue({ supabase: { rpc: mocks.rpc }, user: { id: owner } }); mocks.identity.mockResolvedValue({ ownerId: owner, status: "active" }); mocks.rpc.mockResolvedValue({ data: { ownerId: owner, available: false, drafts: [] }, error: null }); });
it("keeps closed-purpose archive reads separate from collection/auth enrollment", async () => {
  expect(await getFoodDescriptionArchive()).toEqual({ ownerId: owner, available: false, drafts: [] }); expect(mocks.require).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: { ownerId: key, available: false, drafts: [] }, error: null }); await expect(getFoodDescriptionArchive()).rejects.toMatchObject({ status: 503, code: "service" });
});
it("establishes server-owned consent ID before any description is in the create call", async () => {
  mocks.rpc.mockResolvedValue({ data: key, error: null }); expect(await mutateFoodDescription(create)).toEqual({ draftId: key, revision: 0 });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_create_food_description", { p_expected_owner: owner, p_create_key: key, p_notice_version: FOOD_DESCRIPTION_NOTICE_VERSION, p_consented: true });
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("description:");
});
it("checks owner before mutation and allows only exact canonical description bytes", async () => {
  mocks.identity.mockResolvedValue({ ownerId: key }); await expect(mutateFoodDescription(create)).rejects.toMatchObject({ status: 403 }); expect(mocks.rpc).not.toHaveBeenCalled();
  await expect(mutateFoodDescription({ action: "queue", expectedOwnerId: owner, draftId: key, expectedRevision: 0, idempotencyKey: key, input: { description: " need food ", screenLocale: "en" } })).rejects.toMatchObject({ status: 400 }); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("never collects before the signed-in owner and existing server-created ID are checked", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null }); await expect(authorizeFoodDescriptionCollection(key)).rejects.toMatchObject({ status: 403 });
  expect(mocks.rpc).toHaveBeenCalledWith("parent_food_description_upload_allowed", { p_draft: key });
  mocks.require.mockRejectedValue(new Error("auth required")); await expect(authorizeFoodDescriptionCollection(key)).rejects.toThrow("auth required");
});
it("cancels after collection closure and returns only bounded SQL errors", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null }); await mutateFoodDescription({ action: "cancel", expectedOwnerId: owner, draftId: key }); expect(mocks.require).not.toHaveBeenCalled();
  for (const [code, status] of [["42501", 403], ["PT409", 409], ["40001", 409], ["23514", 400], ["other", 503]] as const) {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE_PROVIDER_CANARY" } }); await expect(mutateFoodDescription(create)).rejects.toMatchObject({ status });
    try { await mutateFoodDescription(create); } catch (error) { expect(String(error)).not.toContain("PRIVATE_PROVIDER_CANARY"); }
  }
});
