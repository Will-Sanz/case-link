/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanStepCaseNote } from "@/features/families/plan-step-case-note";
import type { PlanStepRow } from "@/types/family";

const step: PlanStepRow = {
  id: "step-1",
  plan_id: "plan-1",
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
    expected_outcome: "An intake appointment is scheduled.",
    required_documents: ["Proof of address"],
    contacts: [{ notes: "Housing intake: 215-555-0100" }],
  },
  workflow_data: {},
  action_items: [],
};

describe("PlanStepCaseNote AI review", () => {
  it("shows the current and proposed action before applying AI changes", () => {
    render(
      <PlanStepCaseNote
        step={step}
        editing
        onPatchStep={vi.fn()}
        onPatchDetails={vi.fn()}
        onPatchActionItem={vi.fn()}
        onPatchWorkflow={vi.fn()}
        onBeginEdit={vi.fn()}
        onSaveEdits={vi.fn()}
        onCancelEdits={vi.fn()}
        onDeleteStep={vi.fn()}
        stepDirty={false}
        stepSavePending={false}
        refineOpen
        refineInstruction="Make this easier to scan."
        refinePreview={{
          title: "Schedule the housing intake appointment",
          description: "Call the intake line, confirm eligibility, and reserve the earliest opening.",
          details: {
            expected_outcome: "The earliest eligible appointment is on the calendar.",
            required_documents: ["Proof of address", "Photo ID"],
            contacts: [{ notes: "Housing intake: 215-555-0111" }],
          },
          stepPriority: "high",
        }}
        refinePending={false}
        onRefineInstruction={vi.fn()}
        onRefineRun={vi.fn()}
        onRefineApply={vi.fn()}
        onRefineClose={vi.fn()}
        onRefineDiscardPreview={vi.fn()}
        onOpenRefine={vi.fn()}
      />,
    );

    const currentCard = screen.getByText("Current draft").closest("div");
    const proposedCard = screen.getByText("Proposed draft").closest("div");

    expect(currentCard).toBeTruthy();
    expect(proposedCard).toBeTruthy();
    expect(within(currentCard!).getByText("Call the housing intake line")).toBeTruthy();
    expect(
      within(proposedCard!).getByText("Schedule the housing intake appointment"),
    ).toBeTruthy();
    expect(within(currentCard!).getByText(/Proof of address/)).toBeTruthy();
    expect(within(proposedCard!).getByText(/Proof of address.*Photo ID/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeTruthy();
    expect(screen.getByText(/Nothing changes until you apply it/i)).toBeTruthy();
  });
});
