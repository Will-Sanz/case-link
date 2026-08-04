import { describe, expect, it } from "vitest";
import { getPlanReviewStatus, isPlanReviewed } from "@/lib/domain/plan/review-status";
import type { PlanWithSteps } from "@/types/family";

function plan(overrides: Partial<PlanWithSteps> = {}): PlanWithSteps {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    family_id: "00000000-0000-4000-8000-000000000002",
    version: 1,
    summary: null,
    generation_source: "ai",
    ai_model: "gpt-5.6-luna",
    created_at: "2026-08-03T12:00:00.000Z",
    generation_state: null,
    client_display: null,
    presentation: { sourceKind: "ai" },
    steps: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        plan_id: "00000000-0000-4000-8000-000000000001",
        phase: "30",
        title: "Confirm housing options",
        description: "",
        details: { owner: "case_manager", expected_outcome: "Options are confirmed." },
        status: "pending",
        due_date: null,
        assigned_to_id: null,
        sort_order: 0,
        created_at: "2026-08-03T12:00:00.000Z",
        updated_at: "2026-08-03T12:00:00.000Z",
        action_items: [
          {
            id: "00000000-0000-4000-8000-000000000004",
            plan_step_id: "00000000-0000-4000-8000-000000000003",
            title: "Call resource office",
            description: null,
            status: "pending",
            week_index: 1,
            target_date: "2026-08-10",
            sort_order: 0,
            outcome: null,
            notes: null,
            follow_up_date: null,
            created_at: "2026-08-03T12:00:00.000Z",
            updated_at: "2026-08-03T12:00:00.000Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("getPlanReviewStatus", () => {
  it("keeps a complete generated plan in needs-review until explicit approval", () => {
    expect(getPlanReviewStatus(plan()).state).toBe("needs_review");
    expect(isPlanReviewed(plan())).toBe(false);
  });

  it("recognizes explicit case-manager approval", () => {
    const reviewed = plan({
      client_display: {
        reviewedAt: "2026-08-03T13:00:00.000Z",
        reviewedById: "00000000-0000-4000-8000-000000000005",
      },
    });
    expect(getPlanReviewStatus(reviewed).label).toBe("Reviewed");
    expect(isPlanReviewed(reviewed)).toBe(true);
  });

  it("requires an exact date on every open action", () => {
    const missingDate = plan();
    missingDate.steps[0].action_items![0].target_date = null;
    expect(getPlanReviewStatus(missingDate)).toEqual({
      state: "needs_attention",
      label: "Needs attention",
      issue: "Add a target date to every open action before reviewing the plan.",
    });

    missingDate.steps[0].action_items![0].target_date = "2026-02-31";
    expect(getPlanReviewStatus(missingDate).state).toBe("needs_attention");
  });

  it("shows draft and failed generation states plainly", () => {
    expect(
      getPlanReviewStatus(
        plan({
          generation_state: {
            v: 1,
            status: "running",
            pending_phase: "30",
            planning_brief: "",
            phases_complete: { "30": false, "60": false, "90": false },
            models_used: [],
            stage_timings_ms: {},
          },
        }),
      ).label,
    ).toBe("Draft");
    expect(
      getPlanReviewStatus(
        plan({
          generation_state: {
            v: 1,
            status: "failed",
            pending_phase: null,
            planning_brief: "",
            phases_complete: { "30": true, "60": false, "90": false },
            models_used: [],
            stage_timings_ms: {},
            error: "Generation stopped",
          },
        }),
      ).label,
    ).toBe("Needs attention");
  });

  it("requires an expected result and complete waiting details", () => {
    const missingResult = plan();
    missingResult.steps[0].details = { owner: "case_manager" };
    expect(getPlanReviewStatus(missingResult).issue).toBe(
      "Give every action a clear title and expected result before reviewing the plan.",
    );

    const waiting = plan();
    waiting.steps[0].action_items![0].status = "blocked";
    waiting.steps[0].action_items![0].notes = "Awaiting a callback.";
    expect(getPlanReviewStatus(waiting).issue).toBe(
      "Every waiting action needs a reason and next follow-up date.",
    );
    waiting.steps[0].action_items![0].follow_up_date = "2026-08-12";
    expect(getPlanReviewStatus(waiting).state).toBe("needs_review");
  });
});
