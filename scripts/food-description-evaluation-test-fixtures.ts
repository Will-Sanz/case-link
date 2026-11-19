import { dirname, join } from "node:path";
import { descriptionEvaluationApprovalSchema, descriptionEvaluationFileHash, sealedDescriptionEvaluationEvidenceHash, withFoodDescriptionEvaluationBudget, writeDescriptionEvaluationEvidence } from "./food-description-evaluation-budget";

/** Complete synthetic accounting predecessors only; the fetcher never makes HTTP or measures model quality. */
export async function sealedDescriptionEvaluationPriors(value: unknown, init: RequestInit, includeAggregatePrior: boolean | 4 | 5 | 6 = false, worstCaseUsage = false) {
  const approval = descriptionEvaluationApprovalSchema.parse(value), root = dirname(approval.runDirectory);
  const refs: {runDirectory:string;configurationPath:string;configurationSha256:string;evidenceSha256:string;reservedPairs:number}[] = [];
  for (const count of (includeAggregatePrior === 6 ? [3, 4, 6, 7, 20, 13] : includeAggregatePrior === 5 ? [3, 4, 6, 7, 20] : includeAggregatePrior === 4 ? [3, 4, 6, 7] : includeAggregatePrior ? [3, 4, 6] : [3, 4])) {
    const maximum=count===6?87:count===7?93:count===13?120:100;
    const prior = { ...approval, ...(count===13?{rateCardDate:"2026-11-19",approvedUntil:"2026-11-19T04:59:59Z"}:includeAggregatePrior===5||includeAggregatePrior===6?{rateCardDate:"2026-11-18",approvedUntil:"2026-11-18T23:59:59Z"}:{}), aggregate: count >= 6 ? { maximumCalls: maximum, maximumCountRequests: maximum, maximumNanoDollars: 5_000_000_000, priorRuns: [...refs] } : undefined, approvalReference: `SYNTHETIC SEALED PRIOR ${count}`, runDirectory: join(root, `prior-${count}`) };
    const configurationPath = join(root, `prior-${count}-config.json`);
    writeDescriptionEvaluationEvidence(configurationPath, { approval: prior });
    const fetcher: typeof fetch = async url => Response.json(String(url).endsWith("/input_tokens")
      ? { object: "response.input_tokens", input_tokens: 8000 }
      : { id: "resp_synthetic_prior", model: "gpt-6.1-sol", service_tier: "default", status: "completed", usage: worstCaseUsage ? {input_tokens:8000,output_tokens:1500,total_tokens:9500,input_tokens_details:{cached_tokens:0,cache_write_tokens:8000,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:8000}},output_tokens_details:{reasoning_tokens:0}} : { input_tokens: 100, output_tokens: 40, total_tokens: 140,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } } }, { headers: { "x-request-id": "req_synthetic_prior" } });
    for(let offset=0;offset<count;offset+=16)await withFoodDescriptionEvaluationBudget({ approval: prior, apiKey: "synthetic", now: () => new Date(count===13?"2026-11-19T00:30:00Z":"2026-11-18T16:00:00Z"), fetcher }, async budget => {
      for (let index = offset; index < Math.min(count,offset+16); index++) await budget.fetch(`description-prior-${count}-${index}-en`, 1)("https://api.openai.com/v1/responses", init);
      if(offset+16>=count)budget.halt();
    });
    refs.push({ runDirectory: prior.runDirectory, configurationPath, configurationSha256: descriptionEvaluationFileHash(configurationPath),
      evidenceSha256: sealedDescriptionEvaluationEvidenceHash(prior.runDirectory), reservedPairs: count });
  }
  return refs;
}
