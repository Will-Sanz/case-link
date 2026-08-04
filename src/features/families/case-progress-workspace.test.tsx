/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureCaseProgressUpdate } from "@/app/actions/case-progress";
import { CaseProgressWorkspace } from "@/features/families/case-progress-workspace";
import type { PlanWithSteps } from "@/types/family";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/case-progress", () => ({ captureCaseProgressUpdate: vi.fn() }));

const plan: PlanWithSteps = {
  id: "10000000-0000-4000-8000-000000000001",
  family_id: "20000000-0000-4000-8000-000000000002",
  version: 1,
  summary: null,
  generation_source: "openai",
  ai_model: null,
  created_at: "2026-08-01T12:00:00.000Z",
  presentation: { sourceKind: "ai" },
  steps: [
    {
      id: "30000000-0000-4000-8000-000000000003",
      plan_id: "10000000-0000-4000-8000-000000000001",
      phase: "30",
      title: "Housing intake",
      description: "Prepare the intake.",
      status: "in_progress",
      due_date: null,
      assigned_to_id: null,
      sort_order: 0,
      created_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-01T12:00:00.000Z",
      details: { stage_goal: "Stable housing" },
      action_items: [
        {
          id: "40000000-0000-4000-8000-000000000004",
          plan_step_id: "30000000-0000-4000-8000-000000000003",
          title: "Call housing intake",
          description: null,
          week_index: 1,
          target_date: "2026-08-07",
          status: "pending",
          sort_order: 0,
          outcome: null,
          notes: null,
          follow_up_date: null,
          created_at: "2026-08-01T12:00:00.000Z",
          updated_at: "2026-08-01T12:00:00.000Z",
        },
      ],
    },
  ],
};

describe("CaseProgressWorkspace", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.mocked(captureCaseProgressUpdate).mockReset();
  });

  it("captures a meeting note and a selected plan change in one save", async () => {
    vi.mocked(captureCaseProgressUpdate).mockResolvedValue({
      ok: true,
      updateId: "60000000-0000-4000-8000-000000000006",
    });

    render(
      <CaseProgressWorkspace
        familyId={plan.family_id}
        plan={plan}
        updates={[]}
        earlierNotes={[]}
      />,
    );

    expect(screen.getByText("Call housing intake")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record meeting progress" }));
    fireEvent.change(screen.getByLabelText("What changed since the last meeting?"), {
      target: { value: "The family confirmed the intake can move forward." },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Call housing intake/i }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    fireEvent.change(screen.getByLabelText("Outcome (optional)"), {
      target: { value: "Intake call completed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save progress update" }));

    await waitFor(() => expect(captureCaseProgressUpdate).toHaveBeenCalledTimes(1));
    expect(captureCaseProgressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: plan.family_id,
        planId: plan.id,
        summary: "The family confirmed the intake can move forward.",
        changes: [
          expect.objectContaining({
            actionItemId: plan.steps[0].action_items![0].id,
            status: "completed",
            outcome: "Intake call completed",
          }),
        ],
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });
});
