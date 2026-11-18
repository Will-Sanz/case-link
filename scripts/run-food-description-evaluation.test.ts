import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT } from "../src/lib/parent/food-description-runtime";
import { FOOD_DESCRIPTION_CORPUS_SHA, withFoodDescriptionEvaluationBudget } from "./food-description-evaluation-budget";
import { descriptionEvaluationPlan, loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { descriptionEvaluationSourceManifest, runDescriptionEvaluationCase } from "./food-description-evaluation";
import { descriptionEvaluationAccounting, descriptionEvaluationHash, descriptionEvaluationReconciliationPaths, reconcileFoodDescriptionEvaluation } from "./food-description-evaluation-budget";
import { foodDescriptionEvaluationCommand } from "./run-food-description-evaluation";
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});vi.useRealTimers();vi.unstubAllGlobals();});
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
async function approvedFixture(){
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-18T16:00:00Z"));
  const root=mkdtempSync(join(tmpdir(),"description-command-"));roots.push(root);
  const dry=await foodDescriptionEvaluationCommand(["--dry"],{});if(!("adapterSha256" in dry))throw new Error("Expected a dry plan");
  const approval={purpose:"optional_food_description_synthetic_evaluation_v1",syntheticOnly:true,approvalReference:"SYNTHETIC UNIT TEST ONLY",approvedUntil:"2026-11-18T23:00:00Z",processorReference:"synthetic",noticeRetentionReference:"synthetic",billingReference:"synthetic",projectId:"proj_synthetic",projectMetadataReference:"synthetic Standard global",approvedResponseModelId:"gpt-6.1-sol",region:"global",serviceTier:"default",fingerprint:FOOD_DESCRIPTION_FINGERPRINT,corpusSha256:FOOD_DESCRIPTION_CORPUS_SHA,adapterSha256:dry.adapterSha256,rateCardDate:"2026-11-18",maximumCalls:80,maximumCountRequests:80,maximumInputTokens:8000,maximumOutputTokens:1500,maximumNanoDollars:5_000_000_000,runDirectory:join(root,"run")};
  const config=join(root,"approval.json"),bytes=JSON.stringify({sourceSha256:dry.sourceSha256,approval});writeFileSync(config,bytes,{mode:0o600});
  const hash=createHash("sha256").update(bytes).digest("hex");
  const env:Record<string,string>={CASELINK_FOOD_DESCRIPTION_EVAL_NEW_APPROVAL:"1",CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256:hash,CASELINK_FOOD_DESCRIPTION_EVAL_API_KEY:"synthetic"};
  return {approval,config,hash,env};
}
it("uses the actual driver only after a hash-bound new approval, halts unknown billing, and reads retained evidence after closure without a key",async()=>{
  const {approval,config,hash,env}=await approvedFixture();
  let generation=0;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url,init)=>{
    if(String(url).endsWith("/input_tokens"))return Response.json({object:"response.input_tokens",input_tokens:8000});
    generation++;const request=JSON.parse(String(init?.body)),p=JSON.parse(request.input[0].content),description=p.description as string;
    const span=(text:string)=>({start:description.indexOf(text),end:description.indexOf(text)+text.length,text});
    const selection={needIds:["food_now","snap_new"],selections:[],assertions:[{questionId:"foodForTwoDays",value:"no",span:span("no food for tomorrow")},{questionId:"benefitHistory",value:"never",span:span("never applied for SNAP")}],exclusions:[],questionIds:[],outOfScope:null};
    return Response.json({id:"resp_synthetic",model:"gpt-6.1-sol",service_tier:"default",status:"completed",usage:generation===1?{input_tokens:100,output_tokens:40,total_tokens:140,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:10}}:null,output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(selection)}]}]});
  });
  const result=await foodDescriptionEvaluationCommand(["--approved-live",config,"0"],env,fetcher);
  expect(result).toMatchObject({mode:"live_synthetic",corpusCases:60,corpusTurns:240,maximumGenerationCalls:80,maximumCountRequests:80,reservedAttemptsAcrossRun:2,modelQualityApproved:false,humanReviewedCases:0});
  expect(fetcher).toHaveBeenCalledTimes(4);expect(generation).toBe(2);expect(readdirSync(approval.runDirectory)).toContain("halted.json");
  expect(result.accounting).toMatchObject({countHttpAttemptMarkers:2,generationHttpAttemptMarkers:2,completeUsageReceipts:1,costComplete:false,reservedNanoDollars:110000000});
  vi.setSystemTime(new Date("2026-11-19T16:00:00Z"));
  const retained=await foodDescriptionEvaluationCommand(["--report",config],{CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256:hash},fetcher);
  expect(retained).toMatchObject({mode:"retained_report",noHttpRequests:true});expect(fetcher).toHaveBeenCalledTimes(4);
  await expect(foodDescriptionEvaluationCommand(["--approved-live",config,"0"],env,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(4);
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
  expect(retained.accounting).toMatchObject({reservedPairs:1,reservedCaseIds:[caseId],reservedNanoDollars:55_000_000});expect(fetcher).toHaveBeenCalledTimes(2);
});

const fileHash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const retainedIds=['description-urgent-1-en','description-urgent-1-es','description-new_snap-2-en'];
async function recoveryFixture(){
  const {approval,config,env}=await approvedFixture(),root=join(approval.runDirectory,'..');
  let responseId=0;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url,init)=>{
    if(String(url).endsWith('/input_tokens'))return Response.json({object:'response.input_tokens',input_tokens:8000});
    const p=JSON.parse(JSON.parse(String(init?.body)).input[0].content),description=p.description as string;
    const span=(text:string)=>({start:description.indexOf(text),end:description.indexOf(text)+text.length,text});
    const pending=description.startsWith('I have never'),es=p.screenLocale==='es';
    const selected=pending?{needIds:['snap_pending'],selections:[{need:'snap_pending',programId:'snap-pa',reason:'pending'},{need:'snap_pending',programId:'uesf-benefits',reason:'pending'}],assertions:[{questionId:'benefitHistory',value:'never',span:span('I have never applied for SNAP')}],exclusions:[],questionIds:['foodForTwoDays'],outOfScope:null}
      :{needIds:['food_now','snap_new'],selections:[],assertions:[{questionId:'foodForTwoDays',value:'no',span:span(es?'No tenemos comida para mañana':'no food for tomorrow')},{questionId:'benefitHistory',value:'never',span:span(es?'Nunca he solicitado SNAP':'never applied for SNAP')}],exclusions:[],questionIds:[],outOfScope:null};
    return Response.json({id:`resp_synthetic_${++responseId}`,model:'gpt-6.1-sol',service_tier:'default',status:'completed',usage:{input_tokens:100,output_tokens:40,total_tokens:140,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:10}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(selected)}]}]});
  });
  const corpus=loadDescriptionEvaluationCorpus();
  const record=async(a:typeof approval)=>withFoodDescriptionEvaluationBudget({approval:a,apiKey:'synthetic',fetcher},async budget=>{
    for(const id of retainedIds){
      const item=corpus.cases.find(value=>value.id===id)!;
      const result=await runDescriptionEvaluationCase(item,{budget,projectId:a.projectId,apiKey:'synthetic'});
      // Synthetic saved predecessor: the real response was correct, its old postprocessing omitted provisional food.
      if(id===retainedIds[2]){result.criticalFailure=true;(result.turns[0].result as {needIds:string[]}).needIds=['snap_pending'];}
      writeFileSync(join(a.runDirectory,`${id}-result.json`),JSON.stringify(result),{mode:0o600,flag:'wx'});
    }
    budget.halt();
  });
  await record(approval);
  const prior={...approval,approvalReference:'SYNTHETIC PRIOR RUN',runDirectory:join(root,'prior')};await record(prior);
  const prefix=(a:typeof approval)=>join(root,`.food-description-evaluation-${descriptionEvaluationHash(a.approvalReference)}`);
  const historical={...prior,fingerprint:'5b162f7cfb45dad4d41c4e2b603b50fa1382b7d8079bc535b3518d1a4b3db7d0'};
  writeFileSync(join(prior.runDirectory,'approval.json'),JSON.stringify(historical));writeFileSync(prefix(prior)+'.json',JSON.stringify(historical));
  const beforeHashes:Record<string,string>={'scripts/food-description-evaluation-budget.ts':'17a870dc8e27adfb67574215d4be42f320ebeeffa01c2806a5bd000d134dcca8','scripts/run-food-description-evaluation.ts':'83eb2616e84141e5178f97f7ab163f389808f3d298d3e578444547d0a5704664','src/lib/parent/food-description.ts':'8cc5143be806771bc2999dd128d84e88b66b3b9107f40e6c2de65d7eaaed4ce9'};
  const originalSourceManifest=descriptionEvaluationSourceManifest().map(value=>beforeHashes[value.path]?{...value,sha256:beforeHashes[value.path]}:value);
  const saved={sourceSha256:descriptionEvaluationHash(originalSourceManifest),approval};writeFileSync(config,JSON.stringify(saved));env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256=fileHash(config);
  const plan={version:'food-description-post-validation-reconciliation.v1',originalConfigurationSha256:fileHash(config),originalApprovalSha256:fileHash(prefix(approval)+'.json'),originalHaltSha256:fileHash(join(approval.runDirectory,'halted.json')),
    originalSourceManifest,currentSourceManifest:descriptionEvaluationSourceManifest(),priorRunDirectory:prior.runDirectory,priorApprovalSha256:fileHash(prefix(prior)+'.json'),priorHaltSha256:fileHash(join(prior.runDirectory,'halted.json')),
    maximumAggregateCalls:83,maximumAggregateCountRequests:83,maximumAggregateNanoDollars:5_000_000_000,
    attempts:retainedIds.map((id,index)=>{const tag=`attempt-${String(index+1).padStart(3,'0')}`,p=join(approval.runDirectory,tag);return{...JSON.parse(readFileSync(p+'-intent.json','utf8')),responseHash:JSON.parse(readFileSync(p+'-observation.json','utf8')).responseHash,responseFileSha256:fileHash(p+'-response.json'),
      receiptsSha256:descriptionEvaluationHash(['intent','count-dispatch','count','dispatch','observation'].map(suffix=>({suffix,inner:fileHash(`${p}-${suffix}.json`),outer:fileHash(`${prefix(approval)}-${tag}-${suffix}.json`)}))),originalResultSha256:fileHash(join(approval.runDirectory,`${id}-result.json`))};})};
  const planPath=join(root,'reconciliation-plan.json');
  const savePlan=()=>{writeFileSync(planPath,JSON.stringify(plan),{mode:0o600});Object.assign(env,{CASELINK_FOOD_DESCRIPTION_EVAL_RECONCILIATION_SHA256:fileHash(planPath)});};savePlan();
  const oldFiles=[...readdirSync(approval.runDirectory).map(name=>join(approval.runDirectory,name)),...readdirSync(root).filter(name=>name.startsWith('.food-description-evaluation-')).map(name=>join(root,name)),config];
  const oldHashes=oldFiles.map(path=>[path,fileHash(path)]);
  return{approval,prior,config,env,plan,planPath,savePlan,fetcher,oldHashes,prefix};
}
async function amendedRecoveryFixture(){
  const s=await recoveryFixture();await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env);
  const currentSourceManifest=descriptionEvaluationSourceManifest(),currentSource=descriptionEvaluationHash(currentSourceManifest);
  const predecessorHashes:Record<string,string>={'scripts/food-description-evaluation-budget.ts':'c1667cdb3e443d45f0b087d882358ea5a18a818869aedcf155a53436234e6b33','scripts/run-food-description-evaluation.ts':'eb42aed089ada16aacef107360b7fe32f9e5263465850838985aa4c36b1abdc7'};
  const previousManifest=currentSourceManifest.map(value=>predecessorHashes[value.path]?{...value,sha256:predecessorHashes[value.path]}:value);
  const predecessorSource='9c01d344fab1a0b5f09eeb9b9d321b8f7e10b470756cc7676ceaa6ac066e7608';
  expect(descriptionEvaluationHash(previousManifest)).toBe(predecessorSource);
  const previousPaths=descriptionEvaluationReconciliationPaths(s.approval,predecessorSource),currentPaths=descriptionEvaluationReconciliationPaths(s.approval,currentSource);
  // Synthetic predecessor metadata only: the unchanged pure interpreter produced these fixture results.
  const previousReport={...JSON.parse(readFileSync(currentPaths.report,'utf8')),sourceSha256:predecessorSource,sourceManifest:previousManifest};
  rmSync(currentPaths.report);writeFileSync(previousPaths.report,JSON.stringify(previousReport),{mode:0o600,flag:'wx'});
  s.plan.currentSourceManifest=previousManifest;s.savePlan();
  const previousReceipt={...JSON.parse(readFileSync(previousPaths.inner,'utf8')),planSha256:fileHash(s.planPath),planValueSha256:descriptionEvaluationHash(s.plan),sourceSha256:predecessorSource,reportSha256:descriptionEvaluationHash(previousReport)};
  for(const path of [previousPaths.inner,previousPaths.outer])writeFileSync(path,JSON.stringify(previousReceipt));
  const plan={...s.plan,currentSourceManifest,retainedReconciliation:{sourceSha256:predecessorSource,planPath:s.planPath,planSha256:fileHash(s.planPath),innerReceiptSha256:fileHash(previousPaths.inner),outerReceiptSha256:fileHash(previousPaths.outer),reportSha256:fileHash(previousPaths.report)}};
  const planPath=join(s.approval.runDirectory,'..','amended-reconciliation-plan.json'),env={...s.env};
  const savePlan=()=>{writeFileSync(planPath,JSON.stringify(plan),{mode:0o600});env.CASELINK_FOOD_DESCRIPTION_EVAL_RECONCILIATION_SHA256=fileHash(planPath);};savePlan();
  const originalPaths=[...readdirSync(s.approval.runDirectory).map(name=>join(s.approval.runDirectory,name)),...readdirSync(join(s.approval.runDirectory,'..')).filter(name=>name.startsWith('.food-description-evaluation-')).map(name=>join(s.approval.runDirectory,'..',name)),s.planPath,s.config];
  return{...s,plan,planPath,env,savePlan,previousPaths,originalHashes:originalPaths.map(path=>[path,fileHash(path)])};
}
it('validates the single reviewed source amendment without replaying or changing original evidence',async()=>{
  const s=await amendedRecoveryFixture(),network=vi.fn<typeof fetch>(),before=readdirSync(s.approval.runDirectory).sort();
  const view=await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],{...s.env,CASELINK_FOOD_DESCRIPTION_EVAL_API_KEY:undefined},network);
  expect(view).toMatchObject({sourceSha256:s.plan.retainedReconciliation.sourceSha256,validatedSuccessorSourceSha256:descriptionEvaluationHash(descriptionEvaluationSourceManifest()),retainedReconciliationReportSha256:s.plan.retainedReconciliation.reportSha256,newHttpRequests:0,reservedAttemptsAcrossRun:3,aggregateReservedAttempts:6,remainingGenerationRequests:77});
  expect(network).not.toHaveBeenCalled();expect(readdirSync(s.approval.runDirectory).sort()).toEqual(before);
  for(const [path,hash]of s.originalHashes)expect(fileHash(path)).toBe(hash);
});
it.each(['plan','inner receipt','outside receipt','report','stable scope','source','nested amendment','normalizer'])(
  'rejects a changed or missing predecessor %s without replay or spending',async kind=>{
    const s=await amendedRecoveryFixture(),network=vi.fn<typeof fetch>(),retained=s.plan.retainedReconciliation;
    if(kind==='plan')rmSync(retained.planPath);
    if(kind==='inner receipt')rmSync(s.previousPaths.inner);
    if(kind==='outside receipt')rmSync(s.previousPaths.outer);
    if(kind==='report')rmSync(s.previousPaths.report);
    if(kind==='stable scope')s.plan.attempts[0].caseId='description-other-en';
    if(kind==='source')retained.sourceSha256='a'.repeat(64);
    if(kind==='nested amendment'){const previous=JSON.parse(readFileSync(retained.planPath,'utf8'));previous.retainedReconciliation=retained;writeFileSync(retained.planPath,JSON.stringify(previous));retained.planSha256=fileHash(retained.planPath);}
    if(kind==='normalizer')s.plan.currentSourceManifest.find(value=>value.path==='src/lib/parent/food-description.ts')!.sha256='a'.repeat(64);
    s.savePlan();
    await expect(foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env,network)).rejects.toThrow();
    await expect(foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,network)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();expect(descriptionEvaluationAccounting(s.approval.runDirectory).reservedPairs).toBe(3);
  });
it('re-evaluates exact retained responses with no key/HTTP/reservation and keeps original bytes, timing and denominators',async()=>{
  const s=await recoveryFixture(),network=vi.fn<typeof fetch>();
  const result=await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],{...s.env,CASELINK_FOOD_DESCRIPTION_EVAL_API_KEY:undefined},network);
  expect(result).toMatchObject({mode:'retained_reconciliation',newHttpRequests:0,newCountRequests:0,newGenerationRequests:0,reservedAttemptsAcrossRun:3,aggregateReservedAttempts:6,remainingGenerationRequests:77,
    corpusCases:60,corpusTurns:240,maximumGenerationCalls:80,maximumCountRequests:80,retainedCases:3,retainedModelResponses:3,remainingCorpusCases:57,modelQualityApproved:false,humanReviewedCases:0});
  const results=(result as {results:{criticalFailure:boolean;turns:Record<string,unknown>[]}[]}).results;
  expect(results).toHaveLength(3);expect(results.every(value=>!value.criticalFailure)).toBe(true);
  expect(results[2].turns[0]).toMatchObject({status:'retained_interpretation',responseProvenance:'retained_exact_request',result:{needIds:['food_now','snap_pending'],questionIds:['foodForTwoDays']}});
  const observation=JSON.parse(readFileSync(join(s.approval.runDirectory,'attempt-003-observation.json'),'utf8'));
  expect(results[2].turns[0].elapsedMs).toBe(observation.elapsedMs);expect(results[2].turns[0].localReplayElapsedMs).toEqual(expect.any(Number));
  for(const [path,hash]of s.oldHashes)expect(fileHash(path)).toBe(hash);
  expect(descriptionEvaluationAccounting(s.approval.runDirectory)).toMatchObject({reservedPairs:3,halted:true});expect(network).not.toHaveBeenCalled();
  const again=await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env,network);expect(again).toEqual(result);expect(network).not.toHaveBeenCalled();
});
it.each(['body','project','old fingerprint','uncached case','uncached turn','endpoint'])(
  'rejects an actual cached-fetch %s mismatch rather than falling back to HTTP',async kind=>{
    const s=await recoveryFixture(),network=vi.fn();vi.stubGlobal('fetch',network);
    const recovery={plan:s.plan,planSha256:s.env.CASELINK_FOOD_DESCRIPTION_EVAL_RECONCILIATION_SHA256!,configurationSha256:s.env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256};
    const projection=structuredClone(descriptionEvaluationPlan().cases.find(value=>value.id===retainedIds[2])!.turns[0].projection) as Record<string,unknown>;
    if(kind==='body')projection.description='Different source text';
    if(kind==='old fingerprint')projection.catalogVersion='5b162f7cfb45dad4d41c4e2b603b50fa1382b7d8079bc535b3518d1a4b3db7d0';
    await expect(reconcileFoodDescriptionEvaluation({approval:s.approval,recovery},async budget=>{
      await budget.fetch(kind==='uncached case'?'description-unrecorded-en':retainedIds[2],kind==='uncached turn'?2:1)(kind==='endpoint'?'https://example.invalid':'https://api.openai.com/v1/responses',
        {method:'POST',redirect:'error',headers:{Authorization:'Bearer retained-response-only','Content-Type':'application/json','OpenAI-Project':kind==='project'?'proj_other':'proj_synthetic'},body:JSON.stringify({...FOOD_DESCRIPTION_EVALUATION_BINDING.request,input:[{role:'user',content:JSON.stringify(projection)}]})});return[];
    })).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();expect(readdirSync(s.approval.runDirectory)).not.toContain('reconciliation.json');vi.unstubAllGlobals();
  });
it.each(['inner receipt','outside receipt','response','prior response substituted','paired timing','request hash','count hash','case','turn','source','oracle','project','prior unknown','original result','original halt'])(
  'blocks %s without another request or reconciliation receipt',async kind=>{
    const s=await recoveryFixture(),network=vi.fn<typeof fetch>(),p=join(s.approval.runDirectory,'attempt-003');
    if(kind==='inner receipt')rmSync(p+'-count.json');
    if(kind==='outside receipt')rmSync(s.prefix(s.approval)+'-attempt-003-observation.json');
    if(kind==='response')rmSync(p+'-response.json');
    if(kind==='prior response substituted')writeFileSync(p+'-response.json',readFileSync(join(s.prior.runDirectory,'attempt-003-response.json')));
    if(kind==='paired timing')for(const path of [p+'-observation.json',s.prefix(s.approval)+'-attempt-003-observation.json']){const value=JSON.parse(readFileSync(path,'utf8'));value.elapsedMs++;writeFileSync(path,JSON.stringify(value));}
    if(kind==='request hash')s.plan.attempts[2].requestHash='a'.repeat(64);
    if(kind==='count hash')s.plan.attempts[2].countRequestHash='a'.repeat(64);
    if(kind==='case')s.plan.attempts[2].caseId='description-urgent-1-es';
    if(kind==='turn')s.plan.attempts[2].turn=2;
    if(kind==='source')s.plan.currentSourceManifest[0].sha256='a'.repeat(64);
    if(kind==='oracle')s.plan.originalSourceManifest.find(value=>value.path==='scripts/food-description-evaluation-adapter.ts')!.sha256='a'.repeat(64);
    if(kind==='project'){
      const config=JSON.parse(readFileSync(s.config,'utf8'));config.approval.projectId='proj_changed';writeFileSync(s.config,JSON.stringify(config));
      s.env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256=fileHash(s.config);s.plan.originalConfigurationSha256=fileHash(s.config);
    }
    if(kind==='prior unknown')rmSync(s.prefix(s.prior)+'-attempt-003-observation.json');
    if(kind==='original result')rmSync(join(s.approval.runDirectory,`${retainedIds[2]}-result.json`));
    if(kind==='original halt')rmSync(join(s.approval.runDirectory,'halted.json'));
    s.savePlan();
    await expect(foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env,network)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();expect(readdirSync(s.approval.runDirectory)).not.toContain('reconciliation.json');
  });
it.each([false,true])('permits expired retained reads but never extends the original live deadline or rate-card day (amended=%s)',async amended=>{
  const s=await(amended?amendedRecoveryFixture():recoveryFixture()),network=vi.fn<typeof fetch>();vi.setSystemTime(new Date('2026-11-19T16:00:00Z'));
  await expect(foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env,network)).resolves.toMatchObject({newHttpRequests:0});
  await expect(foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,network)).rejects.toThrow();expect(network).not.toHaveBeenCalled();
});
it.each([false,true])('uses current-source retained results, continues at004 and permanently stops a subsequent critical failure (amended=%s)',async amended=>{
  const s=await(amended?amendedRecoveryFixture():recoveryFixture());await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env);
  const before=s.fetcher.mock.calls.length;
  // The next Spanish case deliberately receives the unsupported fixture span; complete billing remains charged, quality fails closed.
  const report=await foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,s.fetcher);
  expect(report).toMatchObject({reservedAttemptsAcrossRun:4,aggregateReservedAttempts:7,maximumAggregateGenerationCalls:83,originalHaltRetained:true});
  const results=(report as {results:{id:string;criticalFailure:boolean}[]}).results;
  expect(results.find(value=>value.id===retainedIds[2])?.criticalFailure).toBe(false);expect(results.at(-1)?.criticalFailure).toBe(true);
  expect(JSON.parse(readFileSync(join(s.approval.runDirectory,'attempt-004-intent.json'),'utf8')).attempt).toBe(4);
  expect(readdirSync(s.approval.runDirectory)).toContain('reconciliation-halted.json');expect(s.fetcher.mock.calls.length-before).toBe(2);
  const calls=s.fetcher.mock.calls.length;
  await expect(foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,s.fetcher)).rejects.toThrow();
  await expect(foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env,s.fetcher)).rejects.toThrow();
  rmSync(join(s.approval.runDirectory,'reconciliation-halted.json')); // The outside successor alone still permanently closes it.
  await expect(foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,s.fetcher)).rejects.toThrow();expect(s.fetcher).toHaveBeenCalledTimes(calls);
  for(const [path,hash]of s.oldHashes)expect(fileHash(path)).toBe(hash);
});
it.each([false,true])('keeps a charged unknown after continuation reserved and blocks recovery without refund or redispatch (amended=%s)',async amended=>{
  const s=await(amended?amendedRecoveryFixture():recoveryFixture());await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env);
  const network=vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic interrupted count'));
  await foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,network);
  expect(descriptionEvaluationAccounting(s.approval.runDirectory)).toMatchObject({reservedPairs:4,reservedNanoDollars:220000000,costComplete:false});
  const calls=network.mock.calls.length;
  await expect(foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,network)).rejects.toThrow();expect(network).toHaveBeenCalledTimes(calls);
});
it.each([false,true])('keeps the80 run2/83 aggregate/$5 reservation boundary across restarts and creates no replacement anchor (amended=%s)',async amended=>{
  const s=await(amended?amendedRecoveryFixture():recoveryFixture());await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env);
  const recovery={plan:s.plan,planSha256:s.env.CASELINK_FOOD_DESCRIPTION_EVAL_RECONCILIATION_SHA256!,configurationSha256:s.env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256};
  const projection=descriptionEvaluationPlan().cases[0].turns[0].projection;
  const init={method:'POST',redirect:'error' as const,headers:{Authorization:'Bearer synthetic','Content-Type':'application/json','OpenAI-Project':'proj_synthetic'},body:JSON.stringify({...FOOD_DESCRIPTION_EVALUATION_BINDING.request,input:[{role:'user',content:JSON.stringify(projection)}]})};
  // Complete synthetic predecessor receipts put this recovery at79; the existing budget suite separately dispatches all80.
  // Exercise the actual final reservation/HTTP pair and next restart without repeating76 fsync-bound dispatches here.
  const body=JSON.parse(init.body),countBody={model:body.model,input:body.input,instructions:body.instructions,reasoning:body.reasoning,text:body.text};
  for(let attempt=4;attempt<80;attempt++){
    const tag=`attempt-${String(attempt).padStart(3,'0')}`,original=join(s.approval.runDirectory,'attempt-003');
    for(const suffix of ['intent','count-dispatch','count','dispatch','observation']){
      const data=suffix==='intent'?{attempt,caseId:`description-predecessor-${attempt}-en`,turn:1,requestHash:descriptionEvaluationHash(body),countRequestHash:descriptionEvaluationHash(countBody),reservedNanoDollars:55000000}:JSON.parse(readFileSync(`${original}-${suffix}.json`,'utf8'));
      for(const path of [join(s.approval.runDirectory,`${tag}-${suffix}.json`),`${s.prefix(s.approval)}-${tag}-${suffix}.json`])writeFileSync(path,JSON.stringify(data),{mode:0o600,flag:'wx'});
    }
    writeFileSync(join(s.approval.runDirectory,`${tag}-response.json`),readFileSync(`${original}-response.json`),{mode:0o600,flag:'wx'});
  }
  await withFoodDescriptionEvaluationBudget({approval:s.approval,apiKey:'synthetic',fetcher:s.fetcher,reconciliation:recovery},budget=>budget.fetch('description-final-80-en',1)('https://api.openai.com/v1/responses',init));
  expect(descriptionEvaluationAccounting(s.approval.runDirectory)).toMatchObject({reservedPairs:80,reservedNanoDollars:4400000000,costComplete:true});
  expect(descriptionEvaluationAccounting(s.prior.runDirectory).reservedNanoDollars+descriptionEvaluationAccounting(s.approval.runDirectory).reservedNanoDollars).toBe(4565000000);
  expect(await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env)).toMatchObject({remainingGenerationRequests:0,reservedAttemptsAcrossRun:80,aggregateReservedAttempts:83,remainingGenerationRequestsAtReconciliation:77});
  const calls=s.fetcher.mock.calls.length;
  await expect(withFoodDescriptionEvaluationBudget({approval:s.approval,apiKey:'synthetic',fetcher:s.fetcher,reconciliation:recovery},budget=>budget.fetch('description-extra-en',1)('https://api.openai.com/v1/responses',init))).rejects.toThrow();
  const replacement={...s.approval,runDirectory:join(s.approval.runDirectory,'..','replacement'),approvalReference:'NO REPLACEMENT APPROVAL'};
  await expect(withFoodDescriptionEvaluationBudget({approval:replacement,apiKey:'synthetic',fetcher:s.fetcher,reconciliation:recovery},async()=>{})).rejects.toThrow();
  expect(readdirSync(join(s.approval.runDirectory,'..'))).not.toContain(`.food-description-evaluation-${descriptionEvaluationHash(replacement.approvalReference)}.json`);expect(s.fetcher).toHaveBeenCalledTimes(calls);
});
it.each([false,true])('refuses a missing original inner approval without recreating it or dispatching (amended=%s)',async amended=>{
  const s=await(amended?amendedRecoveryFixture():recoveryFixture());await foodDescriptionEvaluationCommand(['--reconcile-retained',s.config,s.planPath],s.env);
  rmSync(join(s.approval.runDirectory,'approval.json'));
  const calls=s.fetcher.mock.calls.length;
  let denied=false;try{await foodDescriptionEvaluationCommand(['--approved-live',s.config,'0',s.planPath],s.env,s.fetcher);}catch{denied=true;}
  expect(denied).toBe(true);expect(s.fetcher.mock.calls.length).toBe(calls);
  expect(readdirSync(s.approval.runDirectory)).not.toContain('approval.json');
});
