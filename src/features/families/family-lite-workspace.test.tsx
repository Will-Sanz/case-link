/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceStagedLeanPlanGeneration } from "@/app/actions/plans";
import { generateBarrierWorkflowForFamilyAction } from "@/app/actions/barrier-workflow";
import { FamilyLiteWorkspace } from "@/features/families/family-lite-workspace";

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

describe("FamilyLiteWorkspace plan generation", () => {
  beforeEach(() => {
    routerPush.mockReset();
    routerRefresh.mockReset();
  });

  it("routes to the plan page when staged generation finishes", async () => {
    vi.mocked(generateBarrierWorkflowForFamilyAction).mockResolvedValue({
      ok: true,
      stagedPolling: true,
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
    vi.mocked(advanceStagedLeanPlanGeneration).mockResolvedValue({ ok: true, done: true });

    render(
      <FamilyLiteWorkspace
        familyId={familyId}
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
