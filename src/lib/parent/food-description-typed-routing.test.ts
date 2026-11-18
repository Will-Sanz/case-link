import { describe, expect, it, vi } from "vitest";
import prior from "../../../tests/fixtures/parent/food-description-typed-routing-prior-response-2026-11-18.json";
import { descriptionEvaluationContext, descriptionEvaluationPlannedProjection, descriptionEvaluationResult, loadDescriptionEvaluationCorpus } from "../../../scripts/food-description-evaluation-adapter";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { buildFoodDescriptionProjection, foodDescriptionSelectionSchema, validateFoodDescriptionSelection } from "./food-description";

const now = new Date("2026-11-18T12:00:00Z");
const item = loadDescriptionEvaluationCorpus().cases.find(item => item.id === prior.caseId)!;
const selection = foodDescriptionSelectionSchema.parse(JSON.parse(prior.messageOutputText));
const currentContext = () => descriptionEvaluationContext(item);

describe("offline replay of the actual third response, without a new model-quality claim", () => {
  it("reconstructs the exact approved projection from the actual corpus input and original typed dates", () => {
    const context = { ...currentContext(), catalogVersion: prior.priorFingerprint };
    expect(buildFoodDescriptionProjection({ description: prior.projection.description, screenLocale: prior.projection.screenLocale }, context, now)).toEqual(prior.projection);
    expect(prior.projection.routingFacts.benefitHistory).toEqual({ value: "applied", source: "parent_typed", confirmedAt: "2026-11-18T11:01:00Z", expiresAt: "2026-11-19T11:01:00.000Z" });
    expect(prior.projection.routingFacts).not.toHaveProperty("zip");
  });
  it("still rejects that actual response instead of filtering its already-answered question or repairing it", () => {
    const context = currentContext(), projection = descriptionEvaluationPlannedProjection(item, 0);
    expect({ ...projection, catalogVersion: prior.projection.catalogVersion }).toEqual(prior.projection);
    expect(selection.questionIds).toEqual(["foodForTwoDays", "benefitHistory"]);
    expect(() => descriptionEvaluationResult(projection, selection, context)).toThrow("parent_food_description_unverified_selection");
    expect(selection.questionIds).toEqual(["foodForTwoDays", "benefitHistory"]);
  });
  it("dispatches an explicit known-routing-fact instruction while leaving final questions with the server", () => {
    // A prompt-contract regression only. It cannot establish how a future model will respond.
    const instructions = FOOD_DESCRIPTION_EVALUATION_BINDING.request.instructions;
    expect(instructions).toContain("routingFacts");
    expect(instructions).toMatch(/return questionIds as an empty array/i);
    expect(FOOD_DESCRIPTION_EVALUATION_BINDING.request.text.format.schema.properties!.questionIds).toMatchObject({ maxItems: 0 });
    expect(instructions).toContain("server computes final missing questions");
  });
  it("fails the actual prior message closed in the worker after its synthetic dispatch, without repair, finish or retry", async () => {
    const context = currentContext(), draft = "00000000-0000-4000-8000-000000000011", lease = "00000000-0000-4000-8000-000000000012", charge = "00000000-0000-4000-8000-000000000013";
    const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[] }> => {
      if (sql.includes("parent_claim_food_description")) return { rows: [{ value: { projectId: "proj_synthetic", draftId: draft, revision: 1, leaseToken: lease,
        input: { description: prior.projection.description, screenLocale: "en" }, context, dispatchUntil: "2026-11-18T12:15:00Z" } }] };
      if (sql.includes("parent_reserve_food_description")) return { rows: [{ value: charge }] };
      if (sql.includes("parent_food_description_current")) return { rows: [{ value: context }] };
      return { rows: [] };
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: prior.messageOutputText }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } } }));
    await runOneFoodDescriptionTurn({ database: { query }, apiKey: "synthetic-test-only", projectId: "proj_synthetic", fetcher, now: () => now });
    expect(fetcher).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(JSON.parse(sent.input[0].content).routingFacts).toEqual(prior.projection.routingFacts);
    expect(sent.instructions).toBe(FOOD_DESCRIPTION_EVALUATION_BINDING.request.instructions);
    const calls = query.mock.calls.map(call => call[0]);
    expect(calls.filter(sql => sql.includes("parent_reserve_food_description"))).toHaveLength(1);
    expect(calls.some(sql => sql.includes("parent_record_food_description_usage"))).toBe(true);
    expect(calls.some(sql => sql.includes("parent_finish_food_description"))).toBe(false);
    expect(query).toHaveBeenLastCalledWith("select parent_private.parent_fail_food_description($1,$2,$3)", [draft, 1, lease]);
  });
  it("keeps typed applied history, source dates and conflict assertions without permitting a new application", () => {
    const context = currentContext(), projection = descriptionEvaluationPlannedProjection(item, 0);
    const text = "never applied for SNAP", start = projection.description.indexOf(text);
    // Independently supplied deterministic guard fixture, not a repaired model response or quality pass.
    const supplied = { needIds: ["snap_pending"], selections: [], assertions: [{ questionId: "benefitHistory", value: "never", span: { start, end: start + text.length, text } }], exclusions: [], questionIds: [], outOfScope: null };
    const result = validateFoodDescriptionSelection({ projection, selection: supplied, currentContext: context, now });
    expect(result.proposedAnswers.benefitHistory).toBe("applied");
    expect(result.originalFacts).toEqual(prior.projection.routingFacts);
    expect(result.conflicts).toEqual(["benefitHistory"]);
    expect(result.questionIds).toEqual(["foodForTwoDays"]);
    expect(result.needIds).toEqual(["snap_pending"]);
    expect(result.executionGranted).toBe(false);
    expect(() => validateFoodDescriptionSelection({ projection, selection: { ...supplied, needIds: ["snap_new"] }, currentContext: context, now })).toThrow("parent_food_description_unverified_selection");
  });
});
