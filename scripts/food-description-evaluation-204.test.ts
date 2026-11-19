import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT } from "../src/lib/parent/food-description-runtime";
import { descriptionEvaluationPlan } from "./food-description-evaluation-adapter";
import { FOOD_DESCRIPTION_CORPUS_SHA, descriptionEvaluationAccounting, descriptionEvaluationHash, sealedDescriptionEvaluationEvidenceHash, sealedDescriptionEvaluationPriorAccounting, descriptionEvaluationApprovalSchema, withFoodDescriptionEvaluationBudget } from "./food-description-evaluation-budget";
import { sealedDescriptionEvaluationPriors } from "./food-description-evaluation-test-fixtures";

const roots: string[] = [], endpoint = "https://api.openai.com/v1/responses";
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function setup(maximumCalls: 204 | 267 = 204) {
  const root = mkdtempSync(join(tmpdir(), "description-204-")); roots.push(root);
  const base = { purpose: "optional_food_description_synthetic_evaluation_v1", syntheticOnly: true, approvalReference: "SYNTHETIC204 ONLY", approvedUntil: "2026-11-20T04:59:59Z", processorReference: "synthetic", noticeRetentionReference: "synthetic", billingReference: "original5 synthetic", projectId: "proj_synthetic", projectMetadataReference: "synthetic Standard global", approvedResponseModelId: "gpt-6.1-sol", region: "global", serviceTier: "default", fingerprint: FOOD_DESCRIPTION_FINGERPRINT, corpusSha256: FOOD_DESCRIPTION_CORPUS_SHA, adapterSha256: "a".repeat(64), rateCardDate: "2026-11-19", maximumCalls: 80, maximumCountRequests: 80, maximumInputTokens: 8000, maximumOutputTokens: 1500, maximumNanoDollars: 5_000_000_000, runDirectory: join(root, "run") };
  const init = { method: "POST", redirect: "error" as const, headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json", "OpenAI-Project": "proj_synthetic" }, body: JSON.stringify({ ...FOOD_DESCRIPTION_EVALUATION_BINDING.request, input: [{ role: "user", content: JSON.stringify(descriptionEvaluationPlan().cases[0].turns[0].projection) }] }) };
  const priorRuns = await sealedDescriptionEvaluationPriors(base, init, maximumCalls === 267 ? 10 : 9);
  const approval = { ...base, aggregate: { maximumCalls, maximumCountRequests: maximumCalls, maximumNanoDollars: 5_000_000_000, priorRuns } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).endsWith("/input_tokens") ? { object: "response.input_tokens", input_tokens: 7000 } : { id: "resp_synthetic204", model: "gpt-6.1-sol", service_tier: "default", status: "completed", usage: { input_tokens: 7000, output_tokens: 1500, total_tokens: 8500, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 7000 } }, output_tokens_details: { reasoning_tokens: 0 } } }));
  return { root, approval, priorRuns, init, fetcher, options: { approval, apiKey: "synthetic", now: () => new Date("2026-11-19T16:00:00Z"), fetcher } };
}

it.each([204, 267] as const)("keeps all sealed pairs and worst-case charges inside original5 through pair%s, then denies the next", async maximum => {
  const s = await setup(maximum), before = s.priorRuns.map(ref => sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(s.approval))).toMatchObject({ pairs: maximum - 80, reservedNanoDollars: maximum === 267 ? 9_970_000_000 : 6_820_000_000, budgetedNanoDollars: maximum === 267 ? 112_200_000 : 74_400_000 });
  await withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-first-en", 1)(endpoint, s.init));
  const prefix = join(s.root, `.food-description-evaluation-${descriptionEvaluationHash(s.approval.approvalReference)}`);
  for (let attempt = 2; attempt <= 79; attempt++) for (const suffix of ["intent", "count-dispatch", "count", "dispatch", "observation", "response"]) {
    const original = readFileSync(join(s.approval.runDirectory, `attempt-001-${suffix}.json`)), bytes = suffix === "intent" ? JSON.stringify({ ...JSON.parse(original.toString()), attempt, caseId: `description-seeded-${attempt}-en` }) : original;
    const stem = `attempt-${String(attempt).padStart(3, "0")}`;
    writeFileSync(join(s.approval.runDirectory, `${stem}-${suffix}.json`), bytes, { mode: 0o600, flag: "wx" });
    if (suffix !== "response") writeFileSync(`${prefix}-${stem}-${suffix}.json`, bytes, { mode: 0o600, flag: "wx" });
  }
  await withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-last-en", 1)(endpoint, s.init));
  expect(descriptionEvaluationAccounting(s.approval.runDirectory)).toMatchObject({ reservedPairs: 80, reservedNanoDollars: 4_000_000_000, knownMeasuredNanoDollars: 4_000_000_000, costComplete: true });
  await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-forbidden205-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(4); expect(s.priorRuns.map(ref => sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
});

it.each([204, 267] as const)("records an over-ceiling count but never generates or refunds its50m reservation (%s)", async maximum => {
  const s = await setup(maximum); s.fetcher.mockResolvedValue(Response.json({ object: "response.input_tokens", input_tokens: 7001 }));
  await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-over-ceiling-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledOnce();
  expect(descriptionEvaluationAccounting(s.approval.runDirectory)).toMatchObject({ reservedPairs: 1, completedCountReceipts: 1, generationHttpAttemptMarkers: 0, reservedNanoDollars: 50_000_000, knownMeasuredNanoDollars: 0, costComplete: false, halted: true });
  expect(JSON.parse(readFileSync(join(s.approval.runDirectory, "attempt-001-count-dispatch.json"), "utf8"))).toEqual({ maximumInputTokens: 7000 });
  await expect(withFoodDescriptionEvaluationBudget(s.options, async () => {})).rejects.toThrow(); expect(s.fetcher).toHaveBeenCalledOnce();
});

it.each([204, 267] as const)("rejects a readback charge above the narrowed reservation (%s)", async maximum => {
  const s = await setup(maximum);
  await withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-readback-en", 1)(endpoint, s.init));
  const prefix = join(dirname(s.approval.runDirectory), `.food-description-evaluation-${descriptionEvaluationHash(s.approval.approvalReference)}`);
  for (const path of [join(s.approval.runDirectory, "attempt-001-observation.json"), `${prefix}-attempt-001-observation.json`]) {
    const observation = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...observation, measuredNanoDollars: 50_000_001 }));
  }
  expect(() => descriptionEvaluationAccounting(s.approval.runDirectory)).toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(2);
});

it.each(["missing ninth", "wrong count", "changed seal"])("blocks204 with%s before either endpoint", async kind => {
  const s = await setup();
  if (kind === "missing ninth") s.priorRuns.pop();
  if (kind === "wrong count") s.priorRuns[8].reservedPairs = 20;
  if (kind === "changed seal") writeFileSync(join(s.priorRuns[8].runDirectory, "attempt-001-response.json"), "{}");
  await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-forbidden-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});


it.each(["missing tenth", "wrong count", "changed seal", "old204 repriced"])("blocks267 with%s before either endpoint", async kind => {
  const s = await setup(267), ref = s.priorRuns[9];
  if (kind === "missing tenth") s.priorRuns.pop();
  if (kind === "wrong count") ref.reservedPairs = 22;
  if (kind === "changed seal") writeFileSync(join(ref.runDirectory, "attempt-001-response.json"), "{}");
  if (kind === "old204 repriced") {
    const prior = JSON.parse(readFileSync(join(ref.runDirectory, "approval.json"), "utf8"));
    const prefix = join(s.root, `.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
    for (const path of [join(ref.runDirectory, "attempt-001-intent.json"), `${prefix}-attempt-001-intent.json`]) {
      const intent = JSON.parse(readFileSync(path, "utf8")); writeFileSync(path, JSON.stringify({ ...intent, reservedNanoDollars: 55_000_000 }));
    }
    ref.evidenceSha256 = sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  }
  await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-forbidden267-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});
