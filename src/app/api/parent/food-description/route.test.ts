import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ available: vi.fn(), archive: vi.fn(), result: vi.fn(), mutate: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/parent/food-description-data", () => ({ authorizeFoodDescriptionCollection: mocks.authorize, foodDescriptionAvailable: mocks.available, getFoodDescriptionArchive: mocks.archive, getFoodDescriptionResult: mocks.result, mutateFoodDescription: mocks.mutate }));
import { DELETE, GET, POST, PATCH } from "./route";
import { FoodDescriptionError } from "@/lib/parent/food-description-draft";
const id = "00000000-0000-4000-8000-000000000001";
const request = (method: string, body: unknown, origin = "http://localhost") => new Request(`http://localhost/api/parent/food-description${body && typeof body === "object" && "action" in body && body.action === "queue" ? `?draft=${id}` : ""}`, { method, headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost"); mocks.available.mockResolvedValue(true); mocks.archive.mockResolvedValue({ ownerId: id, available: false, drafts: [] }); mocks.mutate.mockResolvedValue({ draftId: id, revision: 1 }); });
it("never reads a prose request body while the separate purpose is closed", async () => {
  mocks.available.mockResolvedValue(false); const input = request("POST", { action: "queue", input: { description: "PRIVATE_CANARY" } }), read = vi.spyOn(input, "body", "get");
  const reply = await POST(input); expect(reply.status).toBe(403); expect(read).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled(); expect(await reply.text()).not.toContain("PRIVATE_CANARY");
});
it("rejects foreign origins before body access and bounds JSON", async () => {
  const input = request("POST", {}, "https://foreign.invalid"), read = vi.spyOn(input, "body", "get"); expect((await POST(input)).status).toBe(403); expect(read).not.toHaveBeenCalled();
  expect((await POST(request("POST", { content: "a".repeat(4097) }))).status).toBe(400); expect(mocks.mutate).not.toHaveBeenCalled();
});
it("preserves the complete supplied queue body without inventing a request or mandate", async () => {
  const body = { action: "queue", draftId: id, expectedOwnerId: id, expectedRevision: 0, idempotencyKey: id, input: { description: "Food help", screenLocale: "en" } };
  expect((await POST(request("POST", body))).status).toBe(200); expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(body);
});
it("keeps retained export and cancellation available while collection is closed", async () => {
  mocks.available.mockResolvedValue(false); const exported = await GET(new Request("http://localhost/api/parent/food-description?download=1")); expect(exported.status).toBe(200); expect(exported.headers.get("cache-control")).toBe("private, no-store"); expect(exported.headers.get("content-disposition")).toContain("attachment");
  expect((await DELETE(request("DELETE", { action: "cancel", expectedOwnerId: id, draftId: id }))).status).toBe(200); expect(mocks.available).not.toHaveBeenCalled();
  expect((await DELETE(request("DELETE", { action: "cancel", expectedOwnerId: id, draftId: id, description: "PRIVATE_CANARY" }))).status).toBe(400);
});
it.each([[409, "changed"], [403, "unavailable"], [429, "resource_limit"], [503, "service"]] as const)("returns bounded %i errors without provider text", async (status, code) => {
  mocks.mutate.mockRejectedValue(new FoodDescriptionError(status, code)); const reply = await POST(request("POST", { action: "create" })); expect(reply.status).toBe(status); expect(await reply.json()).toEqual({ ok: false, code });
});

it.each(["project","feature","account3","combined60"])("never reads new prose when %s collection readiness is exhausted",async kind=>{
  mocks.available.mockResolvedValue(!["project","feature"].includes(kind)); mocks.authorize.mockRejectedValue(new FoodDescriptionError(403,"unavailable"));
  const input=request("POST",{action:"queue",draftId:id,expectedOwnerId:id,input:{description:"PRIVATE_CANARY"}}),read=vi.spyOn(input,"body","get");
  expect((await POST(input)).status).toBe(403);expect(read).not.toHaveBeenCalled();expect(mocks.mutate).not.toHaveBeenCalled();
});
it("keeps the already-reserved result readable when new collection capacity is exhausted",async()=>{
  mocks.available.mockResolvedValue(false);mocks.result.mockResolvedValue({state:"proposal",executionGranted:false});
  const reply=await GET(new Request(`http://localhost/api/parent/food-description?draft=${id}`));expect(reply.status).toBe(200);expect(mocks.available).not.toHaveBeenCalled();
});

it("resolves only typed routing enums after current owned-result authorization, without collection capacity or another model charge", async () => {
  mocks.available.mockResolvedValue(false); mocks.result.mockResolvedValue({ state: "needs_clarification" });
  const body = { action: "resolve", draftId: id, expectedOwnerId: id, expectedRevision: 1, idempotencyKey: id,
    answers: { foodForTwoDays: "no", benefitHistory: "never", existingIssue: null }, changedQuestionIds: ["foodForTwoDays", "benefitHistory"] };
  const reply = await PATCH(new Request(`http://localhost/api/parent/food-description?draft=${id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) }));
  expect(reply.status).toBe(200); expect(mocks.result).toHaveBeenCalledWith(id); expect(mocks.available).not.toHaveBeenCalled(); expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(body);
});
it("does not read clarification when its owner, source or purpose is unavailable", async () => {
  mocks.result.mockRejectedValue(new FoodDescriptionError(409, "changed"));
  const input = new Request(`http://localhost/api/parent/food-description?draft=${id}`, { method: "PATCH", headers: { origin: "http://localhost" }, body: "PRIVATE_BODY_CANARY" }), read=vi.spyOn(input,"body","get");
  expect((await PATCH(input)).status).toBe(409); expect(read).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
});
