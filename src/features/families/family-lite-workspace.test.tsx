/** @vitest-environment jsdom */

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceStagedLeanPlanGeneration } from "@/app/actions/plans";
import { generateBarrierWorkflowForFamilyAction } from "@/app/actions/barrier-workflow";
import { FamilyLiteWorkspace } from "@/features/families/family-lite-workspace";
import { PRESET_BARRIERS } from "@/lib/constants/intake-options";
import { BARRIER_PRESETS } from "@/types/barrier-workflow";

const routerPush = vi.hoisted(() => vi.fn());
const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

vi.mock("@/app/actions/plans", () => ({
  advanceStagedLeanPlanGeneration: vi.fn(),
}));

vi.mock("@/app/actions/barrier-workflow", () => ({
  generateBarrierWorkflowForFamilyAction: vi.fn(),
  loadBarrierWorkflowForFamilyAction: vi.fn().mockResolvedValue({ ok: false, error: "Unavailable" }),
  toggleBarrierWorkflowActionItemAction: vi.fn(),
}));

vi.mock("@/app/actions/resource-matches", () => ({ runResourceMatching: vi.fn() }));
vi.mock("@/features/families/archive-family-from-list-control", () => ({
  ArchiveFamilyFromListControl: () => null,
}));
vi.mock("@/features/families/case-assistant-chat", () => ({ CaseAssistantChat: () => null }));
vi.mock("@/features/families/case-progress-workspace", () => ({
  CaseProgressWorkspace: () => null,
}));
vi.mock("@/features/families/family-plan-panel", () => ({ FamilyPlanPanel: () => null }));

const familyId = "20000000-0000-4000-8000-000000000002";

it("keeps family context after generation failure, restores saved context, and shows it during review", async () => {
  const context = "The family wants a steady school routine. A relative helps with transport. Calls after work; an earlier application is waiting.";
  const initialResult = { familyId, referenceId: "Family 014", selectedBarriers: ["Housing"], additionalBarriers: "", additionalDetails: "", sections: [], resources: [], resourceStatus: "empty" as const, lastSavedAt: null };
  const props = { familyId, familyUpdatedAt: "2026-10-13T12:00:00Z", familyName: "Family 014", barrierOptions: BARRIER_PRESETS, initialResult, plan: null };
  vi.mocked(generateBarrierWorkflowForFamilyAction).mockResolvedValue({ ok: false, error: "Your case details were saved, but the plan could not be prepared." });
  const view = render(<FamilyLiteWorkspace {...props} tab="overview" />);
  const field = screen.getByRole("textbox", { name: /Family priorities and context/ });
  expect(field.hasAttribute("required")).toBe(false);
  expect(field.getAttribute("aria-describedby")).toContain("family-context-prompts");
  fireEvent.change(field, { target: { value: context } });
  fireEvent.click(screen.getByRole("button", { name: "Draft action plan" }));
  await screen.findByRole("alert");
  expect(generateBarrierWorkflowForFamilyAction).toHaveBeenLastCalledWith(familyId, expect.objectContaining({ additionalDetails: context }));
  expect((field as HTMLTextAreaElement).value).toBe(context);
  view.unmount();

  const reloaded = render(<FamilyLiteWorkspace {...props} initialResult={{ ...initialResult, additionalDetails: context }} tab="overview" />);
  expect((screen.getByRole("textbox", { name: /Family priorities and context/ }) as HTMLTextAreaElement).value).toBe(context);
  reloaded.rerender(<FamilyLiteWorkspace {...props} initialResult={{ ...initialResult, additionalDetails: context }} tab="plan" />);
  expect(screen.getByText(context).closest("details")?.hasAttribute("open")).toBe(true);
  expect(screen.getByText(/later context changes do not automatically update a draft/)).toBeTruthy();
});

it("displays and resubmits all intake labels and custom punctuation without changing their meaning", async () => {
  const labels = [...PRESET_BARRIERS.map(p => p.label), "Limited transport, evenings; weekends only"];
  const additionalBarriers = labels.join("\n");
  vi.mocked(generateBarrierWorkflowForFamilyAction).mockResolvedValue({ ok: false, error: "Plan unavailable" });
  render(<FamilyLiteWorkspace familyId={familyId} familyUpdatedAt="2026-10-13T12:00:00Z" familyName="Family 014" barrierOptions={BARRIER_PRESETS} plan={null} tab="overview" initialResult={{ familyId, referenceId: "Family 014", selectedBarriers: [], additionalBarriers, additionalDetails: "", sections: [], resources: [], resourceStatus: "empty", lastSavedAt: null }} />);
  for (const label of labels) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Mental health" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Draft action plan" }));
  await waitFor(() => expect(generateBarrierWorkflowForFamilyAction).toHaveBeenCalledWith(familyId, expect.objectContaining({ selectedBarriers: [], additionalBarriers })));
});

describe("FamilyLiteWorkspace plan generation", () => {
  beforeEach(() => {
    routerPush.mockReset();
    routerRefresh.mockReset();
  });

  it("routes to the plan page when staged generation finishes", async () => {
    vi.mocked(generateBarrierWorkflowForFamilyAction).mockResolvedValue({
      ok: true,
      stagedPolling: true,
      planId: "30000000-0000-4000-8000-000000000003",
      savedContextAt: "2026-08-04T14:00:00.000Z",
      result: {
        referenceId: familyId,
        familyId,
        selectedBarriers: ["Housing"],
        additionalBarriers: "",
        additionalDetails: "",
        sections: [],
        resources: [],
        resourceStatus: "empty",
        lastSavedAt: "2026-08-04T14:00:00.000Z",
      },
    });
    vi.mocked(advanceStagedLeanPlanGeneration).mockResolvedValue({ ok: true, status: "complete", done: true });

    render(
      <FamilyLiteWorkspace
        familyId={familyId}
        familyUpdatedAt="2026-08-04T13:00:00.000Z"
        familyName="Family 014"
        barrierOptions={[{ key: "housing_instability", label: "Housing" }]}
        initialResult={null}
        plan={null}
        tab="overview"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Housing" }));
    fireEvent.click(screen.getByRole("button", { name: "Draft action plan" }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(`/families/${familyId}/plan`);
    });
  });
});

it("retains the draft's revision on refresh and advances it when context saved but AI failed", async () => {
  const firstRevision = "2026-08-04T13:00:00.000Z";
  const savedRevision = "2026-08-04T14:00:00.000Z";
  vi.mocked(generateBarrierWorkflowForFamilyAction).mockResolvedValue({ ok: false, error: "Plan unavailable", savedContextAt: savedRevision });
  const props = { familyId, familyName: "Family 014", barrierOptions: [{ key: "housing_instability", label: "Housing" }], initialResult: null, plan: null, tab: "overview" as const };
  const view = render(<FamilyLiteWorkspace {...props} familyUpdatedAt={firstRevision} />);
  fireEvent.click(screen.getByRole("button", { name: "Housing" }));
  view.rerender(<FamilyLiteWorkspace {...props} familyUpdatedAt="2026-08-04T13:30:00.000Z" />);
  fireEvent.click(screen.getByRole("button", { name: "Draft action plan" }));
  await screen.findByText("Plan unavailable");
  expect(generateBarrierWorkflowForFamilyAction).toHaveBeenLastCalledWith(familyId, expect.objectContaining({ expectedUpdatedAt: firstRevision }));
  fireEvent.click(screen.getByRole("button", { name: "Draft action plan" }));
  await waitFor(() => expect(generateBarrierWorkflowForFamilyAction).toHaveBeenLastCalledWith(familyId, expect.objectContaining({ expectedUpdatedAt: savedRevision })));
});


it("resumes after another tab is busy and offers manual recovery after a terminal failure", async () => {
  vi.useFakeTimers();
  const mockAdvance = vi.mocked(advanceStagedLeanPlanGeneration);
  mockAdvance.mockReset().mockResolvedValueOnce({ ok: true, status: "busy", done: false, retryAfter: 5 })
    .mockResolvedValueOnce({ ok: false, status: "failed", error: "AI limit reached" })
    .mockResolvedValue({ ok: true, status: "complete", done: true });
  const plan: import("@/types/family").PlanWithSteps = { id: "30000000-0000-4000-8000-000000000003", family_id: familyId, steps: [], version: 2, summary: null, generation_source: "openai", ai_model: null, created_at: "2026-10-13T12:00:00Z", presentation: { sourceKind: "ai" }, generation_state: { v: 1, status: "running", pending_phase: "60", models_used: [], stage_timings_ms: {}, phases_complete: { "30": true, "60": false, "90": false } } };
  const view = render(<FamilyLiteWorkspace familyId={familyId} familyUpdatedAt="2026-10-13T12:00:00Z" familyName="Family 014" barrierOptions={[]} initialResult={null} plan={plan} tab="plan" hasPreviousReviewedPlan />);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockAdvance).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "View previous reviewed plan" }).getAttribute("href")).toBe(`/families/${familyId}/plan/previous`);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole("alert").textContent).toContain("AI limit reached");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue draft" })); });
    expect(mockAdvance).toHaveBeenCalledTimes(3);
    expect(mockAdvance).toHaveBeenLastCalledWith(expect.objectContaining({ planId: plan.id }));
  } finally { view.unmount(); vi.useRealTimers(); }
});


it("restarts a cancelled mount safely and stops advancing after leaving the page", async () => {
  vi.useFakeTimers();
  let finish!: (value: Awaited<ReturnType<typeof advanceStagedLeanPlanGeneration>>) => void;
  const advance = vi.mocked(advanceStagedLeanPlanGeneration);
  advance.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true, status: "complete", done: true });
  const plan: import("@/types/family").PlanWithSteps = { id: "30000000-0000-4000-8000-000000000003", family_id: familyId, steps: [], version: 2, summary: null, generation_source: "openai", ai_model: null, created_at: "2026-10-13T12:00:00Z", presentation: { sourceKind: "ai" }, generation_state: { v: 1, status: "running", pending_phase: "30", models_used: [], stage_timings_ms: {}, phases_complete: { "30": false, "60": false, "90": false } } };
  const props = { familyId, familyUpdatedAt: plan.created_at, familyName: "Family 014", barrierOptions: [], initialResult: null, plan, tab: "plan" as const };
  const view = render(<StrictMode><FamilyLiteWorkspace {...props} /></StrictMode>);
  try {
    await act(async () => { finish({ ok: true, status: "busy", done: false, retryAfter: 5 }); await vi.advanceTimersByTimeAsync(0); });
    expect(advance).toHaveBeenCalledTimes(2);
    view.unmount();
    advance.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reopened = render(<FamilyLiteWorkspace {...props} />);
    reopened.unmount();
    await act(async () => { finish({ ok: true, status: "advanced", done: false, phaseCompleted: "30" }); await vi.advanceTimersByTimeAsync(30_000); });
    expect(advance).toHaveBeenCalledTimes(1);
  } finally { view.unmount(); vi.useRealTimers(); }
});
