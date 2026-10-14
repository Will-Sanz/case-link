/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markPlanReviewed, previewRefinePlan, previewRefinePlanStep, savePlanEdits } from "@/app/actions/plans";
import { FamilyPlanPanel } from "@/features/families/family-plan-panel";
import type { PlanWithSteps } from "@/types/family";
import { localActionDraftKey } from "@/lib/domain/plan/local-action-draft";
import { toRefinementDraft } from "@/lib/domain/plan/refinement-review";

const routerRefresh = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const owner = "90000000-0000-4000-8000-000000000001";
vi.mock("@/components/layout/workspace-session-boundary", () => ({ useWorkspaceUserId: () => "90000000-0000-4000-8000-000000000001" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: routerPush }),
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
  it("opens the saved-plan assistant and prevents leaving unsaved action edits", () => {
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    const ask = screen.getByRole("button", { name: "Ask about this plan" }) as HTMLButtonElement;
    fireEvent.click(ask);
    expect(routerPush).toHaveBeenCalledWith(`/families/${plan.family_id}/assistant`);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.change(screen.getByLabelText("Action 1"), { target: { value: "Clarify the next agreed task" } });
    expect(ask.disabled).toBe(true);
  });
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

  it("keeps one real action and saves an explicit contact/document removal", async () => {
    const original = structuredClone(plan);
    original.steps[0].details!.contacts = [{ name: "Outdated desk" }];
    original.steps[0].details!.required_documents = ["Unneeded document"];
    const step = original.steps[0];
    vi.mocked(previewRefinePlan).mockResolvedValue({ ok: true, model: "test", steps: [{
      id: step.id, updated_at: step.updated_at, status: step.status, phase: step.phase, title: step.title, description: step.description,
      details: { ...step.details, contacts: [], required_documents: [] }, action_items: step.action_items!,
    }] });
    vi.mocked(savePlanEdits).mockResolvedValue({ ok: true });
    render(<FamilyPlanPanel familyId={original.family_id} plan={original} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Refine plan with AI" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Remove the outdated contact and unneeded document" } });
    fireEvent.click(dialog.getByRole("button", { name: "Generate preview" }));
    await screen.findByRole("button", { name: "Apply to working copy" });
    for (const choice of dialog.getAllByRole("checkbox")) fireEvent.click(choice);
    fireEvent.click(screen.getByRole("button", { name: "Apply to working copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Save to plan" }));
    await waitFor(() => expect(savePlanEdits).toHaveBeenCalledTimes(1));
    expect(previewRefinePlan).toHaveBeenCalledWith(expect.objectContaining({ draft: { steps: [expect.objectContaining({ action_items: [expect.objectContaining({ title: "Call intake" })] })] } }));
    expect(savePlanEdits).toHaveBeenCalledWith(expect.objectContaining({ steps: [expect.objectContaining({ patch: expect.objectContaining({ details: expect.objectContaining({ contacts: [], required_documents: [] }) }), actionItems: [] })] }));
  });

  it("submits all changed goals once and keeps the full working copy available after a failed save", async () => {
    const two = structuredClone(plan);
    const second = structuredClone(two.steps[0]);
    second.id = "30000000-0000-4000-8000-000000000005";
    second.action_items![0].id = "40000000-0000-4000-8000-000000000006";
    second.action_items![0].plan_step_id = second.id;
    two.steps.push(second);
    vi.mocked(previewRefinePlan).mockResolvedValue({ ok: true, model: "test-model", steps: two.steps.map((step, i) => ({
      id: step.id, updated_at: step.updated_at, status: step.status, phase: step.phase, title: `Revised goal ${i}`, description: step.description, details: step.details!, action_items: step.action_items!,
    })) });
    vi.mocked(savePlanEdits).mockResolvedValueOnce({ ok: false, error: "Nothing was saved. Try again." }).mockResolvedValueOnce({ ok: true });
    render(<FamilyPlanPanel familyId={two.family_id} plan={two} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Refine plan with AI" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Clarify both goals" } });
    fireEvent.click(dialog.getByRole("button", { name: "Generate preview" }));
    await dialog.findByRole("button", { name: "Apply to working copy" });
    for (const choice of dialog.getAllByRole("checkbox")) fireEvent.click(choice);
    const cleanExit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanExit);
    expect(cleanExit.defaultPrevented).toBe(false);
    fireEvent.click(dialog.getByRole("button", { name: "Apply to working copy" }));
    expect(document.activeElement).toBe(dialog.getByRole("textbox"));
    const dirtyExit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyExit);
    expect(dirtyExit.defaultPrevented).toBe(true);
    fireEvent.click(dialog.getByRole("button", { name: "Save to plan" }));
    await dialog.findByText("Nothing was saved. Try again.");
    expect(savePlanEdits).toHaveBeenCalledTimes(1);
    const firstRequest = vi.mocked(savePlanEdits).mock.calls[0][0] as { steps: unknown[] };
    expect(firstRequest.steps).toHaveLength(2);
    await waitFor(() => expect((dialog.getByRole("button", { name: "Save to plan" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Save to plan" }));
    await screen.findByText("Plan updates saved.");
    const savedExit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(savedExit);
    expect(savedExit.defaultPrevented).toBe(false);
    expect(vi.mocked(savePlanEdits).mock.calls[1][0]).toEqual(firstRequest);
  });

  it("applies reordered AI suggestions to their original records without moving completed work", async () => {
    const original = structuredClone(plan);
    const first = original.steps[0];
    first.details!.owner = "family";
    first.details!.checklist = ["Materials gathered"];
    first.workflow_data = { checklist_completed: [true], outcome_notes: "Agreed at the meeting" };
    first.action_items![0].status = "completed";
    first.action_items![0].outcome = "Intake booked";
    first.action_items!.push({ ...first.action_items![0], id: "40000000-0000-4000-8000-000000000007", title: "Confirm transport", status: "pending", outcome: null });
    const second = structuredClone(first);
    second.id = "30000000-0000-4000-8000-000000000005";
    second.action_items = [{ ...second.action_items![1], id: "40000000-0000-4000-8000-000000000006", plan_step_id: second.id }];
    original.steps.push(second);
    vi.mocked(previewRefinePlan).mockResolvedValue({ ok: true, model: "test", steps: [...original.steps].reverse().map(step => ({
      ...step, title: `${step.title} clarified`, details: { ...step.details!, owner: "school_program" },
      workflow_data: { checklist_completed: [false] },
      action_items: [...step.action_items!].reverse().map(action => ({ ...action, title: `${action.title} clarified`, status: "blocked", notes: "Model replacement", outcome: "Model outcome" })),
    })) });
    vi.mocked(savePlanEdits).mockResolvedValue({ ok: true });
    render(<FamilyPlanPanel familyId={original.family_id} plan={original} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Refine plan with AI" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Clarify only the wording" } });
    fireEvent.click(dialog.getByRole("button", { name: "Generate preview" }));
    await dialog.findByRole("button", { name: "Apply to working copy" });
    for (const choice of dialog.getAllByRole("checkbox")) fireEvent.click(choice);
    fireEvent.click(dialog.getByRole("button", { name: "Apply to working copy" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save to plan" }));
    await waitFor(() => expect(savePlanEdits).toHaveBeenCalledTimes(1));
    expect(savePlanEdits).toHaveBeenCalledWith(expect.objectContaining({ steps: original.steps.map(step => expect.objectContaining({
      stepId: step.id,
      patch: expect.objectContaining({ details: expect.objectContaining({ owner: "family" }), workflow_data: step.workflow_data }),
      actionItems: step.action_items!.filter(action => action.status !== "completed").map(action => expect.objectContaining({ actionItemId: action.id,
        patch: expect.objectContaining({ title: `${action.title} clarified`, status: action.status, outcome: action.outcome, notes: action.notes }),
      })),
    })) }));
  });

  it("refuses a preview with a foreign task ID without changing the working copy", async () => {
    const step = plan.steps[0];
    vi.mocked(previewRefinePlan).mockResolvedValue({ ok: true, model: "test", steps: [{ ...step, details: step.details!,
      action_items: [{ ...step.action_items![0], id: "90000000-0000-4000-8000-000000000009", title: "Foreign task" }],
    }] });
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Refine plan with AI" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Clarify wording" } });
    fireEvent.click(dialog.getByRole("button", { name: "Generate preview" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("preview could not be prepared");
    expect(dialog.queryByRole("button", { name: "Save to plan" })).toBeNull();
    expect(savePlanEdits).not.toHaveBeenCalled();
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

  it("refines the unsaved draft and applies only a selected sentence change, preserving progress and dates", async () => {
    const original = structuredClone(plan);
    original.steps[0].details = { ...original.steps[0].details, owner: "family", required_documents: ["Agreed document"], checklist: ["", "Completed requirement"] };
    original.steps[0].workflow_data = { checklist_completed: [false, true], outcome_notes: "Agreed follow-up" };
    vi.mocked(previewRefinePlanStep).mockImplementation(async input => {
      const draft = (input as { draft: ReturnType<typeof toRefinementDraft> }).draft;
      return { ok: true, step: { ...draft, title: "Unrequested title change", description: "Shortened summary",
        details: { ...draft.details, owner: "school_program", required_documents: ["Unrequested document"], checklist: ["New checklist"] },
        action_items: draft.action_items.map(action => ({ ...action, target_date: "2026-12-01" })),
      } };
    });
    vi.mocked(savePlanEdits).mockResolvedValue({ ok: true });
    render(<FamilyPlanPanel familyId={original.family_id} plan={original} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.change(screen.getByDisplayValue("Call the housing intake line"), { target: { value: "My unsaved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Refine action" }));
    const region = within(screen.getByRole("region", { name: "Refine action with AI" }));
    fireEvent.change(region.getByRole("textbox"), { target: { value: "Shorten only the summary" } });
    fireEvent.click(region.getByRole("button", { name: "Generate preview" }));
    const apply = await region.findByRole("button", { name: "Apply to draft" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(previewRefinePlanStep).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ title: "My unsaved title", updated_at: original.steps[0].updated_at }) }));
    fireEvent.click(region.getByRole("checkbox", { name: /— Summary$/ }));
    fireEvent.click(apply);
    fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await waitFor(() => expect(savePlanEdits).toHaveBeenCalledTimes(1));
    expect(savePlanEdits).toHaveBeenCalledWith(expect.objectContaining({ steps: [expect.objectContaining({
      patch: expect.objectContaining({ title: "My unsaved title", description: "Shortened summary",
        details: expect.objectContaining({ owner: "family", required_documents: ["Agreed document"], checklist: ["", "Completed requirement"] }),
        workflow_data: { checklist_completed: [false, true], outcome_notes: "Agreed follow-up" },
      }), actionItems: [],
    })] }));
  });

  it.each(["pending", "blocked"] as const)("previews, approves, saves, and reloads the actual %s task wording and date", async status => {
    const original = structuredClone(plan);
    const action = original.steps[0].action_items![0];
    Object.assign(action, { status, notes: status === "blocked" ? "Waiting for a callback" : null, follow_up_date: status === "blocked" ? "2026-10-15" : null });
    vi.mocked(previewRefinePlanStep).mockImplementation(async input => {
      const draft = (input as { draft: ReturnType<typeof toRefinementDraft> }).draft;
      return { ok: true, step: { ...draft, action_items: draft.action_items.map(item => ({ ...item,
        title: "Follow up with intake", description: "Ask whether an appointment is available.", target_date: "2026-10-20",
        follow_up_date: status === "blocked" ? "2026-10-20" : item.follow_up_date,
      })) } };
    });
    vi.mocked(savePlanEdits).mockResolvedValue({ ok: true });
    const view = render(<FamilyPlanPanel familyId={original.family_id} plan={original} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.click(screen.getByRole("button", { name: "Refine action" }));
    const region = within(screen.getByRole("region", { name: "Refine action with AI" }));
    fireEvent.change(region.getByRole("textbox"), { target: { value: "Move the call to October 20 and clarify the task wording" } });
    fireEvent.click(region.getByRole("button", { name: "Generate preview" }));
    const apply = await region.findByRole("button", { name: "Apply to draft" });
    expect(savePlanEdits).not.toHaveBeenCalled();
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    for (const choice of region.getAllByRole("checkbox")) fireEvent.click(choice);
    fireEvent.click(apply);
    expect(savePlanEdits).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await screen.findByText("Action saved.");
    const save = vi.mocked(savePlanEdits).mock.calls[0][0] as { steps: { actionItems: { actionItemId: string; patch: Partial<typeof action> }[] }[] };
    expect(save.steps[0].actionItems).toHaveLength(1);
    const change = save.steps[0].actionItems[0];
    expect(change.actionItemId).toBe(action.id);
    expect(change.patch).toMatchObject({ title: "Follow up with intake", description: "Ask whether an appointment is available.", target_date: "2026-10-20", status });
    if (status === "blocked") expect(change.patch.follow_up_date).toBe("2026-10-20");
    Object.assign(action, change.patch);
    view.unmount();
    render(<FamilyPlanPanel familyId={original.family_id} plan={original} workflow={null} />);
    expect(screen.getByText("Follow up with intake")).toBeTruthy();
    expect(screen.getByText(`${status === "blocked" ? "Follow up" : "Target"} Oct 20, 2026`)).toBeTruthy();
  });

  it.each(["pending", "ready"])("invalidates a %s preview when the human edits the draft", async state => {
    let finish!: (value: Awaited<ReturnType<typeof previewRefinePlanStep>>) => void;
    vi.mocked(previewRefinePlanStep).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.click(screen.getByRole("button", { name: "Refine action" }));
    const region = within(screen.getByRole("region", { name: "Refine action with AI" }));
    fireEvent.change(region.getByRole("textbox"), { target: { value: "Shorten the title" } });
    fireEvent.click(region.getByRole("button", { name: "Generate preview" }));
    const response = { ok: true as const, step: { ...toRefinementDraft(plan.steps[0]), title: "Older suggestion" } };
    if (state === "ready") await act(async () => finish(response));
    fireEvent.change(screen.getByDisplayValue("Call the housing intake line"), { target: { value: "New manual wording" } });
    if (state === "pending") await act(async () => finish(response));
    expect(region.queryByRole("button", { name: "Apply to draft" })).toBeNull();
    expect(screen.getByDisplayValue("New manual wording")).toBeTruthy();
    expect((region.getByRole("button", { name: "Generate preview" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects a late preview when a new saved plan revision arrives", async () => {
    let finish!: (value: Awaited<ReturnType<typeof previewRefinePlanStep>>) => void;
    vi.mocked(previewRefinePlanStep).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    fireEvent.click(screen.getByRole("button", { name: "Refine action" }));
    const region = within(screen.getByRole("region", { name: "Refine action with AI" }));
    fireEvent.change(region.getByRole("textbox"), { target: { value: "Clarify the title" } });
    fireEvent.click(region.getByRole("button", { name: "Generate preview" }));
    view.rerender(<FamilyPlanPanel familyId={plan.family_id} plan={{ ...plan, review_revision: "b".repeat(64) }} workflow={null} />);
    await act(async () => finish({ ok: true, step: { ...toRefinementDraft(plan.steps[0]), title: "Stale suggestion" } }));
    expect(screen.getByText(/The saved plan changed. Your draft is still here/)).toBeTruthy();
    expect(region.queryByRole("button", { name: "Apply to draft" })).toBeNull();
  });

  it("shows one Waiting follow-up date and saves it consistently, including a manual leap-day choice", async () => {
    const waiting = structuredClone(plan);
    Object.assign(waiting.steps[0].action_items![0], { status: "blocked", target_date: "2020-01-01", follow_up_date: "2026-11-02", notes: "Awaiting callback" });
    vi.mocked(savePlanEdits).mockResolvedValue({ ok: true });
    render(<FamilyPlanPanel familyId={waiting.family_id} plan={waiting} workflow={null} />);
    expect(screen.getByText("Follow up Nov 2, 2026")).toBeTruthy();
    expect(screen.queryByText("Target Jan 1, 2020")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    fireEvent.click(screen.getByRole("button", { name: "Call the housing intake line" }));
    const input = screen.getByLabelText("Next follow-up date");
    expect((input as HTMLInputElement).value).toBe("2026-11-02");
    expect(screen.queryByDisplayValue("2020-01-01")).toBeNull();
    fireEvent.change(input, { target: { value: "2028-02-29" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await screen.findByText("Action saved.");
    expect(savePlanEdits).toHaveBeenCalledWith(expect.objectContaining({ steps: [expect.objectContaining({ actionItems: [expect.objectContaining({ patch: expect.objectContaining({ target_date: "2028-02-29", follow_up_date: "2028-02-29" }) })] })] }));
  });

  it("requires date confirmation before approving and allows cancellation", () => {
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark plan reviewed" }));
    expect(markPlanReviewed).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("AI dates are proposals");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(markPlanReviewed).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("submits the displayed revision and recovers from a failed review", async () => {
    vi.mocked(markPlanReviewed).mockResolvedValueOnce({ ok: false, error: "This plan changed in another tab." });
    render(<FamilyPlanPanel familyId={plan.family_id} plan={plan} workflow={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark plan reviewed" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("earlier dates are intentional");
    fireEvent.click(screen.getByRole("button", { name: "Confirm dates and mark reviewed" }));
    await screen.findByText("This plan changed in another tab.");
    await waitFor(() => expect((screen.getByRole("button", { name: "Mark plan reviewed" }) as HTMLButtonElement).disabled).toBe(false));
    expect(markPlanReviewed).toHaveBeenCalledWith({ familyId: plan.family_id, planId: plan.id, expectedRevision: plan.review_revision, datesConfirmed: true });
    vi.mocked(markPlanReviewed).mockRejectedValueOnce(new Error("private service error"));
    fireEvent.click(screen.getByRole("button", { name: "Mark plan reviewed" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("earlier dates are intentional");
    fireEvent.click(screen.getByRole("button", { name: "Confirm dates and mark reviewed" }));
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
          details: { ...plan.steps[0].details, timing_guidance: "Keep the school deadline", checklist: ["Confirm consent"], materials_needed: ["School form"] },
          workflow_data: { checklist_completed: [true], documents_received: true },
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
    for (const text of ["Timing guidance", "Keep the school deadline", "1. Confirm consent", "1. School form", "Checklist completion", "1. Completed", "Documents received"]) {
      expect(within(conflictPanel!).getByText(text)).toBeTruthy();
    }
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
