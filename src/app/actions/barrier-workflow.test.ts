import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateBarrierWorkflowForFamilyAction, loadBarrierWorkflowForFamilyAction, toggleBarrierWorkflowActionItemAction } from "./barrier-workflow";
import { PRESET_BARRIERS } from "@/lib/constants/intake-options";
import { BARRIER_PRESETS } from "@/types/barrier-workflow";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), match: vi.fn(), generate: vi.fn(), session: vi.fn(), detail: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.session }));
vi.mock("@/app/actions/resource-matches", () => ({ runResourceMatching: mocks.match }));
vi.mock("@/app/actions/plans", () => ({ startStagedLeanPlanGeneration: mocks.generate, updatePlanStepActionItem: mocks.update }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: mocks.detail }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const revision = "2026-08-04T13:00:00.000Z";
const familyId = "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7";

beforeEach(() => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: familyId, name: "Family 014" } }) };
  mocks.session.mockResolvedValue({ supabase: { from: () => query, rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: revision, error: null });
  mocks.match.mockResolvedValue({ ok: true });
  mocks.generate.mockResolvedValue({ ok: false, error: "AI unavailable." });
  mocks.update.mockResolvedValue({ ok: true });
  mocks.detail.mockResolvedValue({ name: "Family 014", summary: "", barriers: [], plan: null, resourceMatches: [] });
});

describe("saved planning context", () => {
  it("reloads the family's priority, strengths and constraints unchanged after AI fails", async () => {
    const context = "Priority: keep the school routine steady.\nSupport: a relative helps with transport.\nPreference: calls after work.\nAlready tried: an application is waiting for a response.";
    let savedContext = "";
    mocks.rpc.mockImplementation(async (name, input) => {
      if (name === "save_family_planning_context") savedContext = input.p_summary;
      return { data: revision, error: null };
    });
    mocks.detail.mockImplementation(async () => ({ name: "Family 014", summary: savedContext, barriers: [{ label: "Housing" }], plan: null, resourceMatches: [] }));
    const result = await generateBarrierWorkflowForFamilyAction(familyId, { selectedBarriers: ["Housing"], expectedUpdatedAt: revision, additionalDetails: context });
    expect(result).toMatchObject({ ok: false, savedContextAt: revision });
    expect(savedContext).toBe(context);
    expect(await loadBarrierWorkflowForFamilyAction(familyId)).toMatchObject({ ok: true, result: { additionalDetails: context } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

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

describe("intake barriers survive planning", () => {
  it.each(PRESET_BARRIERS)("preserves $label and its resource category through load and save", async ({ value, label }) => {
    mocks.detail.mockResolvedValue({ name: "Family 014", summary: "", barriers: [{ preset_key: value, label }], plan: null, resourceMatches: [] });
    const loaded = await loadBarrierWorkflowForFamilyAction(familyId);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.result.selectedBarriers.every(selected => BARRIER_PRESETS.some(p => p.label === selected))).toBe(true);
    expect([...loaded.result.selectedBarriers, ...loaded.result.additionalBarriers.split("\n").filter(Boolean)]).toEqual([label]);
    await generateBarrierWorkflowForFamilyAction(familyId, { selectedBarriers: loaded.result.selectedBarriers, additionalBarriers: loaded.result.additionalBarriers, expectedUpdatedAt: revision });
    expect(mocks.rpc).toHaveBeenCalledWith("save_family_planning_context", expect.objectContaining({ p_barriers: [{ preset_key: value, label, sort_order: 0 }] }));
  });

  it.each(["load", "toggle"])("preserves custom wording and recognizes only exact planning labels on %s", async operation => {
    mocks.detail.mockResolvedValue({ name: "Family 014", summary: "", barriers: [
      { preset_key: "health_barrier", label: "Health / disability barrier" },
      { preset_key: "housing_instability", label: "Housing" },
      { preset_key: "legacy_custom", label: "Limited transport, evenings; weekends only" },
      { preset_key: null, label: "Needs a flexible meeting format" },
      { preset_key: "other", label: "Prefers paper materials" },
    ], plan: null, resourceMatches: [] });
    const result = operation === "load" ? await loadBarrierWorkflowForFamilyAction(familyId) : await toggleBarrierWorkflowActionItemAction(familyId, familyId, true, revision);
    expect(result).toMatchObject({ ok: true, result: { selectedBarriers: ["Housing"], additionalBarriers: "Health / disability barrier\nLimited transport, evenings; weekends only\nNeeds a flexible meeting format\nPrefers paper materials" } });
  });

  it("keeps commas and semicolons within a custom barrier when saving", async () => {
    await generateBarrierWorkflowForFamilyAction(familyId, { selectedBarriers: [], additionalBarriers: "Limited transport, evenings; weekends only\nPrefers paper materials", expectedUpdatedAt: revision });
    expect(mocks.rpc).toHaveBeenCalledWith("save_family_planning_context", expect.objectContaining({ p_barriers: [
      { preset_key: "other", label: "Limited transport, evenings; weekends only", sort_order: 0 },
      { preset_key: "other", label: "Prefers paper materials", sort_order: 1 },
    ] }));
  });

  it("rejects an overlong custom barrier instead of silently truncating it", async () => {
    expect(await generateBarrierWorkflowForFamilyAction(familyId, { selectedBarriers: [], additionalBarriers: "x".repeat(201), expectedUpdatedAt: revision })).toMatchObject({ ok: false, error: expect.stringContaining("200") });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
