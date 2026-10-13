import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiResponse } from "@/lib/ai/client";
import { previewRefinePlanStepsWithOpenAI } from "./openai-plan";
import { previewRefinePlanSchema } from "@/lib/validations/plans";
import { mergeLeanRefineIntoBase, type DraftStepRefineInput, type PlanRefineLeanStep } from "./plan-refine-lean";
import type { FamilyDetail } from "@/types/family";

vi.mock("@/lib/ai/client", () => ({ createAiResponse: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

const detail = { summary: null, household_notes: null, barriers: [], resourceMatches: [] } as unknown as FamilyDetail;
const base: DraftStepRefineInput = {
  phase: "30", title: "Prepare intake", description: "Gather the agreed materials",
  details: { owner: "family", checklist: ["Confirmed document"], required_documents: ["Old document"],
    contacts: [{ name: "Old contact" }], expected_outcome: "Intake ready", timing_guidance: "After school", stage_goal: "Housing stability" },
  action_items: [{ title: "Call intake", description: "Use the agreed wording", week_index: 1, target_date: "2026-10-20" }],
};
const unchanged: PlanRefineLeanStep = {
  phase: "30", title: base.title, description: base.description,
  required_documents: null, contacts: null, expected_outcome: "Intake ready", timing_guidance: "After school", priority: null, action_items: null,
};

describe("existing-plan refinement preserves cardinality and intentional removals", () => {
  beforeEach(() => vi.mocked(createAiResponse).mockReset());

  it.each([0, 1, 4])("keeps %i existing actions without creating filler in the complete refinement path", async (count) => {
    const draft = { ...base, action_items: Array.from({ length: count }, (_, i) => ({ ...base.action_items[0], title: `Action ${i + 1}` })) };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...unchanged, title: "Clarified intake" }] }) });
    const result = await previewRefinePlanStepsWithOpenAI(detail, [draft], "Improve only the heading");
    expect(result).toEqual({ ok: true, model: "test", steps: [{ ...draft, title: "Clarified intake" }] });
    const prompt = vi.mocked(createAiResponse).mock.calls[0][0].input as string;
    if (count > 0) expect(prompt).toContain("2026-10-20");
    expect(prompt).not.toContain("Start:");
    expect(previewRefinePlanSchema.safeParse({ familyId: "20000000-0000-4000-8000-000000000002", feedback: "Improve heading", draft: { steps: [draft] } }).success).toBe(true);
  });

  it("distinguishes explicit clearing from leaving documents and contacts unchanged", () => {
    expect(mergeLeanRefineIntoBase(base, unchanged)).toEqual(base);
    const cleared = mergeLeanRefineIntoBase(base, { ...unchanged, required_documents: [], contacts: [] });
    expect(cleared.details).toEqual({ ...base.details, required_documents: [], contacts: [] });
    expect(cleared.action_items).toEqual(base.action_items);
    expect(base.details.contacts).toEqual([{ name: "Old contact" }]);
  });

  it("returns an explicit error for unsupported action removal instead of fabricating or retaining tasks", async () => {
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...unchanged, action_items: [] }] }) });
    expect(await previewRefinePlanStepsWithOpenAI(detail, [base], "Remove the action")).toMatchObject({ ok: false, reason: expect.stringContaining("cannot add or remove actions") });
  });

  it("preserves an explicit single action with its description and confirmed date", () => {
    const next = { ...base.action_items[0], title: "Call the intake desk" };
    expect(mergeLeanRefineIntoBase(base, { ...unchanged, action_items: [next] }).action_items).toEqual([next]);
  });
});
