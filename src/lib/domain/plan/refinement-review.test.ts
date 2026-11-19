import { describe, expect, it } from "vitest";
import { applyRefinementChanges, collectRefinementChanges, toRefinementDraft } from "./refinement-review";
import type { PlanStepRow } from "@/types/family";

const stamp = "2026-10-01T12:00:00.123456Z";
const base: PlanStepRow = {
  id: "30000000-0000-4000-8000-000000000003", plan_id: "10000000-0000-4000-8000-000000000001",
  phase: "30", title: "Housing intake", description: "Human-written summary", status: "pending", priority: "high",
  sort_order: 0, assigned_to_id: null, due_date: null, created_at: stamp, updated_at: stamp,
  details: { owner: "family", checklist: ["Done"], required_documents: ["Existing document"], materials_needed: ["Old alias"], contacts: [{ name: "Agreed contact" }] },
  workflow_data: { checklist_completed: [true], outcome_notes: "Family confirmed" },
  action_items: [{ id: "40000000-0000-4000-8000-000000000004", plan_step_id: "30000000-0000-4000-8000-000000000003",
    title: "Call intake", description: null, week_index: 1, target_date: "2026-10-20", follow_up_date: "2026-10-20", status: "blocked", notes: "Waiting for a callback",
    outcome: null, sort_order: 0, created_at: stamp, updated_at: stamp }],
};

describe("reviewing individual AI changes", () => {
  it("shows contact facts without internal identifiers and applies their source only when selected", () => {
    const next = toRefinementDraft(base);
    const contact = {source_resource_id:"90000000-0000-4000-8000-000000000009",source_updated_at:stamp,name:"Housing office",phone:"215-555-0148"};
    next.details = {...next.details,contacts:[contact]};
    const changes = collectRefinementChanges([base],[next]);
    expect(changes[0].after).toBe("Housing office · 215-555-0148");
    expect(applyRefinementChanges([base],changes,[])[0].details?.contacts).toEqual(base.details?.contacts);
    expect(applyRefinementChanges([base],changes,[changes[0].id])[0].details?.contacts).toEqual([contact]);
  });
  it("applies only the selected field and preserves unrelated human work", () => {
    const next = toRefinementDraft(base);
    next.title = "New title";
    next.description = "Short summary";
    next.details = { ...next.details, owner: "school_program", checklist: [], required_documents: [] };
    next.workflow_data = { checklist_completed: [false] };
    next.action_items[0] = { ...next.action_items[0], target_date: "2026-12-01", notes: "Model note", outcome: "Model outcome" };
    const changes = collectRefinementChanges([base], [next]);
    expect(applyRefinementChanges([base], changes, [])).toEqual([base]);
    expect(applyRefinementChanges([base], changes, [`${base.id}:description`])).toEqual([{ ...base, description: "Short summary" }]);
    const all = applyRefinementChanges([base], changes, changes.map(change => change.id))[0];
    expect(all.details?.owner).toBe("family");
    expect(all.details?.checklist).toEqual(["Done"]);
    expect(all.workflow_data).toEqual(base.workflow_data);
    expect(all.action_items![0].notes).toBe("Waiting for a callback");
    expect(all.action_items![0].outcome).toBeNull();
  });

  it("changes a waiting date only after selection and keeps both stored dates consistent", () => {
    const next = toRefinementDraft(base);
    next.action_items[0].target_date = "2026-11-02";
    next.action_items[0].follow_up_date = "2026-11-02";
    const changes = collectRefinementChanges([base], [next]);
    const selected = applyRefinementChanges([base], changes, [changes[0].id])[0];
    expect(selected.action_items![0]).toEqual({ ...base.action_items![0], target_date: "2026-11-02", follow_up_date: "2026-11-02" });
    expect(selected.updated_at).toBe(stamp);
    expect(selected.action_items![0].updated_at).toBe(stamp);
  });

  it("does not propose an older target date when an unchanged Waiting action has a later follow-up", () => {
    const waiting = structuredClone(base);
    waiting.action_items![0].target_date = "2020-01-01";
    expect(collectRefinementChanges([waiting], [toRefinementDraft(waiting)])).toEqual([]);
  });

  it("does not offer model rewrites of completed work", () => {
    const completed = structuredClone(base);
    completed.action_items![0].status = "completed";
    completed.action_items![0].outcome = "Intake completed";
    const next = toRefinementDraft(completed);
    next.action_items[0].title = "Different work";
    next.action_items[0].target_date = "2026-12-01";
    next.action_items[0].status = "pending";
    expect(collectRefinementChanges([completed], [next])).toEqual([]);
    completed.status = "completed";
    next.title = "Different goal";
    expect(collectRefinementChanges([completed], [next])).toEqual([]);
  });

  it.each([{ documents: ["Existing document"] }, { documents: [] }])("can explicitly remove documents including the legacy alias after showing the complete old list ($documents)", ({ documents }) => {
    const original = { ...base, details: { ...base.details, required_documents: documents } };
    const next = toRefinementDraft(original);
    next.details = { ...next.details, required_documents: [], materials_needed: undefined };
    const changes = collectRefinementChanges([original], [next]);
    expect(changes[0].before).toContain("Old alias");
    const applied = applyRefinementChanges([original], changes, [changes[0].id])[0];
    expect(applied.details?.required_documents).toEqual([]);
    expect(applied.details?.materials_needed).toBeUndefined();
    expect(applied.details?.contacts).toEqual(base.details?.contacts);
  });
});
