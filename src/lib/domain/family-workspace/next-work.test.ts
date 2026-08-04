import { describe, expect, it } from "vitest";
import { selectNextFamilyWork } from "@/lib/domain/family-workspace/next-work";
import type { PlanStepActionItemRow } from "@/types/family";

function action(
  overrides: Partial<PlanStepActionItemRow>,
): PlanStepActionItemRow {
  return {
    id: "action-1",
    plan_step_id: "step-1",
    title: "Call housing office",
    description: null,
    week_index: 1,
    target_date: "2026-08-05",
    status: "pending",
    sort_order: 0,
    outcome: null,
    notes: null,
    follow_up_date: null,
    created_at: "2026-08-03T12:00:00Z",
    updated_at: "2026-08-03T12:00:00Z",
    ...overrides,
  };
}

function step(overrides: Record<string, unknown> = {}) {
  return {
    id: "step-1",
    title: "Stabilize housing",
    phase: "30",
    status: "pending",
    due_date: "2026-08-31",
    sort_order: 0,
    details: null,
    workflow_data: null,
    action_items: [action({})],
    ...overrides,
  };
}

describe("selectNextFamilyWork", () => {
  it("returns the earliest dated open action across goals", () => {
    const result = selectNextFamilyWork([
      step(),
      step({
        id: "step-2",
        sort_order: 1,
        title: "Restore benefits",
        action_items: [
          action({
            id: "action-2",
            plan_step_id: "step-2",
            title: "Confirm benefit eligibility",
            target_date: "2026-08-04",
          }),
        ],
      }),
    ]);

    expect(result).toMatchObject({
      id: "step-2",
      action_needed_now: "Confirm benefit eligibility",
      due_date: "2026-08-04",
    });
  });

  it("ignores completed actions", () => {
    const result = selectNextFamilyWork([
      step({
        action_items: [
          action({ status: "completed", target_date: "2026-08-01" }),
          action({ id: "action-2", title: "Schedule follow-up", target_date: "2026-08-07" }),
        ],
      }),
    ]);

    expect(result?.action_needed_now).toBe("Schedule follow-up");
  });

  it("falls back to the next open goal when legacy data has no action items", () => {
    const result = selectNextFamilyWork([
      step({
        action_items: [],
        details: { action_needed_now: "Review the family plan" },
      }),
    ]);

    expect(result).toMatchObject({
      action_needed_now: "Review the family plan",
      due_date: "2026-08-31",
    });
  });

  it("returns null when all work is complete", () => {
    expect(
      selectNextFamilyWork([
        step({ status: "completed", action_items: [action({ status: "completed" })] }),
      ]),
    ).toBeNull();
  });
});
