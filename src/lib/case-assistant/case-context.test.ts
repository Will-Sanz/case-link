import { beforeEach, describe, expect, it, vi } from "vitest";
import { directoryCase, directoryId } from "../../../tests/fixtures/directory-case";
import { buildAssistantCaseContext } from "./case-context";
import { askCaseAssistant } from "./ai-case-assistant";
import { askCaseAssistantAction } from "@/app/actions/case-assistant";
import { createAiResponse } from "@/lib/ai/client";
import { encodeActionNotes } from "@/lib/domain/plan/action-state";
import type { FamilyDetail, PlanStepActionItemRow, PlanWithSteps } from "@/types/family";

const mocks = vi.hoisted(() => ({ session: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.session }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: mocks.detail }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ OPENAI_API_KEY: "synthetic" }) }));
vi.mock("@/lib/ai/client", () => ({ createAiResponse: vi.fn() }));
const stamp = "2026-10-12T12:00:00Z";
const familyId = "20000000-0000-4000-8000-000000000002";
function action(id: string, patch: Partial<PlanStepActionItemRow> = {}): PlanStepActionItemRow {
  return { id, plan_step_id: "goal-1", title: `Task ${id}`, description: "Prepare the next intake", week_index: 1, target_date: "2026-10-20", follow_up_date: null,
    status: "pending", notes: null, outcome: null, sort_order: 0, created_at: stamp, updated_at: stamp, ...patch };
}
function fixture(): FamilyDetail {
  const plan: PlanWithSteps = { id: "plan-1", family_id: familyId, version: 2, summary: null, generation_source: "openai", ai_model: null, created_at: stamp,
    review_revision: "a".repeat(64), presentation: { sourceKind: "ai" }, steps: [{ id: "goal-1", plan_id: "plan-1", phase: "30", title: "Housing intake",
      description: "Prepare agreed materials", details: { owner: "family", expected_outcome: "Intake ready", stage_goal: "Stable housing" }, status: "pending", due_date: null,
      priority: "high", assigned_to_id: null, sort_order: 0, created_at: stamp, updated_at: stamp, action_items: [
        action("done", { status: "completed", target_date: "2026-10-01", outcome: "Intake completed" }),
        action("waiting", { status: "blocked", target_date: "2026-10-01", follow_up_date: "2026-10-25", notes: "Awaiting the intake decision" }),
        action("overdue", { target_date: "2026-10-10", notes: "Bring the agreed checklist" }),
      ] }] };
  return { id: familyId, name: "Family 014", summary: "Housing support", household_notes: null, urgency: "high", status: "active", created_by_id: "owner", created_at: stamp,
    updated_at: stamp, creator: { email: "staff@example.test" }, members: [], goals: [], barriers: [], resourceMatches: [], plan,
    caseNotes: [{ id: "note-older", family_id: familyId, author_id: "owner", body: "Intake not yet completed", created_at: "2026-10-01T12:00:00Z", author: { email: "staff@example.test" } }],
    progressUpdates: [{ id: "meeting-newer", family_id: familyId, plan_id: plan.id, author_id: "owner", occurred_on: "2026-10-12", summary: "Intake completed; awaiting a decision", created_at: stamp, plan_changes: [], author: { email: "staff@example.test" } }],
  };
}

describe("current case context for the assistant", () => {
  beforeEach(() => {
    vi.mocked(createAiResponse).mockReset().mockResolvedValue({ ok: true, text: JSON.stringify({answer: "Review the overdue checklist.", resource_ids: []}), model: "test" });
    mocks.session.mockReset().mockResolvedValue({ supabase: {} });
    mocks.detail.mockReset().mockResolvedValue(fixture());
  });

  it("withholds contacts dismissed while the assistant was responding", async () => {
    mocks.detail.mockResolvedValue(directoryCase());
    const lookup = {select:()=>lookup,eq:()=>lookup,in:async()=>({data:[],error:null})};
    mocks.session.mockResolvedValue({supabase:{from:()=>lookup}});
    vi.mocked(createAiResponse).mockResolvedValue({ok:true,model:"test",text:JSON.stringify({answer:"Confirm current intake options.",resource_ids:[directoryId]})});
    expect(await askCaseAssistantAction(familyId,"Help plan intake")).toMatchObject({ok:false});
    expect(createAiResponse).toHaveBeenCalledTimes(1);
  });

  it("uses live task dates, Waiting follow-ups, completion, and meeting/recording dates", () => {
    const context = JSON.parse(buildAssistantCaseContext(fixture(), new Date("2026-10-14T02:00:00Z")));
    expect(context.as_of).toBe("2026-10-13");
    expect(context.next_by_due_date).toMatchObject({ action_needed_now: "Task overdue", due_date: "2026-10-10" });
    expect(context.actions.map((row: { id: string }) => row.id)).toEqual(["overdue", "waiting", "done"]);
    expect(context.actions[0]).toMatchObject({ overdue: true, notes: "Bring the agreed checklist" });
    expect(context.actions[1]).toMatchObject({ status: "waiting", effective_date: "2026-10-25", overdue: false });
    expect(context.actions[2]).toMatchObject({ status: "completed", overdue: false, outcome: "Intake completed", completion_date: null, target_date: "2026-10-01", updated_at: stamp });
    expect(context.recent_meetings[0]).toMatchObject({ occurred_on: "2026-10-12", recorded_at: stamp, summary: "Intake completed; awaiting a decision" });
    expect(context.recent_notes[0].recorded_at).toBe("2026-10-01T12:00:00Z");
    expect(context.goals[0].owner).toBe("family");
    expect(context.plan.review.state).toBe("needs_review");
    expect(JSON.stringify(context)).not.toContain("staff@example.test");
  });

  it("distinguishes missing plans and withdrawn work without inventing a next task", () => {
    const detail = fixture();
    detail.plan!.steps[0].action_items = [action("withdrawn", { status: "completed", notes: encodeActionNotes("No longer required", true) })];
    const context = JSON.parse(buildAssistantCaseContext(detail));
    expect(context.actions[0]).toMatchObject({ status: "no_longer_needed", notes: "No longer required" });
    expect(context.next_by_due_date).toBeNull();
    detail.plan = null;
    expect(JSON.parse(buildAssistantCaseContext(detail))).toMatchObject({ plan: null, next_by_due_date: null, goals: [], actions: [] });
  });

  it("bounds large records, declares omissions, and keeps earliest open work first", () => {
    const detail = fixture();
    const step = detail.plan!.steps[0];
    const long = "General context. ".repeat(500);
    detail.summary = long; detail.household_notes = long;
    detail.goals = Array.from({ length: 25 }, (_, i) => ({ id: `stated-${i}`, family_id: familyId, preset_key: null, label: long, sort_order: i, created_at: stamp }));
    detail.barriers = detail.goals.map(goal => ({ ...goal }));
    detail.progressUpdates = Array.from({ length: 10 }, (_, i) => ({ ...detail.progressUpdates[0], id: `meeting-${i}`, summary: long }));
    detail.caseNotes = Array.from({ length: 10 }, (_, i) => ({ ...detail.caseNotes[0], id: `note-${i}`, body: long }));
    detail.plan!.steps = Array.from({ length: 15 }, (_, i) => ({ ...step, id: `goal-${i}`, description: long, details: { ...step.details, stage_goal: long, expected_outcome: long },
      action_items: Array.from({ length: 20 }, (_, j) => action(`task-${i}-${j}`, { description: long, notes: long, outcome: long, target_date: i === 0 && j === 0 ? "2026-10-01" : "2026-12-01" })) }));
    const raw = buildAssistantCaseContext(detail);
    expect(raw.length).toBeLessThanOrEqual(70_000);
    const context = JSON.parse(raw);
    expect(context.actions[0].id).toBe("task-0-0");
    expect(context.limits.actions_omitted).toBe(300 - context.actions.length);
    expect(context.limits).toMatchObject({ shortened_text: true, stated_goals_omitted: 5, barriers_omitted: 5, meetings_omitted: 5, notes_omitted: 5 });
    expect(raw).toContain("[shortened]");
  });

  it("sends current state with instructions to handle historical conflicts and missing context honestly", async () => {
    expect(await askCaseAssistantAction(familyId, "What should I prioritize this week?")).toMatchObject({ ok: true });
    const request = vi.mocked(createAiResponse).mock.calls[0][0];
    expect(request.instructions).toContain("do not claim complete context");
    expect(request.instructions).toContain("do not override the current saved action state");
    expect(request.input).toContain("Intake completed");
    expect(request.input).toContain("2026-10-25");
    expect(request.input).not.toContain("staff@example.test");
  });

  it.each(["notes", "outcome", "description"] as const)("blocks identifying content in newly included action %s before provider access", async field => {
    const detail = fixture();
    detail.plan!.steps[0].action_items![0][field] = "Contact private-person@example.test";
    expect(await askCaseAssistant(detail, "What next?")).toMatchObject({ ok: false });
    expect(createAiResponse).not.toHaveBeenCalled();
  });

  it("does not build or send context for an inaccessible family or expired session", async () => {
    mocks.detail.mockResolvedValue(null);
    expect(await askCaseAssistantAction(familyId, "What next?")).toMatchObject({ ok: false });
    expect(createAiResponse).not.toHaveBeenCalled();
    mocks.session.mockRejectedValue(new Error("Unauthorized"));
    expect(await askCaseAssistantAction(familyId, "What next?")).toMatchObject({ ok: false });
    expect(createAiResponse).not.toHaveBeenCalled();
  });
});
