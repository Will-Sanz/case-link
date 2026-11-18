import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindFoodAccessReport, buildFoodAccessPlanBody, foodAccessPlanSchema } from "./food-access";
import { parentError } from "./http";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session, createParentClient: vi.fn() }));
import { reportParentFoodVisit } from "./activity";
const id = "11111111-1111-4111-8111-111111111111", eventId = "22222222-2222-4222-8222-222222222222";
const plan = foodAccessPlanSchema.parse({ ...buildFoodAccessPlanBody({ requestId:id,requestVersion:2,generatedAt:"2026-11-18T12:00:00Z",sourceReviewCurrent:true }),planHash:"a".repeat(64) });
const input = { expectedVersion:2,siteId:plan.site.id,planHash:plan.planHash,reportKey:eventId,result:"no_food" as const };
const saved = bindFoodAccessReport(plan,input,{ eventId,reportedAt:"2026-11-18T12:01:00Z" });
beforeEach(() => { mocks.session.mockResolvedValue({ supabase:{ rpc:mocks.rpc } }); mocks.rpc.mockResolvedValue({ data:saved,error:null }); });
describe("owned public food report data boundary", () => {
  it("sends one exact typed mutation and validates the saved report without retrying a write", async () => {
    expect(await reportParentFoodVisit(id,input)).toEqual(saved);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_report_food_visit", { p_request_id:id,p_expected_version:2,p_site_id:plan.site.id,p_plan_hash:plan.planHash,p_report_key:eventId,p_result:"no_food" });
  });
  it.each([{ attribution:"provider_api" },{ sourceVersion:"forged" },{ accountNumber:"PRIVATE-CANARY" },{ siteId:"other" }])("rejects forged or private input before a session/RPC %#", async change => {
    await expect(reportParentFoodVisit(id,{ ...input,...change })).rejects.toThrow(); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["PT409",409],["40001",409],["42501",403],["23514",400],["XX000",500]])("keeps SQL %s private with the correct recovery status", async (code,status) => {
    mocks.rpc.mockResolvedValue({ data:null,error:{ code,message:"PRIVATE-CANARY" } });
    const error = await reportParentFoodVisit(id,input).catch(error=>error); const response=parentError(error);
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("PRIVATE-CANARY"); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it.each([null,{ ...saved,requestId:eventId },{ ...saved,result:"received_enough_food",outcome:"support_received" },{ ...saved,raw:"PRIVATE-CANARY" }])("keeps an unconfirmed or mismatched acknowledgement uncertain %#", async data => {
    mocks.rpc.mockResolvedValue({ data,error:null }); const error=await reportParentFoodVisit(id,input).catch(error=>error);
    expect(parentError(error).status).toBe(500); expect(error.message).not.toContain("PRIVATE-CANARY"); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
