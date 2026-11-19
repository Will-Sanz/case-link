/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanStepCaseNote } from "@/features/families/plan-step-case-note";
import { collectRefinementChanges, toRefinementDraft } from "@/lib/domain/plan/refinement-review";
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
  it("names every inline editor and the case-record fields", () => {
    render(<PlanStepCaseNote step={step} editing onPatchStep={vi.fn()} onPatchDetails={vi.fn()} onPatchActionItem={vi.fn()} onPatchWorkflow={vi.fn()} refineOpen={false} refineInstruction="" refineChanges={null} refineSelected={[]} onRefineSelect={vi.fn()} refinePending={false} onRefineInstruction={vi.fn()} onRefineRun={vi.fn()} onRefineApply={vi.fn()} onRefineClose={vi.fn()} onRefineDiscardPreview={vi.fn()} onOpenRefine={vi.fn()} />);
    for (const [button, name] of [
      [/^Call the housing intake line$/, "Title"],
      [/^Confirm eligibility/, "Summary"],
      [/^The client will need Proof of address/, "Documents"],
      [/^Expected outcome:/, "Expected outcome"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: button }));
      const field = screen.getByRole("textbox", { name });
      expect(document.activeElement).toBe(field);
      fireEvent.blur(field);
    }
    expect(screen.getByRole("textbox", { name: "Case record notes" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Blocker explanation" })).toBeTruthy();
  });

  it("requires selecting the individual proposed changes before applying", () => {
    const selected = vi.fn();
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
        refineChanges={collectRefinementChanges([step], [{ ...toRefinementDraft(step), title: "Schedule the housing intake appointment" }])}
        refineSelected={[]}
        onRefineSelect={selected}
        refinePending={false}
        onRefineInstruction={vi.fn()}
        onRefineRun={vi.fn()}
        onRefineApply={vi.fn()}
        onRefineClose={vi.fn()}
        onRefineDiscardPreview={vi.fn()}
        onOpenRefine={vi.fn()}
      />,
    );

    const review = within(screen.getByRole("region", { name: "Refine action with AI" }));
    expect(review.getByText("Call the housing intake line")).toBeTruthy();
    expect(review.getByText("Schedule the housing intake appointment")).toBeTruthy();
    expect((review.getByRole("button", { name: "Apply to draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(review.getByRole("checkbox", { name: /Title/ }));
    expect(selected).toHaveBeenCalledWith("step-1:title", true);
  });
});
