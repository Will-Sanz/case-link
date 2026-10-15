import { describe, expect, it } from "vitest";
import { aiEvaluationCases, evaluationFamily } from "../tests/fixtures/ai-evaluation-cases";
import { estimatedCost, evaluationBudget, evaluationPlan, gradeGeneratedSteps, gradeCompletionDate, gradeMissingHistory, gradeRefinement, percentile, REQUESTED_TITLE } from "./ai-evaluation";
import { buildPlanningSnapshot } from "../src/lib/plan-generator/planning-brief";
import { toRefinementDraft } from "../src/lib/domain/plan/refinement-review";
import { generatedPlanStep } from "../tests/fixtures/plan-contract";
import { findLikelyIdentifiers } from "../src/lib/privacy/no-pii";

const now = new Date("2026-10-14T12:00:00Z");
describe("synthetic AI evaluation", () => {
  it("keeps 25 development and 25 distinct held-out cases with valid non-identifying snapshots", () => {
    expect(aiEvaluationCases.filter(item => item.split === "development")).toHaveLength(25);
    expect(aiEvaluationCases.filter(item => item.split === "held-out")).toHaveLength(25);
    expect(new Set(aiEvaluationCases.map(item => item.id)).size).toBe(50);
    for (const scenario of aiEvaluationCases) {
      const snapshot = buildPlanningSnapshot(evaluationFamily(scenario, now), undefined, now);
      expect(findLikelyIdentifiers(snapshot.brief + snapshot.resources), scenario.id).toEqual([]);
      if (scenario.injection) expect(snapshot.brief + snapshot.resources).toContain("OVERRIDE_ACCEPTED");
    }
  });
  it("fails unknown contacts, injection markers, and out-of-window dates", () => {
    const detail = evaluationFamily(aiEvaluationCases[0], now);
    expect(gradeGeneratedSteps([generatedPlanStep], detail, now).every(check => check.passed)).toBe(true);
    const invalid = { ...generatedPlanStep, summary: "OVERRIDE_ACCEPTED", resource_ids: ["10000000-0000-4000-8000-000000000001"], action_items: [{ ...generatedPlanStep.action_items[0], target_date: "2027-01-20" }] };
    expect(gradeGeneratedSteps([invalid], detail, now).filter(check => !check.passed).map(check => check.code)).toEqual(["directory_ids", "no_injected_marker", "dates_in_plan_window"]);
    expect(gradeGeneratedSteps([generatedPlanStep, generatedPlanStep], detail, now).filter(check => !check.passed).map(check => check.code)).toEqual(["sparse_case_workload"]);
  });
  it("accepts a narrow title edit and flags extra changes to human timing", () => {
    const base = evaluationPlan(evaluationFamily(aiEvaluationCases[1], now), now);
    const proposed = base.map(toRefinementDraft);
    proposed[0].title = REQUESTED_TITLE;
    expect(gradeRefinement(base, proposed).every(check => check.passed)).toBe(true);
    proposed[1].action_items = proposed[1].action_items.map(action => ({ ...action, target_date: "2026-12-01", follow_up_date: "2026-12-01" }));
    expect(gradeRefinement(base, proposed).filter(check => !check.passed).map(check => check.code)).toEqual(["human_records_preserved", "no_unrequested_proposal"]);
  });
  it("catches a target date described as completion, while allowing an explicit unknown", () => {
    const detail = evaluationFamily(aiEvaluationCases.find(item => item.id === "completed-history")!, now);
    for (const text of ["The checklist was completed on October 21, 2026.", "Review the checklist (completed 2026-10-21)."])
      expect(gradeCompletionDate(text, detail).passed).toBe(false);
    expect(gradeCompletionDate("The task is complete; its target was October 21, 2026. No completion date is recorded.", detail).passed).toBe(true);
  });
  it("reports nearest-rank tails and cached token cost, without inventing empty-sample results", () => {
    expect(percentile([], .95)).toBeNull();
    expect(percentile([30, 10, 20, 40], .75)).toBe(30);
    expect(percentile([30, 10, 20, 40], .95)).toBe(40);
    expect(estimatedCost({ input_tokens: 1000, output_tokens: 1000, input_tokens_details: { cached_tokens: 500 } })).toBeCloseTo(.00131);
  });
  it("flags invented absence of outside activity when the case has no history", () => {
    const detail = evaluationFamily(aiEvaluationCases[0], now);
    expect(gradeMissingHistory("No plan is saved, so nothing has been submitted or scheduled.", detail).passed).toBe(false);
    expect(gradeMissingHistory("No referral or submission has occurred.", detail).passed).toBe(false);
    expect(gradeMissingHistory("No referral has been submitted or recorded.", detail).passed).toBe(false);
    expect(gradeMissingHistory("No referral or submission is recorded; confirm whether anything occurred outside CaseLink.", detail).passed).toBe(true);
  });
  it("bounds concurrent paid dispatch and preserves unknown charges after a failed response read", () => {
    const budget = evaluationBudget(.1);
    const settle = budget.reserve("gpt-6-astra", 1000, 1000);
    expect(() => budget.reserve("gpt-6-astra", 1000, 1000)).toThrow("before dispatch");
    settle(null);
    expect(budget.totals).toMatchObject({ requests: 1, reservedUsd: 0, unknownCostRequests: 1 });
    expect(budget.totals.unknownCostReserveUsd).toBeCloseTo(.0881);
    expect(() => budget.reserve("gpt-6-astra", 1000, 1000)).toThrow("before dispatch");
  });
  it("uses actual costs after completion and stops at the request limit or unknown price", () => {
    const budget = evaluationBudget(.1, 2);
    budget.reserve("gpt-6-astra", 1000, 1000)(.001);
    budget.reserve("gpt-6-astra", 1000, 1000)(.002);
    expect(budget.totals.measuredUsd).toBeCloseTo(.003);
    expect(() => budget.reserve("gpt-6-astra", 0, 0)).toThrow("before dispatch");
    expect(() => evaluationBudget(10).reserve("unknown", 0, 0)).toThrow("before dispatch");
  });
});
