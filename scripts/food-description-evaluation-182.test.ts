import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT, foodDescriptionUsage } from "../src/lib/parent/food-description-runtime";
import { descriptionEvaluationPlan } from "./food-description-evaluation-adapter";
import { FOOD_DESCRIPTION_CORPUS_SHA, descriptionEvaluationAccounting, descriptionEvaluationApprovalSchema, descriptionEvaluationFileHash, descriptionEvaluationHash, foodDescriptionMeasuredNanoDollars, sealedDescriptionEvaluationEvidenceHash, sealedDescriptionEvaluationPriorAccounting, withFoodDescriptionEvaluationBudget } from "./food-description-evaluation-budget";
import { sealedDescriptionEvaluationPriors } from "./food-description-evaluation-test-fixtures";

const roots: string[] = [], endpoint = "https://api.openai.com/v1/responses";
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "description-182-")); roots.push(root);
  const approval = { purpose: "optional_food_description_synthetic_evaluation_v1", syntheticOnly: true, approvalReference: "SYNTHETIC182 ONLY", approvedUntil: "2026-11-20T04:59:59Z", processorReference: "synthetic", noticeRetentionReference: "synthetic", billingReference: "original5 synthetic", projectId: "proj_synthetic", projectMetadataReference: "synthetic Standard global", approvedResponseModelId: "gpt-6.1-sol", region: "global", serviceTier: "default", fingerprint: FOOD_DESCRIPTION_FINGERPRINT, corpusSha256: FOOD_DESCRIPTION_CORPUS_SHA, adapterSha256: "a".repeat(64), rateCardDate: "2026-11-19", maximumCalls: 80, maximumCountRequests: 80, maximumInputTokens: 8000, maximumOutputTokens: 1500, maximumNanoDollars: 5_000_000_000, runDirectory: join(root, "run") };
  const init = { method: "POST", redirect: "error" as const, headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json", "OpenAI-Project": "proj_synthetic" }, body: JSON.stringify({ ...FOOD_DESCRIPTION_EVALUATION_BINDING.request, input: [{ role: "user", content: JSON.stringify(descriptionEvaluationPlan().cases[0].turns[0].projection) }] }) };
  const priorRuns = await sealedDescriptionEvaluationPriors(approval, init, 8);
  const current = { ...approval, aggregate: { maximumCalls: 182, maximumCountRequests: 182, maximumNanoDollars: 5_000_000_000, priorRuns } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => Response.json(String(url).endsWith("/input_tokens") ? { object: "response.input_tokens", input_tokens: 8000 } : { id: "resp_synthetic182", model: "gpt-6.1-sol", service_tier: "default", status: "completed", usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } } }));
  return { root, init, priorRuns, approval: current, fetcher, options: { approval: current, apiKey: "synthetic", now: () => new Date("2026-11-19T16:00:00Z"), fetcher } };
}

it("requires exactly182 pairs and original5 with all102 sealed predecessors", async () => {
  const s = await setup();
  expect(descriptionEvaluationApprovalSchema.parse(s.approval)).toMatchObject({ maximumCalls: 80, maximumCountRequests: 80, maximumNanoDollars: 5_000_000_000, aggregate: { maximumCalls: 182, maximumCountRequests: 182 } });
  for (const maximum of [181, 183]) expect(descriptionEvaluationApprovalSchema.safeParse({ ...s.approval, aggregate: { ...s.approval.aggregate, maximumCalls: maximum, maximumCountRequests: maximum } }).success).toBe(false);
  for (const changed of [{ maximumNanoDollars: 5_000_000_001 }, { maximumCalls: 81 }, { maximumCountRequests: 81 }]) expect(descriptionEvaluationApprovalSchema.safeParse({ ...s.approval, ...changed }).success).toBe(false);
  expect(descriptionEvaluationApprovalSchema.safeParse({ ...s.approval, aggregate: { ...s.approval.aggregate, maximumNanoDollars: 5_000_000_001 } }).success).toBe(false);
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(s.approval))).toEqual({ pairs: 102, reservedNanoDollars: 5_610_000_000, knownMeasuredNanoDollars: 61_200_000, budgetedNanoDollars: 61_200_000 });
});

function seedThrough(dir: string, approvalReference: string, final: number) {
  const prefix = join(dirname(dir), `.food-description-evaluation-${descriptionEvaluationHash(approvalReference)}`);
  for (let attempt = 2; attempt <= final; attempt++) for (const suffix of ["intent", "count-dispatch", "count", "dispatch", "observation", "response"]) {
    const original = readFileSync(join(dir, `attempt-001-${suffix}.json`)), bytes = suffix === "intent" ? JSON.stringify({ ...JSON.parse(original.toString()), attempt, caseId: `description-seeded-${attempt}-en` }) : original;
    const stem = `attempt-${String(attempt).padStart(3, "0")}`;
    writeFileSync(join(dir, `${stem}-${suffix}.json`), bytes, { mode: 0o600, flag: "wx" });
    if (suffix !== "response") writeFileSync(`${prefix}-${stem}-${suffix}.json`, bytes, { mode: 0o600, flag: "wx" });
  }
}

it("admits the182nd pair, rejects183, and preserves every prior seal and original expiry", async () => {
  const s = await setup(), before = s.priorRuns.map(ref => sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  await withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-first-en", 1)(endpoint, s.init));
  seedThrough(s.approval.runDirectory, s.approval.approvalReference, 79);
  await withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-last-en", 1)(endpoint, s.init));
  expect(descriptionEvaluationAccounting(s.approval.runDirectory)).toMatchObject({ reservedPairs: 80, reservedNanoDollars: 4_400_000_000, costComplete: true });
  await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-forbidden183-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(4); expect(s.priorRuns.map(ref => sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
  for (const [index, ref] of s.priorRuns.entries()) expect(JSON.parse(readFileSync(join(ref.runDirectory, "approval.json"), "utf8"))).toMatchObject(index < 5 ? { rateCardDate: "2026-11-18", approvedUntil: "2026-11-18T23:59:59Z" } : { rateCardDate: "2026-11-19", approvedUntil: "2026-11-19T04:59:59Z", aggregate: { maximumCalls: [120, 133, 172][index - 5] } });
});

it("pins182 to a fresh Nov19 window before any new durable action", async () => {
  const s = await setup(), before = readdirSync(s.root).sort();
  for (const changed of [{ rateCardDate: "2026-11-18" }, { rateCardDate: "2026-11-20" }, { approvedUntil: "2026-11-19T04:59:59Z" }, { approvedUntil: "2026-11-20T05:00:00Z" }]) await expect(withFoodDescriptionEvaluationBudget({ ...s.options, approval: { ...s.approval, ...changed } }, async () => {})).rejects.toThrow();
  for (const date of ["2026-11-18T23:59:58Z", "2026-11-20T00:30:00Z", "2026-11-20T04:59:59Z"]) await expect(withFoodDescriptionEvaluationBudget({ ...s.options, now: () => new Date(date) }, async () => {})).rejects.toThrow();
  expect(readdirSync(s.root).sort()).toEqual(before); expect(s.fetcher).not.toHaveBeenCalled();
});

it("refuses prior quality credit in the fresh182 run without changing any sealed history", async () => {
  const s = await setup(), before = s.priorRuns.map(ref => sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  mkdirSync(s.approval.runDirectory, { mode: 0o700 });
  writeFileSync(join(s.approval.runDirectory, "description-urgent-1-en-result.json"), '{"synthetic":"copied prior quality"}', { mode: 0o600 });
  await expect(withFoodDescriptionEvaluationBudget(s.options, async () => {})).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled(); expect(s.priorRuns.map(ref => sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
});

it.each(["missing eighth", "wrong nested reference", "wrong eighth aggregate", "unsealed eighth", "missing response", "false charge", "unknown usage", "changed eighth expiry", "changed eighth card", "duplicate eighth", "wrong eighth count"])("blocks182 %s without a new endpoint or refund", async kind => {
  const s = await setup(), ref = s.priorRuns[7], config = JSON.parse(readFileSync(ref.configurationPath, "utf8")), prior = config.approval;
  const prefix = join(dirname(ref.runDirectory), `.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
  if (kind === "wrong nested reference") prior.aggregate.priorRuns[6].evidenceSha256 = "f".repeat(64);
  if (kind === "wrong eighth aggregate") prior.aggregate = { ...prior.aggregate, maximumCalls: 133, maximumCountRequests: 133, priorRuns: prior.aggregate.priorRuns.slice(0, 6) };
  if (kind === "unsealed eighth") { rmSync(join(ref.runDirectory, "halted.json")); rmSync(`${prefix}-halted.json`); }
  if (kind === "missing response") rmSync(join(ref.runDirectory, "attempt-001-response.json"));
  if (kind === "false charge" || kind === "unknown usage") for (const path of [join(ref.runDirectory, "attempt-001-observation.json"), `${prefix}-attempt-001-observation.json`]) {
    const observation = JSON.parse(readFileSync(path, "utf8")); if (kind === "false charge") observation.measuredNanoDollars = 0; else observation.usage = { complete: false }; writeFileSync(path, JSON.stringify(observation));
  }
  if (kind === "changed eighth expiry") prior.approvedUntil = "2026-11-20T04:59:59Z";
  if (kind === "changed eighth card") prior.rateCardDate = "2026-11-18";
  if (["wrong nested reference", "wrong eighth aggregate", "changed eighth expiry", "changed eighth card"].includes(kind)) {
    for (const path of [join(ref.runDirectory, "approval.json"), `${prefix}.json`]) writeFileSync(path, JSON.stringify(prior));
    writeFileSync(ref.configurationPath, JSON.stringify(config)); ref.configurationSha256 = descriptionEvaluationFileHash(ref.configurationPath);
  }
  ref.evidenceSha256 = sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  if (kind === "missing eighth") s.priorRuns.pop();
  if (kind === "duplicate eighth") s.priorRuns[7] = { ...s.priorRuns[6], reservedPairs: 10 };
  if (kind === "wrong eighth count") s.priorRuns[7] = { ...ref, reservedPairs: 20 };
  await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-new-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled(); expect(descriptionEvaluationAccounting(ref.runDirectory).reservedPairs).toBe(10);
});

it("retains original5 when complete historical charges prevent a fresh80th pair", async () => {
  const s = await setup(), ref = s.priorRuns[7], prior = JSON.parse(readFileSync(join(ref.runDirectory, "approval.json"), "utf8"));
  const prefix = join(dirname(ref.runDirectory), `.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
  for (let attempt = 1; attempt <= 10; attempt++) {
    const stem = `attempt-${String(attempt).padStart(3, "0")}`, responsePath = join(ref.runDirectory, `${stem}-response.json`), response = JSON.parse(readFileSync(responsePath, "utf8"));
    response.usage = { input_tokens: 8000, output_tokens: 1500, total_tokens: 9500, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 8000, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 8000 } }, output_tokens_details: { reasoning_tokens: 0 } };
    writeFileSync(responsePath, JSON.stringify(response));
    const observation = JSON.parse(readFileSync(join(ref.runDirectory, `${stem}-observation.json`), "utf8"));
    observation.usage = foodDescriptionUsage(response, observation.usage.requestId); observation.measuredNanoDollars = foodDescriptionMeasuredNanoDollars(observation.usage); observation.responseHash = descriptionEvaluationHash(response);
    for (const path of [join(ref.runDirectory, `${stem}-observation.json`), `${prefix}-${stem}-observation.json`]) writeFileSync(path, JSON.stringify(observation));
  }
  ref.evidenceSha256 = sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(s.approval))).toMatchObject({ pairs: 102, reservedNanoDollars: 5_610_000_000, knownMeasuredNanoDollars: 605_200_000, budgetedNanoDollars: 605_200_000 });
  await withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-first-en", 1)(endpoint, s.init)); seedThrough(s.approval.runDirectory, s.approval.approvalReference, 79);
  await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-no-extra-dollar-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(descriptionEvaluationAccounting(s.approval.runDirectory)).toMatchObject({ reservedPairs: 79, reservedNanoDollars: 4_345_000_000, costComplete: true }); expect(s.fetcher).toHaveBeenCalledTimes(2);
});
