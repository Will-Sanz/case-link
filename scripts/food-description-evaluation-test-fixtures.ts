import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { descriptionEvaluationApprovalSchema, descriptionEvaluationHash, descriptionEvaluationFileHash, sealedDescriptionEvaluationEvidenceHash, withFoodDescriptionEvaluationBudget, writeDescriptionEvaluationEvidence } from "./food-description-evaluation-budget";

/** Complete synthetic accounting predecessors only; the fetcher never makes HTTP or measures model quality. */
export async function sealedDescriptionEvaluationPriors(value: unknown, init: RequestInit, includeAggregatePrior: boolean | 4 | 5 | 6 | 7 | 8 | 9 | 10 = false, worstCaseUsage = false) {
  const approval = descriptionEvaluationApprovalSchema.parse(value), root = dirname(approval.runDirectory);
  const refs: {runDirectory:string;configurationPath:string;configurationSha256:string;evidenceSha256:string;reservedPairs:number}[] = [];
  for (const count of (includeAggregatePrior === 10 ? [3, 4, 6, 7, 20, 13, 39, 10, 22, 63] : includeAggregatePrior === 9 ? [3, 4, 6, 7, 20, 13, 39, 10, 22] : includeAggregatePrior === 8 ? [3, 4, 6, 7, 20, 13, 39, 10] : includeAggregatePrior === 7 ? [3, 4, 6, 7, 20, 13, 39] : includeAggregatePrior === 6 ? [3, 4, 6, 7, 20, 13] : includeAggregatePrior === 5 ? [3, 4, 6, 7, 20] : includeAggregatePrior === 4 ? [3, 4, 6, 7] : includeAggregatePrior ? [3, 4, 6] : [3, 4])) {
    const maximum=count===63?204:count===22?182:count===6?87:count===7?93:count===13?120:count===39?133:count===10?172:100;
    const prior = { ...approval, ...((count===22||count===63)?{rateCardDate:"2026-11-19",approvedUntil:"2026-11-20T04:59:59Z"}:count===13||count===39||count===10?{rateCardDate:"2026-11-19",approvedUntil:"2026-11-19T04:59:59Z"}:includeAggregatePrior===5||includeAggregatePrior===6||includeAggregatePrior===7||includeAggregatePrior===8||includeAggregatePrior===9||includeAggregatePrior===10?{rateCardDate:"2026-11-18",approvedUntil:"2026-11-18T23:59:59Z"}:{}), aggregate: count >= 6 ? { maximumCalls: maximum, maximumCountRequests: maximum, maximumNanoDollars: 5_000_000_000, priorRuns: [...refs] } : undefined, approvalReference: `SYNTHETIC SEALED PRIOR ${count}`, runDirectory: join(root, `prior-${count}`) };
    const configurationPath = join(root, `prior-${count}-config.json`);
    writeDescriptionEvaluationEvidence(configurationPath, { approval: prior });
    const fetcher: typeof fetch = async url => Response.json(String(url).endsWith("/input_tokens")
      ? { object: "response.input_tokens", input_tokens: count===63?7000:8000 }
      : { id: "resp_synthetic_prior", model: "gpt-6.1-sol", service_tier: "default", status: "completed", usage: worstCaseUsage ? {input_tokens:count===63?7000:8000,output_tokens:1500,total_tokens:count===63?8500:9500,input_tokens_details:{cached_tokens:0,cache_write_tokens:count===63?7000:8000,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:count===63?7000:8000}},output_tokens_details:{reasoning_tokens:0}} : { input_tokens: 100, output_tokens: 40, total_tokens: 140,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } } }, { headers: { "x-request-id": "req_synthetic_prior" } });
    const options = { approval: prior, apiKey: "synthetic", now: () => new Date((count===22||count===63)?"2026-11-19T16:00:00Z":count===13||count===39||count===10?"2026-11-19T00:30:00Z":"2026-11-18T16:00:00Z"), fetcher };
    if(count>=6){
      // Seed retained synthetic history between guarded first/last pairs; the80-real-reservation durability test stays unchanged.
      await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch(`description-prior-${count}-0-en`,1)("https://api.openai.com/v1/responses",init));
      const prefix=join(root,`.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
      for(let attempt=2;attempt<count;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
        const original=readFileSync(join(prior.runDirectory,`attempt-001-${suffix}.json`)),bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-prior-${count}-${attempt-1}-en`}):original;
        const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(prior.runDirectory,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
      }
      await withFoodDescriptionEvaluationBudget(options,async budget=>{await budget.fetch(`description-prior-${count}-${count-1}-en`,1)("https://api.openai.com/v1/responses",init);budget.halt();});
    }else for(let offset=0;offset<count;offset+=16)await withFoodDescriptionEvaluationBudget(options, async budget => {
      for (let index = offset; index < Math.min(count,offset+16); index++) await budget.fetch(`description-prior-${count}-${index}-en`, 1)("https://api.openai.com/v1/responses", init);
      if(offset+16>=count)budget.halt();
    });
    refs.push({ runDirectory: prior.runDirectory, configurationPath, configurationSha256: descriptionEvaluationFileHash(configurationPath),
      evidenceSha256: sealedDescriptionEvaluationEvidenceHash(prior.runDirectory), reservedPairs: count });
  }
  return refs;
}
