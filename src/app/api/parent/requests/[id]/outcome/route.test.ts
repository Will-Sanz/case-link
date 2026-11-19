import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ visit:vi.fn(),outcome:vi.fn(),close:vi.fn() }));
vi.mock("@/lib/parent/activity",()=>({ reportParentFoodVisit:mocks.visit,reportParentOutcome:mocks.outcome,closeParentRequest:mocks.close }));
import { POST } from "./route";
const id="11111111-1111-4111-8111-111111111111";
beforeEach(()=>{ vi.stubEnv("NEXT_PUBLIC_SITE_URL","http://localhost:3200"); mocks.visit.mockResolvedValue({ eventId:"synthetic-owned-report" }); });
const context=()=>({ params:Promise.resolve({ id }) });
function post(body:unknown,origin="http://localhost:3200") { return new Request(`http://localhost:3200/api/parent/requests/${id}/outcome`,{ method:"POST",headers:{ origin,"content-type":"application/json" },body:JSON.stringify(body) }); }
it("routes the typed food report separately and returns its exact acknowledgement",async()=>{
  const input={ expectedVersion:1,siteId:"share-hunting-park-fridge",planHash:"a".repeat(64),reportKey:id,result:"no_food" };
  const response=await POST(post({ action:"food_visit",...input }),context());
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok:true,report:{ eventId:"synthetic-owned-report" } });
  expect(mocks.visit).toHaveBeenCalledExactlyOnceWith(id,input); expect(mocks.outcome).not.toHaveBeenCalled();
});
it("preserves generic outcome and close handling",async()=>{
  await POST(post({ need:"food_now",outcome:"support_received",reference:"Other family-reported food source" }),context());
  expect(mocks.outcome).toHaveBeenCalledOnce();
  await POST(post({ action:"close",reason:"parent_choice" }),context()); expect(mocks.close).toHaveBeenCalledExactlyOnceWith(id,{ reason:"parent_choice" });
});
it("rejects a foreign origin before any food report handler",async()=>{
  expect((await POST(post({ action:"food_visit" },"https://other.example"),context())).status).toBe(403); expect(mocks.visit).not.toHaveBeenCalled();
});
