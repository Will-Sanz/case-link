import { describe, expect, it } from "vitest";
import { groupPlanStepsByGoal } from "@/lib/domain/plan/group-plan-steps";
import type { PlanStepActionItemRow, PlanStepRow } from "@/types/family";

function action(
  id: string,
  targetDate: string | null,
  status: PlanStepActionItemRow["status"] = "pending",
): PlanStepActionItemRow {
  return {
    id,
    plan_step_id: "step-id",
    title: `Action ${id}`,
    description: null,
    week_index: 1,
    target_date: targetDate,
    status,
    sort_order: 0,
    outcome: null,
    notes: null,
    follow_up_date: null,
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
  };
}

function step(
  id: string,
  goal: string | undefined,
  sortOrder: number,
  actions: PlanStepActionItemRow[],
): PlanStepRow {
  return {
    id,
    plan_id: "plan-id",
    phase: "30",
    title: `Step ${id}`,
    description: "",
    status: "pending",
    priority: "medium",
    due_date: null,
    assigned_to_id: null,
    sort_order: sortOrder,
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    details: goal ? { stage_goal: goal } : {},
    workflow_data: {},
    action_items: actions,
  };
}

describe("groupPlanStepsByGoal", () => {
  it("groups steps by their case-manager goal instead of storage phase", () => {
    const groups = groupPlanStepsByGoal([
      step("a", "Stabilize housing", 0, [action("a1", "2026-08-06")]),
      { ...step("b", "  Stabilize   housing ", 1, [action("b1", "2026-08-12")]), phase: "90" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Stabilize housing");
    expect(groups[0].steps.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("orders goals and their steps by the earliest open target date", () => {
    const groups = groupPlanStepsByGoal([
      step("later", "Long-term stability", 0, [action("later-1", "2026-09-20")]),
      step("soon-b", "Immediate safety", 2, [action("soon-b-1", "2026-08-09")]),
      step("soon-a", "Immediate safety", 1, [action("soon-a-1", "2026-08-05")]),
    ]);

    expect(groups.map((group) => group.title)).toEqual([
      "Immediate safety",
      "Long-term stability",
    ]);
    expect(groups[0].steps.map((item) => item.id)).toEqual(["soon-a", "soon-b"]);
  });

  it("reports completion and ignores completed dates when finding the next open action", () => {
    const [group] = groupPlanStepsByGoal([
      step("a", "Employment", 0, [
        action("done", "2026-08-04", "completed"),
        action("open", "2026-08-11"),
      ]),
    ]);

    expect(group.actionCount).toBe(2);
    expect(group.completedActionCount).toBe(1);
    expect(group.earliestOpenTargetDate).toBe("2026-08-11");
  });

  it("falls back to the step title for legacy plans without a goal", () => {
    const [group] = groupPlanStepsByGoal([step("legacy", undefined, 0, [])]);
    expect(group.title).toBe("Step legacy");
  });
});
