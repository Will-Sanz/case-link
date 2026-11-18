import { describe, expect, it, vi } from "vitest";
import { descriptionEvaluationBatches, runDescriptionEvaluationCase } from "./food-description-evaluation";
import { loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { FOOD_DESCRIPTION_FINGERPRINT } from "../src/lib/parent/food-description-runtime";
const corpus=loadDescriptionEvaluationCorpus();
function fixtureBudget(){
  const requests:string[]=[],halt=vi.fn();
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>{
    const body=JSON.parse(String(init?.body)),p=JSON.parse(body.input[0].content),description=p.description as string;requests.push(description);
    const span=(text:string)=>({start:description.indexOf(text),end:description.indexOf(text)+text.length,text});
    const pending=description.includes("already pending"),unclear=description.includes("only one more day");
    const food=pending?"need food today":unclear?"food for only one more day":description.includes("groceries today")?"groceries today":"no food for tomorrow";
    const benefit=pending?"already pending":"never applied for SNAP";
    const selection=description.includes("already started")?{needIds:["snap_pending"],selections:[],assertions:[{questionId:"benefitHistory",value:"applied",span:span("already started")}],exclusions:[],questionIds:[],outOfScope:null}
      :{needIds:unclear?["food_now"]:["food_now",pending?"snap_pending":"snap_new"],selections:[],assertions:[{questionId:"foodForTwoDays",value:"no",span:span(food)},...unclear?[]:[{questionId:"benefitHistory",value:pending?"applied":"never",span:span(benefit)}]],exclusions:[],questionIds:unclear?["benefitHistory"]:[],outOfScope:null};
    return Response.json({id:"resp_synthetic",status:"completed",model:"gpt-6.1-sol",service_tier:"default",usage:{input_tokens:100,output_tokens:40,total_tokens:140,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:10}},output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(selection)}]}]});
  });
  return{requests,halt,fetcher,budget:{fetch:()=>fetcher,halt,attempts:()=>requests.length}};
}
describe("actual interpreter with explicit synthetic transport, never model-quality evidence",()=>{
  it("runs the four urgent turns with a grounded actual-driver result and a real stale-source guard",async()=>{
    const f=fixtureBudget(),item=corpus.cases.find(item=>item.id==="description-urgent-1-en")!;
    const result=await runDescriptionEvaluationCase(item,{budget:f.budget,projectId:"proj_synthetic",apiKey:"synthetic"});
    expect(f.requests).toHaveLength(1);expect(result.turns).toHaveLength(4);expect(result.turns[0].status).toBe("measured_interpretation");expect(result.turns[2].status).toBe("old_result_rejected");
    expect(result.criticalFailure).toBe(false);expect(result.qualityFailures).toBe(0);expect(result.humanReview).toBe("pending");expect(result.modelQualityApproved).toBe(false);
    expect(result.turns[0].oracleCoverage).toMatchObject({automaticallyCheckedFields:expect.arrayContaining(["state","needIds","questionIds","executionGranted"]),retainedUnmeasuredFields:expect.arrayContaining(["agencyStatusInvented","typedFactsOverrideProse"])});
    for(const row of result.turns)expect([...row.oracleCoverage.automaticallyCheckedFields,...row.oracleCoverage.retainedUnmeasuredFields].sort()).toEqual(Object.keys(row.current as object).sort());
  });
  it("answers only the supplied vetted fact with zero additional interpretations and preserves the native-evidence boundary",async()=>{
    const f=fixtureBudget(),item=corpus.cases.find(item=>item.id==="description-urgent-2-en")!;
    const result=await runDescriptionEvaluationCase(item,{budget:f.budget,projectId:"proj_synthetic",apiKey:"synthetic"});
    expect(f.requests).toHaveLength(1);expect(result.turns[1]).toMatchObject({status:"deterministic_typed_answers",result:{proposedAnswers:{benefitHistory:"not_sure"},questionIds:[]}});
    expect(result.turns[2].status).toBe("requires_native_evidence");expect(result.criticalFailure).toBe(false);
  });
  it("makes one new explicit edit call, rejects the old projection and wraps only the actual terminal choice",async()=>{
    const f=fixtureBudget(),item=corpus.cases.find(item=>item.id==="description-urgent-3-en")!;
    const result=await runDescriptionEvaluationCase(item,{budget:f.budget,projectId:"proj_synthetic",apiKey:"synthetic"});
    expect(f.requests).toHaveLength(2);expect(result.turns[2]).toMatchObject({status:"measured_interpretation",revision:2,latePriorRejected:true});
    expect(result.turns[3]).toMatchObject({actual:{needs:["snap_pending"]}});expect(result.criticalFailure).toBe(false);
  });
  it("halts on invalid source spans without inventing a passing result or retry",async()=>{
    const f=fixtureBudget(),item=corpus.cases.find(item=>item.id==="description-urgent-1-es")!;
    const result=await runDescriptionEvaluationCase(item,{budget:f.budget,projectId:"proj_synthetic",apiKey:"synthetic"});
    expect(f.requests).toHaveLength(1);expect(f.halt).toHaveBeenCalled();expect(result.criticalFailure).toBe(true);expect(result.turns).toHaveLength(4);expect(result.turns.filter(turn=>turn.status==="unrun_after_failure")).toHaveLength(3);
  });
  it("keeps a covered owned journey in existingRequests through the zero-call continuation",async()=>{
    const f=fixtureBudget(),item=corpus.cases.find(item=>item.id==="description-owned_history-1-en")!;
    const result=await runDescriptionEvaluationCase(item,{budget:f.budget,projectId:"proj_synthetic",apiKey:"synthetic"});
    expect(f.requests).toHaveLength(1);expect(result.criticalFailure).toBe(false);expect(result.qualityFailures).toBe(0);
    expect(result.turns[1]).toMatchObject({status:"deterministic_typed_answers",result:{needIds:[],state:"open_existing",existingRequests:[{requestId:"00000000-0000-4000-8000-000000000101",needIds:["snap_pending"]}]}});
    expect(result.turns[3]).toMatchObject({target:"/support/00000000-0000-4000-8000-000000000101",checks:[{passed:true}]});
  });
  it("stops when an operational stale-result guard fails instead of merely recording its status",async()=>{
    const f=fixtureBudget(),item=structuredClone(corpus.cases.find(item=>item.id==="description-urgent-1-en")!);
    item.turns[2].changes={catalog:{version:FOOD_DESCRIPTION_FINGERPRINT}};
    const result=await runDescriptionEvaluationCase(item,{budget:f.budget,projectId:"proj_synthetic",apiKey:"synthetic"});
    expect(result.turns[2]).toMatchObject({status:"stale_guard_failed",checks:[{code:"old_result_rejected",passed:false,severity:"critical"}]});
    expect(result.criticalFailure).toBe(true);expect(f.halt).toHaveBeenCalled();expect(result.turns[3].status).toBe("unrun_after_failure");
  });
  it("labels server-repaired nominations as vetted-result evidence and keeps raw model nomination accuracy unmeasured",async()=>{
    const f=fixtureBudget(),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(...args)=>{const response=await original(...args),data=await response.json(),selection=JSON.parse(data.output[0].content[0].text);selection.needIds=[];selection.questionIds=[];data.output[0].content[0].text=JSON.stringify(selection);return Response.json(data);});
    const result=await runDescriptionEvaluationCase(corpus.cases.find(item=>item.id==='description-urgent-1-en')!,{budget:f.budget,projectId:'proj_synthetic',apiKey:'synthetic'});
    expect(result.criticalFailure).toBe(false);expect(result.turns[0]).toMatchObject({rawModelNominationAccuracy:'unmeasured',selection:{needIds:[],questionIds:[]},result:{needIds:['food_now','snap_new']},checks:expect.arrayContaining([{code:'needIds',passed:true,severity:'critical',basis:'vetted_result'},{code:'questionIds',passed:true,severity:'quality',basis:'vetted_result'}])});
    expect(result.modelQualityApproved).toBe(false);
  });
  it.each(['wrong fact','unnecessary question'])('keeps %s a critical stop without additional calls',async kind=>{
    const f=fixtureBudget(),original=f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async(...args)=>{const response=await original(...args),data=await response.json(),selection=JSON.parse(data.output[0].content[0].text);if(kind==='wrong fact'){selection.assertions[0].value='yes';selection.needIds=['snap_new'];}else selection.questionIds=['benefitHistory'];data.output[0].content[0].text=JSON.stringify(selection);return Response.json(data);});
    const result=await runDescriptionEvaluationCase(corpus.cases.find(item=>item.id==='description-urgent-1-en')!,{budget:f.budget,projectId:'proj_synthetic',apiKey:'synthetic'});
    expect(result.criticalFailure).toBe(true);expect(f.halt).toHaveBeenCalled();expect(f.requests).toHaveLength(1);expect(result.turns.filter(turn=>turn.status==='unrun_after_failure')).toHaveLength(3);
  });
  it("partitions exactly60 cases into eight disjoint bounded batches, with the bilingual8-case smoke inside the denominator",()=>{
    const batches=descriptionEvaluationBatches(corpus.cases);expect(batches).toHaveLength(8);expect(new Set(batches.flat()).size).toBe(60);expect(batches[0]).toHaveLength(8);
    for(const batch of batches){expect(batch.length).toBeLessThanOrEqual(10);expect(batch.reduce((n,id)=>n+corpus.cases.find(item=>item.id===id)!.turns.reduce((n,t)=>n+(t.modelCalls??0),0),0)).toBeLessThanOrEqual(16);}
    expect(batches[0].filter(id=>id.endsWith("-en"))).toHaveLength(4);expect(batches[0].filter(id=>id.endsWith("-es"))).toHaveLength(4);
  });
});
