import { describe, expect, it } from "vitest";
import { buildFamilyTakeaway, openTakeawayActions } from "./family-takeaway-data";
import { familyTakeawayFixture } from "../../../tests/fixtures/family-takeaway";

describe("family takeaway privacy and review boundary", () => {
  it("copies only selected reviewed goals, action titles, owners, dates and explicitly selected contact fields", () => {
    const { plan, selection } = familyTakeawayFixture();
    const data = buildFamilyTakeaway(plan, selection);
    expect(data).toEqual({
      goals: [{
        title: plan.steps[0].details!.stage_goal,
        actions: [
          { id: "action-1", title: "Pending dated action", owner: "family", date: "2026-10-20", dateLabel: "Target date" },
          { id: "action-3", title: "Waiting for a callback", owner: "family", date: "2026-11-01", dateLabel: "Follow-up" },
        ],
        contacts: [{ name: "School support office", phone: "215-555-0148", email: "support@example.test" }],
      }],
      nextCheckIn: "2026-10-27",
    });
    expect(JSON.stringify(data)).not.toContain("PRIVATE_MARKER");
    expect(JSON.stringify(data)).not.toContain("Started dated action");
    expect(JSON.stringify(data)).not.toContain("2020-01-01");
  });

  it("does not infer discussion from family ownership, or add a check-in or contacts", () => {
    const { plan, selection } = familyTakeawayFixture();
    expect(() => buildFamilyTakeaway(plan, { ...selection, discussedWithFamily: false })).toThrow(/Confirm/);
    const data = buildFamilyTakeaway(plan, { ...selection, contactKeys: [], nextCheckIn: "" });
    expect(data.goals[0].contacts).toEqual([]);
    expect(data.nextCheckIn).toBeNull();
  });

  it.each(["action-4", "action-5", "missing-action"])("refuses completed, withdrawn or unknown action %s", actionId => {
    const { plan, selection } = familyTakeawayFixture();
    expect(() => buildFamilyTakeaway(plan, { ...selection, actionIds: [actionId], contactKeys: [] })).toThrow(/selected details changed/);
  });

  it("rejects stale review, an empty selection, unrelated contacts and invalid calendar dates", () => {
    const { plan, selection } = familyTakeawayFixture();
    expect(() => buildFamilyTakeaway({ ...plan, material_revision: "changed" }, selection)).toThrow(/Review/);
    expect(() => buildFamilyTakeaway(plan, { ...selection, actionIds: [] })).toThrow(/at least one/);
    expect(() => buildFamilyTakeaway(plan, { ...selection, contactKeys: ["unselected-step:0"] })).toThrow(/selected details changed/);
    expect(() => buildFamilyTakeaway(plan, { ...selection, nextCheckIn: "2026-02-29" })).toThrow(/valid next check-in/);
  });

  it("orders edited dates and Waiting follow-ups without changing the saved order", () => {
    const { plan, selection } = familyTakeawayFixture();
    const step = plan.steps[0];
    step.action_items![2].follow_up_date = "2026-10-16";
    expect(openTakeawayActions(step).map(action => action.id)).toEqual(["action-3", "action-1", "action-2", "action-6"]);
    expect(buildFamilyTakeaway(plan, selection).goals[0].actions.map(action => action.id)).toEqual(["action-3", "action-1"]);
    expect(step.action_items![0].id).toBe("action-1");
  });

  it("keeps a goal chronological when its selected actions come from different steps", () => {
    const { plan, selection } = familyTakeawayFixture();
    const original = plan.steps[0];
    original.action_items![2].follow_up_date = "2026-12-20";
    plan.steps.push({ ...original, id: "second-step", sort_order: 1, action_items: [{ ...original.action_items![0], id: "middle-action", plan_step_id: "second-step", target_date: "2026-11-20" }] });
    expect(buildFamilyTakeaway(plan, { ...selection, actionIds: [...selection.actionIds, "middle-action"] }).goals[0].actions.map(action => action.date)).toEqual(["2026-10-20", "2026-11-20", "2026-12-20"]);
  });
});
