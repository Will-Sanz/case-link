import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewRefinePlan, previewRefinePlanStep } from "./plans";
import { directoryCase, directoryId } from "../../../tests/fixtures/directory-case";

const mocks = vi.hoisted(() => ({ session: vi.fn(), detail: vi.fn(), refine: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.session }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: mocks.detail }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ OPENAI_API_KEY: "synthetic-provider-key" }) }));
vi.mock("@/lib/plan-generator/openai-plan", () => ({ previewRefinePlanStepsWithOpenAI: mocks.refine }));

const familyId = "20000000-0000-4000-8000-000000000002";
const step = {
  id: "30000000-0000-4000-8000-000000000003", updated_at: "2026-10-01T12:00:00.123456Z", phase: "30", title: "Plan the intake", description: "Prepare materials",
  status: "pending", details: { owner: "family", expected_outcome: "Ready" }, workflow_data: {},
  action_items: [{ id: "40000000-0000-4000-8000-000000000004", updated_at: "2026-10-01T12:00:00.123456Z", title: "Call intake", description: null, week_index: 1,
    target_date: "2026-10-20", status: "completed", notes: "Confirmed", outcome: "Intake booked", follow_up_date: null }],
};

describe("full plan refinement boundary", () => {
  beforeEach(() => {
    mocks.session.mockResolvedValue({ supabase: {} });
    mocks.detail.mockResolvedValue({ name: "Household 4", resourceMatches: [], goals: [], barriers: [], members: [], caseNotes: [], plan: { review_revision: "a".repeat(64), steps: [structuredClone(step)] } });
    mocks.refine.mockImplementation(async (_detail, steps) => ({ ok: true, model: "test", steps }));
  });

  it.each(["step","plan"])("rejects a %s preview if directory data changes while AI responds", async kind => {
    const lookup = {select:()=>lookup,eq:()=>lookup,in:vi.fn(async()=>({data:[{resource_id:directoryId,status:"accepted",resource:{active:true,is_demo:false,updated_at:"2026-10-14T00:00:00Z"}}],error:null}))};
    mocks.session.mockResolvedValue({supabase:{from:()=>lookup}});
    mocks.detail.mockResolvedValue({...directoryCase(),plan:{review_revision:"a".repeat(64),steps:[structuredClone(step)]}});
    const input = {familyId,expectedRevision:"a".repeat(64),feedback:"Clarify wording"};
    const result = kind === "step" ? await previewRefinePlanStep({...input,stepId:step.id,draft:step}) : await previewRefinePlan({...input,draft:{steps:[step]}});
    expect(mocks.refine).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ok:false,error:expect.stringContaining("resource changed")});
  });

  it("passes the authorized IDs and progress evidence through the preview without saving", async () => {
    expect(await previewRefinePlan({ familyId, expectedRevision: "a".repeat(64), feedback: "Clarify wording", draft: { steps: [step] } })).toMatchObject({ ok: true, steps: [expect.objectContaining({
      id: step.id, action_items: [expect.objectContaining({ id: step.action_items[0].id, status: "completed", outcome: "Intake booked" })],
    })] });
    expect(mocks.refine).toHaveBeenCalledTimes(1);
  });

  it.each(["foreign goal", "foreign action", "duplicate goal", "duplicate action", "deleted action"])("rejects %s before calling AI", async (kind) => {
    const draft = { steps: [structuredClone(step)] };
    if (kind === "foreign goal") draft.steps[0].id = "90000000-0000-4000-8000-000000000009";
    if (kind === "foreign action") draft.steps[0].action_items[0].id = "90000000-0000-4000-8000-000000000009";
    if (kind === "duplicate goal") draft.steps.push(structuredClone(step));
    if (kind === "duplicate action") draft.steps[0].action_items.push({ ...step.action_items[0] });
    if (kind === "deleted action") draft.steps[0].action_items = [];
    expect(await previewRefinePlan({ familyId, expectedRevision: "a".repeat(64), feedback: "Clarify wording", draft })).toMatchObject({ ok: false });
    expect(mocks.refine).not.toHaveBeenCalled();
  });

  it.each(["notes", "outcome"])("checks the newly included action %s for identifiers before AI", async (field) => {
    const changed = structuredClone(step);
    changed.action_items[0][field as "notes" | "outcome"] = "parent@example.test";
    expect(await previewRefinePlan({ familyId, expectedRevision: "a".repeat(64), feedback: "Clarify", draft: { steps: [changed] } })).toMatchObject({ ok: false });
    expect(mocks.refine).not.toHaveBeenCalled();
  });

  it("fails closed without an authenticated accessible family", async () => {
    mocks.detail.mockResolvedValue(null);
    expect(await previewRefinePlan({ familyId, expectedRevision: "a".repeat(64), feedback: "Clarify", draft: { steps: [step] } })).toMatchObject({ ok: false });
    mocks.session.mockRejectedValue(new Error("No session"));
    expect(await previewRefinePlan({ familyId, expectedRevision: "a".repeat(64), feedback: "Clarify", draft: { steps: [step] } })).toMatchObject({ ok: false });
    expect(mocks.refine).not.toHaveBeenCalled();
  });

  it("uses the selected unsaved action draft instead of fetching older saved prose", async () => {
    const draft = { ...step, title: "Unsaved human title", description: "Unsaved human instructions" };
    expect(await previewRefinePlanStep({ familyId, expectedRevision: "a".repeat(64), stepId: step.id, feedback: "Shorten the summary", draft })).toMatchObject({ ok: true, step: expect.objectContaining({ title: draft.title, description: draft.description }) });
    expect(mocks.refine).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining(draft)], "Shorten the summary", expect.objectContaining({ taskType: "step_refinement" }));
  });

  it.each(["goal", "action"])("rejects a stale %s revision before either refinement call", async kind => {
    const draft = structuredClone(step);
    if (kind === "goal") draft.updated_at = "2026-10-01T12:00:00.123455Z";
    else draft.action_items[0].updated_at = "2026-10-01T12:00:00.123455Z";
    expect(await previewRefinePlanStep({ familyId, expectedRevision: "a".repeat(64), stepId: step.id, feedback: "Clarify", draft })).toMatchObject({ ok: false, error: expect.stringContaining("saved plan changed") });
    expect(await previewRefinePlan({ familyId, expectedRevision: "a".repeat(64), feedback: "Clarify", draft: { steps: [draft] } })).toMatchObject({ ok: false });
    expect(mocks.refine).not.toHaveBeenCalled();
  });

  it("rejects a changed family/plan snapshot even if individual action timestamps are unchanged", async () => {
    expect(await previewRefinePlanStep({ familyId, stepId: step.id, expectedRevision: "b".repeat(64), feedback: "Clarify", draft: step })).toMatchObject({ ok: false });
    expect(await previewRefinePlan({ familyId, expectedRevision: "b".repeat(64), feedback: "Clarify", draft: { steps: [step] } })).toMatchObject({ ok: false });
    expect(mocks.refine).not.toHaveBeenCalled();
  });
});
