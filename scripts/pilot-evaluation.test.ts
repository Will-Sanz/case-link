import { describe, expect, it } from "vitest";
import { evaluationFamily } from "../tests/fixtures/ai-evaluation-cases";
import { applyPilotCaseFacts, gradePilotPlan, pilotEvaluationCases, pilotReviewCriteria } from "../tests/ai/pilot-cases";
import type { LeanPlanPhaseStep } from "../src/lib/plan-generator/lean-plan-schema";

const now = new Date("2026-10-15T16:00:00Z");
const steps = (titles: string[], date: string) => [{ action_items: titles.map(title => ({ title, target_date: date })) }] as LeanPlanPhaseStep[];
describe("pilot evaluation gates", () => {
  it("freezes distinct cases with a semantic rubric and current factual overrides", () => {
    expect(new Set(pilotEvaluationCases.map(item => item.id)).size).toBe(10);
    for (const scenario of pilotEvaluationCases) {
      expect(pilotReviewCriteria[scenario.id].length).toBeGreaterThan(0);
      const detail = evaluationFamily(scenario, now);
      applyPilotCaseFacts(detail, scenario.id, now);
      if (scenario.id === "pilot-newer-choice") expect(detail.progressUpdates[0].summary).toContain("no telephone calls");
      if (scenario.id === "pilot-service-mismatch") expect(detail.resourceMatches[0].resource?.description).toContain("does not provide childcare");
    }
  });
  it("rejects repeated work, sparse filler and future-only urgent plans", () => {
    expect(gradePilotPlan("pilot-minimal-intake", steps(["Ask", "Ask", "Review"], "2026-10-16"), now).every(check => check.passed)).toBe(false);
    expect(gradePilotPlan("pilot-immediate-safety", steps(["Human assessment"], "2026-10-16"), now).find(check => check.code === "pilot_urgent_action_today")?.passed).toBe(false);
    expect(gradePilotPlan("pilot-immediate-safety", steps(["Human assessment"], "2026-10-15"), now).every(check => check.passed)).toBe(true);
  });
});
