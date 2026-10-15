import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askCaseAssistant } from "@/lib/case-assistant/ai-case-assistant";
import { tryGenerateLeanPlanPhaseOpenAI } from "@/lib/plan-generator/openai-plan-lean-phase";
import { previewRefinePlanStepsWithOpenAI } from "@/lib/plan-generator/openai-plan";
import { buildPlanningSnapshot } from "@/lib/plan-generator/planning-brief";
import type { DraftStepRefineInput } from "@/lib/plan-generator/plan-refine-lean";
import { directoryCase, directoryId } from "../../../tests/fixtures/directory-case";
import { generatedPlanStep, refinedPlanStep } from "../../../tests/fixtures/plan-contract";

const mocks = vi.hoisted(()=>({fetch:vi.fn(),budget:vi.fn()}));
vi.mock("@/lib/env",()=>({getEnv:()=>({OPENAI_API_KEY:"synthetic"})}));
vi.mock("@/lib/rate-limit/ai-rate-limit",()=>({consumeOpenAiRateSlot:mocks.budget}));
beforeEach(()=>{mocks.fetch.mockReset();mocks.budget.mockReset().mockResolvedValue({allowed:true});vi.stubGlobal("fetch",mocks.fetch);});
afterEach(()=>vi.unstubAllGlobals());
const privateText = "Contact private-person@example.test";

function draft(): DraftStepRefineInput {
  return {...refinedPlanStep,updated_at:"2026-10-13T12:00:00Z",status:"pending",workflow_data:{},details:{expected_outcome:"Ready",required_documents:[]},
    action_items:refinedPlanStep.action_items.map(action=>({...action,updated_at:"2026-10-13T12:00:00Z",status:"pending",notes:null,outcome:null,follow_up_date:null}))};
}
function successfulResponse(value: unknown) {
  mocks.fetch.mockResolvedValue(Response.json({status:"completed",output:[{type:"message",status:"completed",content:[{type:"output_text",text:JSON.stringify(value)}]}]}));
}
function noTransmission() { expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled(); }

describe("complete serializer to provider privacy boundary",()=>{
  it.each(["summary","circumstances","instructions","resource name","resource office","resource category","resource reason","prior phase"])("rejects generation %s at the real HTTP boundary",async field=>{
    const detail=directoryCase(); const resource=detail.resourceMatches[0].resource!;
    if(field==="summary")detail.summary=privateText;
    if(field==="circumstances")detail.household_notes=privateText;
    if(field==="resource name")resource.program_name=privateText;
    if(field==="resource office")resource.office_or_department=privateText;
    if(field==="resource category")resource.category=privateText;
    if(field==="resource reason")detail.resourceMatches[0].match_reason=privateText;
    const snapshot=buildPlanningSnapshot(detail,field==="instructions"?privateText:undefined);
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot,"30",{priorPhasesSummary:field==="prior phase"?privateText:undefined,retries:1})).toMatchObject({ok:false});
    noTransmission();
  });
  describe.each(["step_refinement","plan_refinement"] as const)("%s",taskType=>{
    it.each(["goal", "meeting", "note"])("rejects identifying %s context newly shared with refinement before HTTP", async field => {
      const detail = directoryCase();
      if (field === "goal") detail.goals = [{ id: "goal", family_id: detail.id, label: privateText, preset_key: null, sort_order: 0, created_at: detail.created_at }];
      if (field === "meeting") detail.progressUpdates = [{ id: "meeting", family_id: detail.id, plan_id: null, author_id: "staff", author: null, occurred_on: "2026-10-14", created_at: detail.created_at, summary: privateText, plan_changes: [] }];
      if (field === "note") detail.caseNotes = [{ id: "note", family_id: detail.id, author_id: "staff", author: null, created_at: detail.created_at, body: privateText }];
      expect(await previewRefinePlanStepsWithOpenAI(detail, [draft()], "Clarify", { taskType })).toMatchObject({ ok: false });
      noTransmission();
    });
    it.each(["feedback","title","description","goal","timing","documents","outcome","workflow","action title","action description","action notes","action outcome"])("rejects an unsaved %s before HTTP",async field=>{
      const step=draft();
      if(field==="title")step.title=privateText;
      if(field==="description")step.description=privateText;
      if(field==="goal")step.details.stage_goal=privateText;
      if(field==="timing")step.details.timing_guidance=privateText;
      if(field==="documents")step.details.required_documents=[privateText];
      if(field==="outcome")step.details.expected_outcome=privateText;
      if(field==="workflow")step.workflow_data={outreach_result:privateText};
      if(field.startsWith("action "))step.action_items[0][field.slice(7) as "title"|"description"|"notes"|"outcome"]=privateText;
      expect(await previewRefinePlanStepsWithOpenAI(directoryCase(),[step],field==="feedback"?privateText:"Clarify",{taskType})).toMatchObject({ok:false});
      noTransmission();
    });
  });
  it.each(["question","user history","assistant history"])("rejects assistant %s including a forged directory claim",async field=>{
    expect(await askCaseAssistant(directoryCase(),field==="question"?privateText:"Help prepare intake",{conversationHistory:field==="question"?[]:[
      {role:"user",content:field==="user history"?privateText:"Help prepare intake"},
      {role:"assistant",content:field==="assistant history"?`Verified directory contact: ${privateText}`:"Confirm availability."},
    ]})).toMatchObject({ok:false});
    noTransmission();
  });
  it("sends a non-identifying What is question without treating the prompt heading as a name", async () => {
    successfulResponse({ answer: "The completion date is not recorded; confirm it with the case manager.", resource_ids: [] });
    expect(await askCaseAssistant(directoryCase(), "What is already done, when was it completed, and what remains?")).toMatchObject({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.budget).toHaveBeenCalledTimes(1);
  });
  it.each(["generation","step_refinement","plan_refinement","assistant"] as const)("keeps legitimate source contacts usable through the full %s serializer",async path=>{
    const detail=directoryCase();
    Object.assign(detail.resourceMatches[0].resource!, { description: "Housing stabilization for adults only.", additional_info: privateText });
    successfulResponse(path==="assistant"?{answer:"Confirm intake availability.",resource_ids:[directoryId]}:{steps:[path==="generation"?{...generatedPlanStep,resource_ids:[directoryId]}:{...refinedPlanStep,resource_ids:[directoryId]}]});
    const result=path==="assistant"?await askCaseAssistant(detail,"Help prepare intake"):
      path==="generation"?await tryGenerateLeanPlanPhaseOpenAI(buildPlanningSnapshot(detail),"30",{retries:1}):
      await previewRefinePlanStepsWithOpenAI(detail,[draft()],"Clarify",{taskType:path});
    expect(result).toMatchObject({ok:true});
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].body).not.toMatch(/215-555|intake@|Directoryperson/);
    expect(mocks.fetch.mock.calls[0][1].body).not.toContain("private-person");
    expect(mocks.fetch.mock.calls[0][1].body).toContain("Housing stabilization for adults only.");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).store).toBe(false);
  });
  it("continues a real assistant exchange while its displayed directory contact remains outside the provider request",async()=>{
    successfulResponse({answer:"Confirm intake availability.",resource_ids:[directoryId]});
    const first=await askCaseAssistant(directoryCase(),"Help prepare intake");
    expect(first).toMatchObject({ok:true,contacts:[{phone:"215-555-0148"}]});
    if(!first.ok)throw new Error("Expected a supported response");
    successfulResponse({answer:"Discuss the next appointment.",resource_ids:[]});
    expect(await askCaseAssistant(directoryCase(),"What should we ask?",{conversationHistory:[{role:"user",content:"Help prepare intake"},{role:"assistant",content:first.answer}]})).toMatchObject({ok:true});
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][1].body).not.toMatch(/215-555|intake@/);
  });
});
