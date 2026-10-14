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
  id: "30000000-0000-4000-8000-000000000003", updated_at: "2026-10-01T12:00:00.123456Z", status: "pending", phase: "30", title: "Prepare intake", description: "Gather the agreed materials",
  details: { owner: "family", checklist: ["Confirmed document"], required_documents: ["Old document"],
    contacts: [{ name: "Old contact" }], expected_outcome: "Intake ready", timing_guidance: "After school", stage_goal: "Housing stability" },
  action_items: [{ id: "40000000-0000-4000-8000-000000000004", updated_at: "2026-10-01T12:00:00.123456Z", status: "pending", notes: null, outcome: null, follow_up_date: null, title: "Call intake", description: "Use the agreed wording", week_index: 1, target_date: "2026-10-20" }],
};
const unchanged: PlanRefineLeanStep = {
  id: base.id, phase: "30", title: base.title, description: base.description,
  required_documents: null, contacts: null, expected_outcome: "Intake ready", timing_guidance: "After school", priority: null, action_items: null,
};

describe("existing-plan refinement preserves cardinality and intentional removals", () => {
  beforeEach(() => vi.mocked(createAiResponse).mockReset());

  it.each([0, 1, 4])("keeps %i existing actions without creating filler in the complete refinement path", async (count) => {
    const draft = { ...base, action_items: Array.from({ length: count }, (_, i) => ({ ...base.action_items[0], id: `40000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`, title: `Action ${i + 1}` })) };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...unchanged, title: "Clarified intake" }] }) });
    const result = await previewRefinePlanStepsWithOpenAI(detail, [draft], "Improve only the heading");
    expect(result).toEqual({ ok: true, model: "test", steps: [{ ...draft, title: "Clarified intake" }] });
    const prompt = vi.mocked(createAiResponse).mock.calls[0][0].input as string;
    if (count > 0) expect(prompt).toContain("2026-10-20");
    expect(prompt).not.toContain("Start:");
    expect(previewRefinePlanSchema.safeParse({ expectedRevision: "a".repeat(64), familyId: "20000000-0000-4000-8000-000000000002", feedback: "Improve heading", draft: { steps: [draft] } }).success).toBe(true);
  });

  it("distinguishes explicit clearing from leaving documents and contacts unchanged", () => {
    expect(mergeLeanRefineIntoBase(base, unchanged)).toEqual(base);
    const withLegacy = { ...base, details: { ...base.details, materials_needed: ["Legacy form"] } };
    expect(mergeLeanRefineIntoBase(withLegacy, unchanged)).toEqual(withLegacy);
    const cleared = mergeLeanRefineIntoBase(withLegacy, { ...unchanged, required_documents: [], contacts: [] });
    expect(cleared.details).toEqual({ ...base.details, required_documents: [], contacts: [] });
    expect(cleared.action_items).toEqual(base.action_items);
    expect(base.details.contacts).toEqual([{ name: "Old contact" }]);
  });

  it.each(["wording", "date", "preserve"])("uses the actual Waiting follow-up for a %s edit through the provider/merge path", async kind => {
    const waiting = structuredClone(base);
    Object.assign(waiting.action_items[0], { status: "blocked", target_date: "2020-01-01", follow_up_date: "2026-10-20", notes: "Waiting for a callback" });
    const action = waiting.action_items[0];
    const proposal = { id: action.id, title: kind === "wording" ? "Follow up with intake" : action.title, description: action.description, week_index: 1, target_date: kind === "date" ? "2026-10-23" : null };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...unchanged, action_items: kind === "preserve" ? null : [proposal] }] }) });
    const result = await previewRefinePlanStepsWithOpenAI(detail, [waiting], "Clarify the follow-up", { taskType: "step_refinement" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0].action_items[0]).toMatchObject({
      title: kind === "wording" ? "Follow up with intake" : action.title,
      target_date: kind === "date" ? "2026-10-23" : "2020-01-01", follow_up_date: kind === "date" ? "2026-10-23" : "2026-10-20",
      status: "blocked", notes: "Waiting for a callback", updated_at: action.updated_at,
    });
    const prompt = vi.mocked(createAiResponse).mock.calls[0][0].input as string;
    expect(prompt).toContain('"target_date": "2026-10-20"');
    expect(prompt).not.toContain("2020-01-01");
  });

  it("returns an explicit error for unsupported action removal instead of fabricating or retaining tasks", async () => {
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...unchanged, action_items: [] }] }) });
    expect(await previewRefinePlanStepsWithOpenAI(detail, [base], "Remove the action")).toMatchObject({ ok: false, reason: expect.stringContaining("changed the plan structure") });
  });

  it("preserves an explicit single action with its description and confirmed date", () => {
    const next = { ...base.action_items[0], title: "Call the intake desk" };
    expect(mergeLeanRefineIntoBase(base, { ...unchanged, action_items: [next] }).action_items).toEqual([next]);
  });

  it("matches reordered goals and tasks by ID while keeping completion, notes, ownership, and outcomes attached", async () => {
    const first = { ...base, action_items: [
      { ...base.action_items[0], status: "completed" as const, notes: "Confirmed", outcome: "Intake booked" },
      { ...base.action_items[0], id: "40000000-0000-4000-8000-000000000005", title: "Follow up", notes: "Waiting for reply" },
    ] };
    const second = { ...base, id: "30000000-0000-4000-8000-000000000006", title: "Transport", action_items: [] };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [
      { ...unchanged, id: second.id, title: "Clarified transport" },
      { ...unchanged, id: first.id, title: "Clarified intake", action_items: [...first.action_items].reverse().map(action => ({ id: action.id, title: `${action.title} clarified`, description: action.description, week_index: action.week_index, target_date: action.target_date })) },
    ] }) });
    const result = await previewRefinePlanStepsWithOpenAI(detail, [first, second], "Clarify the wording");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.steps.map(step => step.id)).toEqual([first.id, second.id]);
    expect(result.steps[0].action_items).toEqual(first.action_items.map(action => ({ ...action, title: `${action.title} clarified` })));
    expect(result.steps[0].details.owner).toBe("family");
    const prompt = vi.mocked(createAiResponse).mock.calls[0][0].input as string;
    expect(prompt).toContain(first.action_items[0].id);
    expect(prompt).toContain('"status": "completed"');
    expect(prompt).toContain("Intake booked");
  });

  it.each(["foreign goal", "foreign action", "duplicate goals", "duplicate actions", "missing action"])("rejects %s before returning a preview", async (kind) => {
    const first = { ...base, action_items: [base.action_items[0], { ...base.action_items[0], id: "40000000-0000-4000-8000-000000000005" }] };
    const second = { ...base, id: "30000000-0000-4000-8000-000000000006" };
    const rows = [ { ...unchanged, action_items: first.action_items.map(({ id, title, description, week_index, target_date }) => ({ id, title, description, week_index, target_date })) }, { ...unchanged, id: second.id } ];
    if (kind === "foreign goal") rows[0].id = "90000000-0000-4000-8000-000000000009";
    if (kind === "foreign action") rows[0].action_items![0].id = "90000000-0000-4000-8000-000000000009";
    if (kind === "duplicate goals") rows[1].id = rows[0].id;
    if (kind === "duplicate actions") rows[0].action_items![1].id = rows[0].action_items![0].id;
    if (kind === "missing action") rows[0].action_items!.pop();
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: rows }) });
    expect(await previewRefinePlanStepsWithOpenAI(detail, [first, second], "Clarify")).toMatchObject({ ok: false, reason: expect.stringContaining("changed the plan structure") });
  });
  it("rejects unsolicited progress fields without reflecting model content in errors", async () => {
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...unchanged, "private model content": true }] }) });
    const result = await previewRefinePlanStepsWithOpenAI(detail, [base], "Clarify");
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("invalid plan draft") });
    expect(JSON.stringify(result)).not.toContain("private model content");
  });

  it("preserves a confirmed date and scheduling metadata when a model returns a null date", () => {
    const proposed = { id: base.action_items[0].id, title: "Call intake", description: null, week_index: 52, target_date: null };
    const result = mergeLeanRefineIntoBase(base, { ...unchanged, action_items: [proposed] });
    expect(result.action_items[0]).toMatchObject({ target_date: base.action_items[0].target_date, week_index: base.action_items[0].week_index });
  });

});
