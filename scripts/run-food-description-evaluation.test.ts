import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT } from "../src/lib/parent/food-description-runtime";
import { FOOD_DESCRIPTION_CORPUS_SHA, withFoodDescriptionEvaluationBudget } from "./food-description-evaluation-budget";
import { descriptionEvaluationPlan } from "./food-description-evaluation-adapter";
import { foodDescriptionEvaluationCommand } from "./run-food-description-evaluation";
import { sealedDescriptionEvaluationPriors } from "./food-description-evaluation-test-fixtures";
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});vi.useRealTimers();});
it("dry mode enumerates all240 rows/80 maximum calls and24 rejected guards without reading approvals/keys or touching HTTP",async()=>{
  const fetcher=vi.fn<typeof fetch>();
  const result=await foodDescriptionEvaluationCommand(["--dry"],{OPENAI_API_KEY:"ignored-legacy",CASELINK_PARENT_RUN_LIVE_EVALS:"1",CASELINK_FOOD_DESCRIPTION_EVAL_API_KEY:"not-read-in-dry"},fetcher);
  expect(result).toMatchObject({mode:"dry",caseCount:60,turnCount:240,maximumModelCalls:80,zeroCallGuardCases:24,modelCalls:0,countRequests:0,humanReviewedCases:0});
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not accept legacy spending flags or a source-unbound new approval",async()=>{
  const fetcher=vi.fn<typeof fetch>();
  await expect(foodDescriptionEvaluationCommand(["--approved-live","/unavailable-approval.json","0"],{OPENAI_API_KEY:"legacy",CASELINK_PARENT_RUN_LIVE_EVALS:"1"},fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
async function approvedFixture(priorCount: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 = 14){
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(priorCount>=8?"2026-11-19T16:00:00Z":priorCount>=5?"2026-11-19T00:30:00Z":"2026-11-18T16:00:00Z"));
  const root=mkdtempSync(join(tmpdir(),"description-command-"));roots.push(root);
  const dry=await foodDescriptionEvaluationCommand(["--dry"],{});if(!("adapterSha256" in dry))throw new Error("Expected a dry plan");
  const approval={purpose:"optional_food_description_synthetic_evaluation_v1",syntheticOnly:true,approvalReference:"SYNTHETIC UNIT TEST ONLY",approvedUntil:priorCount>=8?"2026-11-20T04:59:59Z":priorCount>=5?"2026-11-19T04:59:59Z":"2026-11-18T23:00:00Z",processorReference:"synthetic",noticeRetentionReference:"synthetic",billingReference:"synthetic",projectId:"proj_synthetic",projectMetadataReference:"synthetic Standard global",approvedResponseModelId:"gpt-6.1-sol",region:"global",serviceTier:"default",fingerprint:FOOD_DESCRIPTION_FINGERPRINT,corpusSha256:FOOD_DESCRIPTION_CORPUS_SHA,adapterSha256:dry.adapterSha256,rateCardDate:priorCount>=5?"2026-11-19":"2026-11-18",maximumCalls:80,maximumCountRequests:80,maximumInputTokens:8000,maximumOutputTokens:1500,maximumNanoDollars:5_000_000_000,runDirectory:join(root,"run")};
  const projection=descriptionEvaluationPlan().cases[0].turns[0].projection;
  const init={method:"POST",redirect:"error" as const,headers:{Authorization:"Bearer synthetic","Content-Type":"application/json","OpenAI-Project":"proj_synthetic"},body:JSON.stringify({...FOOD_DESCRIPTION_EVALUATION_BINDING.request,input:[{role:"user",content:JSON.stringify(projection)}]})};
  const maximum=priorCount===14?315 as const:priorCount===13?278 as const:priorCount===12?274 as const:priorCount===11?269 as const:priorCount===10?267 as const:priorCount===9?204 as const:priorCount===2?87 as const:priorCount===3?93 as const:priorCount===4?100 as const:priorCount===5?120 as const:priorCount===6?133 as const:priorCount===7?172 as const:182 as const;
  const aggregate={maximumCalls:maximum,maximumCountRequests:maximum,maximumNanoDollars:5_000_000_000 as const,priorRuns:await sealedDescriptionEvaluationPriors(approval,init,priorCount===14?14:priorCount===13?13:priorCount===12?12:priorCount===11?11:priorCount===10?10:priorCount===9?9:priorCount===8?8:priorCount===7?7:priorCount===6?6:priorCount===5?5:priorCount===4?4:priorCount===3)};
  const currentApproval={...approval,aggregate};
  const config=join(root,"approval.json"),bytes=JSON.stringify({sourceSha256:dry.sourceSha256,approval:currentApproval});writeFileSync(config,bytes,{mode:0o600});
  const hash=createHash("sha256").update(bytes).digest("hex");
  const env={CASELINK_FOOD_DESCRIPTION_EVAL_NEW_APPROVAL:"1",CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256:hash,CASELINK_FOOD_DESCRIPTION_EVAL_API_KEY:"synthetic"};
  return {approval:currentApproval,config,hash,env};
}
describe("exact source-bound approval", () => {
let currentFixture: Awaited<ReturnType<typeof approvedFixture>>;
beforeAll(async () => { currentFixture = await approvedFixture(); });
it("uses the actual driver only after a hash-bound new approval, halts unknown billing, and reads retained evidence after closure without a key",async()=>{
  const {approval,config,hash,env}=currentFixture;
  let generation=0;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url,init)=>{
    if(String(url).endsWith("/input_tokens"))return Response.json({object:"response.input_tokens",input_tokens:3000});
    generation++;const request=JSON.parse(String(init?.body)),p=JSON.parse(request.input[0].content),description=p.description as string;
    const span=(text:string)=>({start:description.indexOf(text),end:description.indexOf(text)+text.length,text});
    const selection={needIds:["food_now","snap_new"],selections:[],assertions:[{questionId:"foodForTwoDays",value:"no",span:span("no food for tomorrow")},{questionId:"benefitHistory",value:"never",span:span("never applied for SNAP")}],exclusions:[],questionIds:[],outOfScope:null};
    return Response.json({id:"resp_synthetic",model:"gpt-6.1-sol",service_tier:"default",status:"completed",usage:generation===1?{input_tokens:100,output_tokens:40,total_tokens:140,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:10}}:null,output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(selection,(key,item)=>key==="span"?{text:item.text}:item)}]}]});
  });
  const result=await foodDescriptionEvaluationCommand(["--approved-live",config,"0"],env,fetcher);
  expect(result).toMatchObject({mode:"live_synthetic",corpusCases:60,corpusTurns:240,maximumGenerationCalls:80,maximumCountRequests:80,reservedAttemptsAcrossRun:2,modelQualityApproved:false,humanReviewedCases:0,
    maximumAggregateGenerationCalls:315,maximumAggregateCountRequests:315,aggregateReservedAttempts:237,aggregateReservedNanoDollars:12_327_500_000,
    sealedPriorAccounting:{pairs:235,reservedNanoDollars:12_267_500_000,knownMeasuredNanoDollars:141_000_000,budgetedNanoDollars:141_000_000},aggregateBudgetBoundNanoDollars:201_000_000});
  expect(fetcher).toHaveBeenCalledTimes(4);expect(generation).toBe(2);expect(readdirSync(approval.runDirectory)).toContain("halted.json");
  expect(result.accounting).toMatchObject({countHttpAttemptMarkers:2,generationHttpAttemptMarkers:2,completeUsageReceipts:1,costComplete:false,reservedNanoDollars:60000000});
  vi.setSystemTime(new Date("2026-11-19T16:00:00Z"));
  const retained=await foodDescriptionEvaluationCommand(["--report",config],{CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256:hash},fetcher);
  expect(retained).toMatchObject({mode:"retained_report",noHttpRequests:true});expect(fetcher).toHaveBeenCalledTimes(4);
  await expect(foodDescriptionEvaluationCommand(["--approved-live",config,"0"],env,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(4);
});
});

it('blocks later batches when a charged case result was lost, without refund or another HTTP attempt',async()=>{
  const {approval,config,env}=await approvedFixture(),caseId='description-urgent-1-en';
  const response={id:'resp_synthetic',model:'gpt-6.1-sol',service_tier:'default',status:'completed',usage:{input_tokens:100,output_tokens:40,total_tokens:140,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:10}}};
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>Response.json(String(url).endsWith('/input_tokens')?{object:'response.input_tokens',input_tokens:100}:response));
  const projection=descriptionEvaluationPlan().cases[0].turns[0].projection;
  await withFoodDescriptionEvaluationBudget({approval,apiKey:'synthetic',fetcher},budget=>budget.fetch(caseId,1)('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json','OpenAI-Project':'proj_synthetic'},body:JSON.stringify({...FOOD_DESCRIPTION_EVALUATION_BINDING.request,input:[{role:'user',content:JSON.stringify(projection)}]})}));
  const resultPath=join(approval.runDirectory,`${caseId}-result.json`);writeFileSync(resultPath,'{"synthetic":"removed case evidence"}',{mode:0o600});rmSync(resultPath);
  await expect(foodDescriptionEvaluationCommand(['--approved-live',config,'1'],env,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(2);
  const retained=await foodDescriptionEvaluationCommand(['--report',config],{CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256:env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256},fetcher);
  expect(retained.accounting).toMatchObject({reservedPairs:1,reservedCaseIds:[caseId],reservedNanoDollars:30_000_000});expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps old reconciliation evidence readable but retires every old write/continuation flag", async () => {
  const s = await approvedFixture(), fetcher = vi.fn<typeof fetch>();
  await withFoodDescriptionEvaluationBudget({ approval: s.approval, apiKey: 'synthetic' }, async () => {});
  const oldReport = { sourceSha256: '9c01d344fab1a0b5f09eeb9b9d321b8f7e10b470756cc7676ceaa6ac066e7608', newHttpRequests: 0, originalHaltRetained: true };
  writeFileSync(join(s.approval.runDirectory, `reconciliation-${oldReport.sourceSha256}-report.json`), JSON.stringify(oldReport), { mode: 0o600 });
  const read = await foodDescriptionEvaluationCommand(['--report', s.config], { CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256: s.hash }, fetcher);
  expect(read).toMatchObject({ noHttpRequests: true, reports: [oldReport] });
  await expect(foodDescriptionEvaluationCommand(['--reconcile-retained', s.config, '/old-plan.json'], s.env, fetcher)).rejects.toThrow();
  await expect(foodDescriptionEvaluationCommand(['--approved-live', s.config, '0', '/old-plan.json'], s.env, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires the explicit aggregate approval before a new revised live run", async () => {
  const s = await approvedFixture(), fetcher = vi.fn<typeof fetch>(), saved = JSON.parse(readFileSync(s.config, 'utf8'));
  delete saved.approval.aggregate; const bytes = JSON.stringify(saved); writeFileSync(s.config, bytes);
  await expect(foodDescriptionEvaluationCommand(['--approved-live', s.config, '0'], { ...s.env, CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256: createHash('sha256').update(bytes).digest('hex') }, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([2,3,4,5,6,7,8,9,10,11,12,13]as const)("keeps the old%s-prior configuration readable without admitting another old live run",async priorCount=>{
  const s=await approvedFixture(priorCount),fetcher=vi.fn<typeof fetch>();
  await withFoodDescriptionEvaluationBudget({approval:s.approval,apiKey:'synthetic'},async()=>{});
  vi.setSystemTime(new Date('2026-11-19T00:30:00Z'));
  const read=await foodDescriptionEvaluationCommand(['--report',s.config],{CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256:s.hash},fetcher);
  expect(read).toMatchObject({mode:'retained_report',noHttpRequests:true,accounting:{reservedPairs:0}});
  await expect(foodDescriptionEvaluationCommand(['--approved-live',s.config,'0'],s.env,fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
