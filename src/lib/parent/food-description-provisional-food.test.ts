import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDescriptionEvaluationAnswers, DESCRIPTION_EVALUATION_NOW, descriptionEvaluationContext, descriptionEvaluationInput, loadDescriptionEvaluationCorpus } from "../../../scripts/food-description-evaluation-adapter";
import { buildFoodDescriptionProjection, reconcileFoodDescriptionRequests, validateFoodDescriptionSelection, type FoodDescriptionContext } from "./food-description";
const legacyPlan = JSON.parse(readFileSync(new URL("../../../tests/fixtures/parent/food-description-2026-11-18.v6-adapter.json", import.meta.url), "utf8"));

// Only the exact message was extracted from retained revised-run attempt003, never its reasoning or complete response.
const retained = JSON.parse(readFileSync(new URL("../../../tests/fixtures/parent/food-description-provisional-food-response-2026-11-18.json", import.meta.url), "utf8")) as {
  caseId: string; attempt: number; requestHash: string; responseHash: string; message: string;
};
const item = loadDescriptionEvaluationCorpus().cases.find(value => value.id === retained.caseId)!;
const now = new Date(DESCRIPTION_EVALUATION_NOW), input = descriptionEvaluationInput(item, 0);
const context = () => descriptionEvaluationContext(item);
const selection = () => JSON.parse(retained.message);
const owned = (need: "food_now" | "snap_pending" | "snap_renewal") => [{ ownerId: context().ownerId, requestId: "00000000-0000-4000-8000-000000000201", requestVersion: 3, requestStatus: "active", needIds: [need], pendingSnapFollowUp: false }];
function result(current = context(), currentRequests: unknown = [], selected: unknown = selection()) {
  const projection = buildFoodDescriptionProjection(input, current, now);
  return reconcileFoodDescriptionRequests(validateFoodDescriptionSelection({ projection, selection: selected, currentContext: current, now }), currentRequests, current.ownerId);
}
afterEach(() => vi.unstubAllGlobals());

describe("server reconciliation of an unanswered food question", () => {
  it("retains provisional food from the exact revised response without changing its request, typed source or execution boundary", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const current = context(), projection = buildFoodDescriptionProjection(input, current, now);
    expect(legacyPlan.modelFingerprint).toBe("88601cb7e99625144dc88e3866b0377eeeb4c10aa90fcc4af58c392ff3fcb5ea");
    const legacyStage = legacyPlan.cases.find((value: { id: string }) => value.id === retained.caseId).turns[0];
    expect({ ...projection, catalogVersion: legacyPlan.modelFingerprint }).toEqual(legacyStage.projection);
    expect(legacyStage.requestSha256).toBe(retained.requestHash);
    const value = result(current);
    expect(value).toMatchObject({ state: "needs_clarification", needIds: ["food_now", "snap_pending"], questionIds: ["foodForTwoDays"],
      proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "applied", existingIssue: null }, conflicts: ["benefitHistory"],
      proposedUrgency: null, requiresTypedTiming: true, executionGranted: false });
    expect(value.originalFacts).toEqual(projection.routingFacts);
    expect(value.originalFacts.benefitHistory).toEqual({ value: "applied", source: "parent_typed", confirmedAt: "2026-11-18T11:01:00Z", expiresAt: "2026-11-19T11:01:00.000Z" });
    expect(value.assertions).toEqual(selection().assertions);
    expect(value.selections).toEqual(selection().selections); // A provisional need never invents a model-selected program.
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["yes", "no", "not_sure"] as const)("uses a typed %s answer without repeating known questions or granting execution", answer => {
    const original = context(), current = applyDescriptionEvaluationAnswers(original, { foodForTwoDays: answer });
    const value = result(current, [], { ...selection(), questionIds: [] });
    expect(value.needIds).toEqual(answer === "yes" ? ["snap_pending"] : ["food_now", "snap_pending"]);
    expect(value).toMatchObject({ state: "proposal", questionIds: [], proposedAnswers: { foodForTwoDays: answer, benefitHistory: "applied", existingIssue: null },
      conflicts: ["benefitHistory"], proposedUrgency: answer === "no" ? "today" : null, executionGranted: false });
    expect(value.originalFacts.benefitHistory).toEqual(original.facts.benefitHistory);
  });
  it("honors an explicit food exclusion rather than recreating its question or need", () => {
    const current: FoodDescriptionContext = { ...context(), excludedNeedIds: ["food_now"] };
    expect(result(current, [], { ...selection(), questionIds: [] })).toMatchObject({ needIds: ["snap_pending"], questionIds: [], excludedNeedIds: ["food_now"] });
  });
  it("preserves an exact source-bound food exclusion without adding a provisional route", () => {
    const text = "groceries", start = input.description.indexOf(text);
    expect(result(context(), [], { ...selection(), questionIds: [], exclusions: [{ need: "food_now", span: { start, end: start + text.length, text } }] }))
      .toMatchObject({ needIds: ["snap_pending"], questionIds: [], excludedNeedIds: ["food_now"] });
  });
  it("suppresses incidental food when an owned request covers the benefit-only description", () => {
    expect(result(context(), owned("snap_pending"))).toMatchObject({ state: "open_existing", needIds: [], questionIds: [], existingRequests: [{ requestId: owned("snap_pending")[0].requestId, needIds: ["snap_pending"] }] });
  });
  it("suppresses food already covered by an owned request while retaining the independent pending journey", () => {
    expect(result(context(), owned("food_now"))).toMatchObject({ state: "proposal", needIds: ["snap_pending"], questionIds: [], existingRequests: [{ requestId: owned("food_now")[0].requestId, needIds: ["food_now"] }] });
  });
  it("preserves uncovered food alongside a distinct owned benefit journey", () => {
    expect(result(context(), owned("snap_renewal"))).toMatchObject({ state: "needs_clarification", needIds: ["food_now", "snap_pending"], questionIds: ["foodForTwoDays"], existingRequests: [] });
  });
  it("keeps explicitly requested uncovered food even when the pending benefit is already covered", () => {
    expect(result(context(), owned("snap_pending"), { ...selection(), needIds: ["food_now", "snap_pending"] })).toMatchObject({ needIds: ["food_now"], questionIds: ["foodForTwoDays"] });
  });
});
