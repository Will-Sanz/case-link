import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPriorPhasesSummaryForPlanner, formatPriorPhasesSummary } from "./prior-phase-summary";

const action = { plan_step_id: "step", title: "Meet at school", status: "pending" as const, target_date: null, follow_up_date: null };

it("preserves the existing goal wording alongside bounded prior work", () => {
  const step = { id: "step", phase: "30", title: "Confirm the next step", description: "Discuss preferences", details: { stage_goal: "Maintain the school routine" } };
  expect(formatPriorPhasesSummary([step], [action])).toBe("- [30-day] Confirm the next step, Discuss preferences | Actions: Meet at school | Goal: Maintain the school routine");
  const large = formatPriorPhasesSummary(Array.from({ length: 30 }, (_, i) => ({ ...step, id: String(i), title: "x".repeat(300) })), []);
  expect(large).toContain("… (truncated)");
  expect(large.length).toBeLessThan(2000);
});

it("loads exact prior action dates and Waiting follow-ups, retaining dates for long action titles", async () => {
  const steps = [{ id: "step", phase: "30", title: "Follow the agreed plan", description: null }];
  const items = [
    { ...action, title: "x".repeat(300), target_date: "2026-11-05" },
    { ...action, status: "blocked", target_date: "2026-10-20", follow_up_date: "2026-11-12" },
    { ...action, status: "blocked", target_date: "2026-11-19" },
  ];
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValueOnce({ data: steps }).mockResolvedValueOnce({ data: items }) };
  const client = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient;
  const summary = await fetchPriorPhasesSummaryForPlanner(client, "plan", ["30"]);
  expect(query.select).toHaveBeenCalledWith("plan_step_id, title, status, target_date, follow_up_date, sort_order");
  expect(summary).toContain("(target 2026-11-05)");
  expect(summary).toContain("(follow-up 2026-11-12)");
  expect(summary).toContain("(follow-up 2026-11-19)");
  expect(summary).not.toContain("2026-10-20");
  expect(summary.length).toBeLessThan(400);
});
