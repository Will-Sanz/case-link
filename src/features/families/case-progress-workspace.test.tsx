/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("keeps the note after a lost response and retries with the same request id", async () => {
    vi.mocked(captureCaseProgressUpdate).mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({ ok: true, updateId: "60000000-0000-4000-8000-000000000006" });
    render(<CaseProgressWorkspace familyId={plan.family_id} plan={plan} updates={[]} earlierNotes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record meeting progress" }));
    fireEvent.change(screen.getByLabelText("What changed since the last meeting?"), { target: { value: "Discussed next steps" } });
    fireEvent.click(screen.getByRole("button", { name: "Save progress update" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("What changed since the last meeting?") as HTMLTextAreaElement).value).toBe("Discussed next steps");
    fireEvent.click(screen.getByRole("button", { name: "Save progress update" }));
    await screen.findByText("Progress saved to the case history.");
    const calls = vi.mocked(captureCaseProgressUpdate).mock.calls;
    expect(calls[0][0]).toEqual(calls[1][0]);
    expect(calls[0][0]).toMatchObject({ requestId: expect.stringMatching(/^[a-f0-9-]{36}$/), changes: [] });

    fireEvent.click(screen.getByRole("button", { name: "Record meeting progress" }));
    fireEvent.change(screen.getByLabelText("What changed since the last meeting?"), { target: { value: "Discussed next steps" } });
    vi.mocked(captureCaseProgressUpdate).mockResolvedValueOnce({ ok: false, error: "Try again" });
    fireEvent.click(screen.getByRole("button", { name: "Save progress update" }));
    await screen.findByRole("alert");
    expect(calls[2][0]).not.toEqual(calls[0][0]);
  });

  it("preserves the original revision across refreshes and prevents duplicate submissions", async () => {
    let finish!: (value: Awaited<ReturnType<typeof captureCaseProgressUpdate>>) => void;
    vi.mocked(captureCaseProgressUpdate).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const props = { familyId: plan.family_id, plan, updates: [], earlierNotes: [] };
    const view = render(<CaseProgressWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Record meeting progress" }));
    fireEvent.change(screen.getByLabelText("What changed since the last meeting?"), { target: { value: "Discussed next steps" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Call housing intake/i }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    const changed = structuredClone(plan);
    changed.steps[0].action_items![0].updated_at = "2026-08-02T12:00:00.000Z";
    view.rerender(<CaseProgressWorkspace {...props} plan={changed} />);
    const form = screen.getByRole("button", { name: "Save progress update" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(captureCaseProgressUpdate).toHaveBeenCalledTimes(1);
    expect(captureCaseProgressUpdate).toHaveBeenCalledWith(expect.objectContaining({ changes: [expect.objectContaining({ expectedUpdatedAt: "2026-08-01T12:00:00.000Z" })] }));
    expect(screen.getByLabelText("What changed since the last meeting?").closest("fieldset")?.disabled).toBe(true);
    await act(async () => finish({ ok: false, error: "Changed elsewhere", conflict: true }));
    expect(screen.getByRole("alert").textContent).toBe("Changed elsewhere");
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("completed");
  });

  it("uses the waiting follow-up date as its target date and gives edited retries a new request id", async () => {
    vi.mocked(captureCaseProgressUpdate).mockResolvedValue({ ok: false, error: "Try again" });
    render(<CaseProgressWorkspace familyId={plan.family_id} plan={plan} updates={[]} earlierNotes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record meeting progress" }));
    fireEvent.change(screen.getByLabelText("What changed since the last meeting?"), { target: { value: "Waiting for intake" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Call housing intake/i }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "blocked" } });
    fireEvent.change(screen.getByLabelText("Next follow-up date"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Why is this waiting?"), { target: { value: "Awaiting response" } });
    fireEvent.click(screen.getByRole("button", { name: "Save progress update" }));
    await screen.findByRole("alert");
    expect(captureCaseProgressUpdate).toHaveBeenCalledWith(expect.objectContaining({ changes: [expect.objectContaining({ targetDate: "2026-11-01", followUpDate: "2026-11-01" })] }));
    const first = vi.mocked(captureCaseProgressUpdate).mock.calls[0][0];
    fireEvent.change(screen.getByLabelText("What changed since the last meeting?"), { target: { value: "Waiting for the rescheduled intake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save progress update" }));
    await screen.findByRole("alert");
    expect(vi.mocked(captureCaseProgressUpdate).mock.calls[1][0]).not.toMatchObject({ requestId: (first as { requestId: string }).requestId });
  });
});
