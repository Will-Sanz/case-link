import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), require: vi.fn(), identity: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ createParentClient: mocks.client, requireParentSession: mocks.require }));
vi.mock("./account-deletion", () => ({ getParentDeletionStatus: mocks.identity }));
import { authorizeFoodDescriptionCollection, getFoodDescriptionArchive, mutateFoodDescription, startFoodDescriptionRequest } from "./food-description-data";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { SNAP_ES_TEMPLATE_ID } from "./snap-form-source";
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

it("sends only vetted enum/provenance metadata with the exact queue body and uses no second model port for clarification",async()=>{
  const routingAnswers={benefitHistory:{value:"never",confirmedAt:"2026-11-18T14:00:00Z"}};
  mocks.rpc.mockResolvedValue({data:1,error:null});await mutateFoodDescription({action:"queue",expectedOwnerId:owner,draftId:key,expectedRevision:0,idempotencyKey:key,input:{description:"Food help",screenLocale:"en"},routingAnswers});
  expect(mocks.rpc.mock.calls[0]).toEqual(["parent_queue_food_description",{p_draft_id:key,p_expected_owner:owner,p_expected_revision:0,p_queue_key:key,p_input:{description:"Food help",screenLocale:"en",routingAnswers}}]);
  await mutateFoodDescription({action:"resolve",expectedOwnerId:owner,draftId:key,expectedRevision:1,idempotencyKey:key,answers:{foodForTwoDays:"no",benefitHistory:"never",existingIssue:null},changedQuestionIds:["foodForTwoDays"]});
  expect(mocks.rpc.mock.calls[1][0]).toBe("parent_resolve_food_description");
});
it("routes the exact source/private SNAP/document-choice packet to one owned atomic SQL boundary",async()=>{
  mocks.rpc.mockResolvedValue({data:key,error:null});
  const input={descriptionSource:{draftId:key,revision:2},intake:fixtureIntake({needs:["food_now","snap_new"]}),mandate:fixtureMandate({recipientIds:["philly-food","snap-pa"]}),kind:"snap_application",details:{zip:"19104"},noticeVersion:SNAP_APPLICATION_NOTICE_VERSION,documentTemplateId:SNAP_ES_TEMPLATE_ID};
  expect(await startFoodDescriptionRequest(input,key)).toBe(key);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_start_food_description_request",{p_description_source:input.descriptionSource,p_intake:input.intake,p_mandate:input.mandate,p_idempotency_key:key,p_snap_details:input.details,p_snap_notice_version:input.noticeVersion,p_snap_template_id:SNAP_ES_TEMPLATE_ID});
});
