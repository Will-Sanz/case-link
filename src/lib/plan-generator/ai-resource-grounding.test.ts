import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiResponse } from "@/lib/ai/client";
import { askCaseAssistant } from "@/lib/case-assistant/ai-case-assistant";
import { tryGenerateLeanPlanPhaseOpenAI } from "./openai-plan-lean-phase";
import { previewRefinePlanStepsWithOpenAI } from "./openai-plan";
import { buildPlanningSnapshot } from "./planning-brief";
import { sparseDetailsForPersistence } from "./lean-plan-schema";
import type { DraftStepRefineInput } from "./plan-refine-lean";
import { directoryCase, directoryId } from "../../../tests/fixtures/directory-case";
import { generatedPlanStep, refinedPlanStep } from "../../../tests/fixtures/plan-contract";
import type { FamilyDetail } from "@/types/family";
vi.mock("@/lib/ai/client", () => ({ createAiResponse: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ OPENAI_API_KEY: "synthetic" }) }));

const draft: DraftStepRefineInput = { ...refinedPlanStep, updated_at: "2026-10-13T12:00:00Z", status: "pending",
  details: { expected_outcome: "Ready", contacts: [{ name: "Legacy person", email: "legacy@example.test" }] },
  action_items: refinedPlanStep.action_items.map(action => ({ ...action, updated_at: "2026-10-13T12:00:00Z", status: "pending", notes: null, outcome: null, follow_up_date: null })),
};
const paths = ["generation", "step_refinement", "plan_refinement", "assistant"] as const;
type Path = typeof paths[number];
async function run(path: Path, detail: FamilyDetail) {
  if (path === "assistant") return askCaseAssistant(detail,"Help plan the intake");
  if (path === "generation") {
    const snapshot = buildPlanningSnapshot(detail);
    const result = await tryGenerateLeanPlanPhaseOpenAI(snapshot,"30",{retries:1});
    return result.ok ? {ok:true,contacts:sparseDetailsForPersistence(result.steps[0],snapshot.resource_catalog).contacts} : result;
  }
  const result = await previewRefinePlanStepsWithOpenAI(detail,[draft],"Clarify intake",{taskType:path});
  return result.ok ? {ok:true,contacts:result.steps[0].details.contacts} : result;
}
function reply(path: Path, ids: string[], prose = "Confirm available intake options.", extra = false) {
  const contactFields = extra ? { contacts: [{phone:"215-555-9999"}] } : {};
  return path === "assistant" ? {answer:prose,resource_ids:ids,...contactFields}
    : {steps:[path === "generation" ? {...generatedPlanStep,summary:prose,resource_ids:ids,...contactFields}
      : {...refinedPlanStep,description:prose,resource_ids:ids,...contactFields}]};
}
beforeEach(() => vi.mocked(createAiResponse).mockReset());
describe.each(paths)("%s directory grounding", path => {
  it("selects source facts without sending contact values or legacy contacts to AI", async () => {
    vi.mocked(createAiResponse).mockResolvedValue({ok:true,model:"test",text:JSON.stringify(reply(path,[directoryId]))});
    const result = await run(path,directoryCase());
    expect(result).toMatchObject({ok:true,contacts:[{source_resource_id:directoryId}]});
    if (path === "generation") expect(JSON.stringify(result)).not.toMatch(/215-555|intake@/);
    else expect(result).toMatchObject({contacts:[{phone:"215-555-0148",email:"intake@example.test"}]});
    const payload = JSON.stringify(vi.mocked(createAiResponse).mock.calls[0][0]);
    expect(payload).not.toMatch(/215-555|intake@|legacy@|Directoryperson|Legacy person/);
  });
  it.each(["unknown","duplicate","dismissed","inactive","demo","no resource","phone","email","url","extra contacts"])("rejects %s model facts without a substitute", async kind => {
    const detail = directoryCase();
    if (kind === "dismissed") detail.resourceMatches[0].status = "dismissed";
    if (kind === "inactive") detail.resourceMatches[0].resource!.active = false;
    if (kind === "demo") detail.resourceMatches[0].resource!.is_demo = true;
    if (kind === "no resource") detail.resourceMatches = [];
    const ids = kind === "unknown" ? ["90000000-0000-4000-8000-000000000009"] : kind === "duplicate" ? [directoryId,directoryId] : [directoryId];
    const prose = kind === "phone" ? "Call 215-555-9999" : kind === "email" ? "Email madeup@example.test" : kind === "url" ? "Apply at https://example.test/apply" : undefined;
    vi.mocked(createAiResponse).mockResolvedValue({ok:true,model:"test",text:JSON.stringify(reply(path,ids,prose,kind === "extra contacts"))});
    expect(await run(path,detail)).toMatchObject({ok:false});
  });
  it("allows generic work without a directory match and never fills missing contact values", async () => {
    const detail = directoryCase(); detail.resourceMatches = [];
    vi.mocked(createAiResponse).mockResolvedValue({ok:true,model:"test",text:JSON.stringify(reply(path,[]))});
    expect(await run(path,detail)).toMatchObject({ok:true,contacts:[]});
  });
});
