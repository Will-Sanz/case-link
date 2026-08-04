/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updatePlanStep } from "@/app/actions/plans";
import { FamilyPlanPanel } from "@/features/families/family-plan-panel";
import type { PlanWithSteps } from "@/types/family";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock("@/app/actions/plans", () => ({
  markPlanReviewed: vi.fn(),
  previewRefinePlanStep: vi.fn(),
  previewRefinePlan: vi.fn(),
  createManualStep: vi.fn(),
  deletePlanStep: vi.fn(),
  updatePlanStep: vi.fn(),
  updatePlanStepActionItem: vi.fn(),
}));

vi.mock("@/app/actions/families", () => ({
  recordCaseWorkflowEvent: vi.fn().mockResolvedValue({ ok: true }),
}));

const plan: PlanWithSteps = {
  id: "10000000-0000-4000-8000-000000000001",
  family_id: "20000000-0000-4000-8000-000000000002",
  version: 1,
  summary: null,
  generation_source: "openai",
  ai_model: "gpt-5.6-luna",
  created_at: "2026-08-03T12:00:00.000Z",
  generation_state: {
    v: 1,
    status: "complete",
    pending_phase: null,
    planning_brief: "Housing support",
    phases_complete: { "30": true, "60": true, "90": true },
    models_used: ["gpt-5.6-luna"],
    stage_timings_ms: { "30": 900 },
  },
  presentation: { sourceKind: "ai" },
  steps: [
    {
      id: "30000000-0000-4000-8000-000000000003",
      plan_id: "10000000-0000-4000-8000-000000000001",
      phase: "30",
      title: "Call the housing intake line",
      description: "Confirm eligibility and ask for the next available appointment.",
      status: "pending",
      priority: "high",
      due_date: "2026-08-07",
      assigned_to_id: null,
      sort_order: 0,
      created_at: "2026-08-03T12:00:00.000Z",
      updated_at: "2026-08-03T12:00:00.000Z",
      details: {
        owner: "case_manager",
        stage_goal: "Secure stable housing",
        expected_outcome: "An intake appointment is scheduled.",
      },
      workflow_data: {},
      action_items: [
        {
          id: "40000000-0000-4000-8000-000000000004",
          plan_step_id: "30000000-0000-4000-8000-000000000003",
          title: "Call intake",
          description: null,
          week_index: 1,
          target_date: "2026-08-07",
          status: "pending",
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
};

describe("FamilyPlanPanel stale edit recovery", () => {
  beforeEach(() => {
    routerRefresh.mockReset();
    vi.mocked(updatePlanStep).mockReset();
  });

  it("compares the open draft with the latest saved value before resolving a conflict", async () => {
    vi.mocked(updatePlanStep).mockResolvedValue({
      ok: false,
      error: "This action changed in another tab.",
      conflict: {
        kind: "step",
        entityId: plan.steps[0].id,
        currentUpdatedAt: "2026-08-03T12:05:00.000Z",
        current: {
          title: "Call housing intake and confirm eligibility",
          description: plan.steps[0].description,
          status: "pending",
          phase: "30",
          priority: "high",
          details: plan.steps[0].details ?? null,
          workflow_data: {},
        },
      },
    });

    render(
      <FamilyPlanPanel
        familyId={plan.family_id}
        familyName="Family 014"
        plan={plan}
        workflow={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.change(screen.getByDisplayValue("Call the housing intake line"), {
      target: { value: "Schedule the housing intake appointment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edits" }));

    const conflictHeading = await screen.findByRole("heading", {
      name: "Another tab saved this action",
    });
    const conflictPanel = conflictHeading.closest("section");
    expect(conflictPanel).toBeTruthy();
    expect(
      within(conflictPanel!).getByText("Schedule the housing intake appointment"),
    ).toBeTruthy();
    expect(
      within(conflictPanel!).getByText("Call housing intake and confirm eligibility"),
    ).toBeTruthy();
    expect(within(conflictPanel!).getByRole("button", { name: "Keep my draft" })).toBeTruthy();
    expect(
      within(conflictPanel!).getByRole("button", { name: "Use latest version" }),
    ).toBeTruthy();
    await waitFor(() => expect(updatePlanStep).toHaveBeenCalledTimes(1));
  });

  it("keeps the plan usable when browser draft storage is restricted", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    try {
      expect(() =>
        render(
          <FamilyPlanPanel
            familyId={plan.family_id}
            familyName="Family 014"
            plan={plan}
            workflow={null}
          />,
        ),
      ).not.toThrow();
      expect(screen.getByRole("button", { name: "Edit action" })).toBeTruthy();
    } finally {
      getItem.mockRestore();
      removeItem.mockRestore();
    }
  });
});
