import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./overview/page";
import PlanPage from "./plan/page";

const mocks = vi.hoisted(() => ({ session: vi.fn(), detail: vi.fn(), rpc: vi.fn(), reloadWorkflow: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: mocks.detail }));
vi.mock("@/app/actions/barrier-workflow", () => ({ loadBarrierWorkflowForFamilyAction: mocks.reloadWorkflow }));
vi.mock("@/features/families/family-lite-workspace", () => ({ FamilyLiteWorkspace: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

const id = "20000000-0000-4000-8000-000000000002";
const family = { id, name: "Family 014", summary: "Prefers afternoon calls", updated_at: "2026-10-15T12:00:00Z", barriers: [{ label: "Housing" }, { label: "Evening transport" }], plan: null, resourceMatches: [], progressUpdates: [], caseNotes: [] };
beforeEach(() => {
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.detail.mockResolvedValue(family);
});

describe.each([["barriers", OverviewPage], ["plan", PlanPage]] as const)("%s page", (_name, Page) => {
  it("uses one authorized snapshot for both the page and its planning context", async () => {
    const result = await Page({ params: Promise.resolve({ id }) });
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.detail).toHaveBeenCalledExactlyOnceWith({ rpc: mocks.rpc }, id);
    expect(mocks.reloadWorkflow).not.toHaveBeenCalled();
    expect(result.props.initialResult).toMatchObject({ familyId: id, referenceId: family.name, selectedBarriers: ["Housing"], additionalBarriers: "Evening transport", additionalDetails: family.summary });
    expect(result.props.plan).toBe(family.plan);
  });

  it("rejects invalid IDs before requesting data", async () => {
    await expect(Page({ params: Promise.resolve({ id: "invalid" }) })).rejects.toThrow("not found");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("does not load family data when access is denied", async () => {
    mocks.session.mockRejectedValue(new Error("Access denied"));
    await expect(Page({ params: Promise.resolve({ id }) })).rejects.toThrow("Access denied");
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("keeps a missing family distinct from a failed load", async () => {
    mocks.detail.mockResolvedValue(null);
    await expect(Page({ params: Promise.resolve({ id }) })).rejects.toThrow("not found");
    mocks.detail.mockRejectedValue(new Error("Unavailable"));
    await expect(Page({ params: Promise.resolve({ id }) })).rejects.toThrow("Unavailable");
  });
});

it("still loads the previous reviewed version when the latest draft is unfinished", async () => {
  mocks.detail.mockResolvedValue({ ...family, plan: { version: 2, generation_state: { status: "failed" }, steps: [] } });
  mocks.rpc.mockResolvedValue({ data: { version: 1 }, error: null });
  const result = await PlanPage({ params: Promise.resolve({ id }) });
  expect(result.props.hasPreviousReviewedPlan).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_previous_reviewed_plan", { p_family_id: id });
});
