import { dirname, join } from "node:path";
import { descriptionEvaluationApprovalSchema, descriptionEvaluationFileHash, sealedDescriptionEvaluationEvidenceHash, withFoodDescriptionEvaluationBudget, writeDescriptionEvaluationEvidence } from "./food-description-evaluation-budget";

/** Complete synthetic accounting predecessors only; the fetcher never makes HTTP or measures model quality. */
export async function sealedDescriptionEvaluationPriors(value: unknown, init: RequestInit) {
  const approval = descriptionEvaluationApprovalSchema.parse(value), root = dirname(approval.runDirectory), refs = [];
  for (const count of [3, 4] as const) {
    const prior = { ...approval, aggregate: undefined, approvalReference: `SYNTHETIC SEALED PRIOR ${count}`, runDirectory: join(root, `prior-${count}`) };
    const configurationPath = join(root, `prior-${count}-config.json`);
    writeDescriptionEvaluationEvidence(configurationPath, { approval: prior });
    const fetcher: typeof fetch = async url => Response.json(String(url).endsWith("/input_tokens")
      ? { object: "response.input_tokens", input_tokens: 8000 }
      : { id: "resp_synthetic_prior", model: "gpt-6.1-sol", service_tier: "default", status: "completed", usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } } });
    await withFoodDescriptionEvaluationBudget({ approval: prior, apiKey: "synthetic", now: () => new Date("2026-11-18T16:00:00Z"), fetcher }, async budget => {
      for (let index = 0; index < count; index++) await budget.fetch(`description-prior-${count}-${index}-en`, 1)("https://api.openai.com/v1/responses", init);
      budget.halt();
    });
    refs.push({ runDirectory: prior.runDirectory, configurationPath, configurationSha256: descriptionEvaluationFileHash(configurationPath),
      evidenceSha256: sealedDescriptionEvaluationEvidenceHash(prior.runDirectory), reservedPairs: count });
  }
  return refs;
}
