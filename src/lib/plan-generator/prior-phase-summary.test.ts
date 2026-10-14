import { expect, it } from "vitest";
import { formatPriorPhasesSummary } from "./prior-phase-summary";

it("preserves the existing goal wording alongside bounded prior work", () => {
  const step = { id: "step", phase: "30", title: "Confirm the next step", description: "Discuss preferences", details: { stage_goal: "Maintain the school routine" } };
  expect(formatPriorPhasesSummary([step], [{ plan_step_id: "step", title: "Meet at school" }])).toBe("- [30-day] Confirm the next step, Discuss preferences | Actions: Meet at school | Goal: Maintain the school routine");
  const large = formatPriorPhasesSummary(Array.from({ length: 30 }, (_, i) => ({ ...step, id: String(i), title: "x".repeat(300) })), []);
  expect(large).toContain("… (truncated)");
  expect(large.length).toBeLessThan(2000);
});
