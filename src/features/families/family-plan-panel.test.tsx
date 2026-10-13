/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markPlanReviewed, previewRefinePlan, previewRefinePlanStep, savePlanEdits } from "@/app/actions/plans";
import { FamilyPlanPanel } from "@/features/families/family-plan-panel";
import type { PlanWithSteps } from "@/types/family";
import { localActionDraftKey } from "@/lib/domain/plan/local-action-draft";

const routerRefresh = vi.hoisted(() => vi.fn());
const owner = "90000000-0000-4000-8000-000000000001";
vi.mock("@/components/layout/workspace-session-boundary", () => ({ useWorkspaceUserId: () => "90000000-0000-4000-8000-000000000001" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock("@/app/actions/plans", () => ({
  markPlanReviewed: vi.fn(),
  previewRefinePlanStep: vi.fn(),
  previewRefinePlan: vi.fn(),
  createManualStep: vi.fn(),
  deletePlanStep: vi.fn(),
  savePlanEdits: vi.fn(),
}));

vi.mock("@/app/actions/families", () => ({
  recordCaseWorkflowEvent: vi.fn().mockResolvedValue({ ok: true }),
}));

const plan: PlanWithSteps = {
  id: "10000000-0000-4000-8000-000000000001",
  family_id: "20000000-0000-4000-8000-000000000002",
  version: 1,
  review_revision: "a".repeat(64),
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
    localStorage.clear(); sessionStorage.clear();
    routerRefresh.mockReset();
    vi.mocked(markPlanReviewed).mockReset();
    vi.mocked(savePlanEdits).mockReset();
    vi.mocked(previewRefinePlanStep).mockReset();
    vi.mocked(previewRefinePlan).mockReset();
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  });

  it("recovers de-identified edits in the same tab, and removes a recovery copy when identifying text is entered", async () => {
    const key = localActionDraftKey(owner, plan.id);
    const first = render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.change(screen.getByDisplayValue("Call the housing intake line"), { target: { value: "Schedule the intake" } });
    expect(sessionStorage.getItem(key)).toContain("Schedule the intake");
    expect(localStorage.getItem(key)).toBeNull();
    first.unmount();
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Restore edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule the intake" }));
    fireEvent.change(screen.getByDisplayValue("Schedule the intake"), { target: { value: "Email parent@example.test" } });
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(screen.getByText(/This edit cannot be kept for recovery/)).toBeTruthy();
    expect(screen.getByDisplayValue("Email parent@example.test")).toBeTruthy();
  });

  it("keeps edits in memory and warns when quota prevents saving a recovery copy", () => {
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.change(screen.getByDisplayValue("Call the housing intake line"), { target: { value: "Keep this edit" } });
    expect(screen.getByText(/Draft recovery is unavailable/)).toBeTruthy();
    expect(screen.getByDisplayValue("Keep this edit")).toBeTruthy();
  });

  it("saves the parent and its actions together using the draft's original revisions after a refresh", async () => {
    vi.mocked(savePlanEdits).mockRejectedValueOnce(new Error("network interrupted"));
    const view = render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.change(screen.getByDisplayValue("Call the housing intake line"), { target: { value: "Prepare the intake" } });
    fireEvent.change(screen.getByDisplayValue("Call intake"), { target: { value: "Schedule the appointment" } });
    const latest = structuredClone(plan);
    latest.steps[0].updated_at = "2026-08-03T12:05:00Z";
    latest.steps[0].action_items![0].updated_at = "2026-08-03T12:05:00Z";
    view.rerender(<FamilyPlanPanel familyId={plan.family_id} plan={latest} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await screen.findByText("The save could not be confirmed. Your edits are still open; reload the saved plan before retrying.");
    expect(savePlanEdits).toHaveBeenCalledTimes(1);
    expect(savePlanEdits).toHaveBeenCalledWith(expect.objectContaining({ steps: [expect.objectContaining({
      expectedUpdatedAt: plan.steps[0].updated_at, patch: expect.objectContaining({ title: "Prepare the intake" }),
      actionItems: [expect.objectContaining({ expectedUpdatedAt: plan.steps[0].action_items![0].updated_at, patch: expect.objectContaining({ title: "Schedule the appointment" }) })],
    })] }));
    expect(screen.getByDisplayValue("Prepare the intake")).toBeTruthy();
    expect(screen.getByDisplayValue("Schedule the appointment")).toBeTruthy();
  });

  it("submits all changed goals once and keeps the full working copy available after a failed save", async () => {
    const two = structuredClone(plan);
    const second = structuredClone(two.steps[0]);
    second.id = "30000000-0000-4000-8000-000000000005";
    second.action_items![0].id = "40000000-0000-4000-8000-000000000006";
    second.action_items![0].plan_step_id = second.id;
    two.steps.push(second);
    vi.mocked(previewRefinePlan).mockResolvedValue({ ok: true, model: "test-model", steps: two.steps.map((step, i) => ({
      phase: step.phase, title: `Revised goal ${i}`, description: step.description, details: step.details!, action_items: step.action_items!,
    })) });
    vi.mocked(savePlanEdits).mockResolvedValueOnce({ ok: false, error: "Nothing was saved. Try again." }).mockResolvedValueOnce({ ok: true });
    render(<FamilyPlanPanel familyId={two.family_id} plan={two} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Refine plan with AI" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Clarify both goals" } });
    fireEvent.click(dialog.getByRole("button", { name: "Generate preview" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Apply to working copy" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save to plan" }));
    await dialog.findByText("Nothing was saved. Try again.");
    expect(savePlanEdits).toHaveBeenCalledTimes(1);
    const firstRequest = vi.mocked(savePlanEdits).mock.calls[0][0] as { steps: unknown[] };
    expect(firstRequest.steps).toHaveLength(2);
    await waitFor(() => expect((dialog.getByRole("button", { name: "Save to plan" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Save to plan" }));
    await screen.findByText("Plan updates saved.");
    expect(vi.mocked(savePlanEdits).mock.calls[1][0]).toEqual(firstRequest);
  });

  it("settles an unexpectedly rejected action preview and keeps instructions for retry", async () => {
    vi.mocked(previewRefinePlanStep).mockRejectedValue(new Error("private failure"));
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.click(screen.getByRole("button", { name: "Refine action" }));
    const region = within(screen.getByRole("region", { name: "Refine action with AI" }));
    fireEvent.change(region.getByRole("textbox"), { target: { value: "Shorten the description." } });
    fireEvent.click(region.getByRole("button", { name: "Generate preview" }));
    await screen.findByText("The preview could not be prepared. Your edits are unchanged; try again.");
    expect((region.getByRole("button", { name: "Generate preview" }) as HTMLButtonElement).disabled).toBe(false);
    expect((region.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Shorten the description.");
    expect(screen.queryByText("private failure")).toBeNull();
  });

  it("submits the displayed revision and recovers from a failed review", async () => {
    vi.mocked(markPlanReviewed).mockResolvedValueOnce({ ok: false, error: "This plan changed in another tab." });
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark plan reviewed" }));
    await screen.findByText("This plan changed in another tab.");
    await waitFor(() => expect((screen.getByRole("button", { name: "Mark plan reviewed" }) as HTMLButtonElement).disabled).toBe(false));
    expect(markPlanReviewed).toHaveBeenCalledWith({ familyId: plan.family_id, planId: plan.id, expectedRevision: plan.review_revision });
    vi.mocked(markPlanReviewed).mockRejectedValueOnce(new Error("private service error"));
    fireEvent.click(screen.getByRole("button", { name: "Mark plan reviewed" }));
    await screen.findByText("The review could not be saved. Your edits are unchanged; try again.");
    await waitFor(() => expect((screen.getByRole("button", { name: "Mark plan reviewed" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("ignores a cancelled action preview that finishes after reopening", async () => {
    let finish!: (value: Awaited<ReturnType<typeof previewRefinePlanStep>>) => void;
    vi.mocked(previewRefinePlanStep).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.click(screen.getByRole("button", { name: "Refine action" }));
    const region = within(screen.getByRole("region", { name: "Refine action with AI" }));
    fireEvent.change(region.getByRole("textbox"), { target: { value: "Shorten it." } });
    fireEvent.click(region.getByRole("button", { name: "Generate preview" }));
    fireEvent.click(region.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Refine action" }));
    await act(async () => finish({ ok: false, error: "Old request error" }));
    expect(screen.queryByText("Old request error")).toBeNull();
    expect((screen.getByRole("button", { name: "Generate preview" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("settles a rejected full-plan preview", async () => {
    vi.mocked(previewRefinePlan).mockRejectedValueOnce(new Error("private failure"));
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Refine plan with AI" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Shorten the plan." } });
    fireEvent.click(dialog.getByRole("button", { name: "Generate preview" }));
    await screen.findByText("The preview could not be prepared. Your edits are unchanged; try again.");
    expect((dialog.getByRole("button", { name: "Generate preview" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("compares the open draft with the latest saved value before resolving a conflict", async () => {
    vi.mocked(savePlanEdits).mockResolvedValue({
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
    await waitFor(() => expect(savePlanEdits).toHaveBeenCalledTimes(1));
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
