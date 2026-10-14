import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateBarrierWorkflowForFamilyAction } from "./barrier-workflow";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), match: vi.fn(), generate: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.session }));
vi.mock("@/app/actions/resource-matches", () => ({ runResourceMatching: mocks.match }));
vi.mock("@/app/actions/plans", () => ({ startStagedLeanPlanGeneration: mocks.generate, updatePlanStepActionItem: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const revision = "2026-08-04T13:00:00.000Z";
const familyId = "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7";

beforeEach(() => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: familyId, name: "Family 014" } }) };
  mocks.session.mockResolvedValue({ supabase: { from: () => query, rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: revision, error: null });
  mocks.match.mockResolvedValue({ ok: true });
  mocks.generate.mockResolvedValue({ ok: false, error: "AI unavailable." });
});

describe("saved planning context", () => {
  it.each(["  Needs flexible meeting times.  ", "", "g".repeat(4000)])("saves description and barriers before either downstream service (case %#)", async (additionalDetails) => {
    const result = await generateBarrierWorkflowForFamilyAction(familyId, { selectedBarriers: ["Housing"], expectedUpdatedAt: revision, additionalDetails });
    expect(mocks.rpc).toHaveBeenCalledWith("save_family_planning_context", expect.objectContaining({ p_family_id: familyId, p_expected_updated_at: revision, p_summary: additionalDetails.trim() || null, p_barriers: [expect.objectContaining({ label: "Housing" })] }));
    expect(mocks.generate).toHaveBeenCalledWith({ familyId, aiMode: undefined });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.match.mock.invocationCallOrder[0]);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("case details were saved") });
  });

  it("does not generate or match after a failed context save", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "database unavailable" } });
    expect(await generateBarrierWorkflowForFamilyAction(familyId, { selectedBarriers: ["Housing"], expectedUpdatedAt: revision, additionalDetails: "New context." })).toMatchObject({ ok: false });
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

it("keeps a stale context conflict recoverable without running AI", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "40001" } });
  expect(await generateBarrierWorkflowForFamilyAction(familyId, { selectedBarriers: ["Housing"], additionalDetails: "New context.", expectedUpdatedAt: revision })).toMatchObject({ ok: false, error: expect.stringContaining("Reload this page") });
  expect(mocks.generate).not.toHaveBeenCalled();
});
