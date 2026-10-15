import { actionTargetDate } from "@/lib/domain/plan/action-state";
import { groupPlanStepsByGoal } from "@/lib/domain/plan/group-plan-steps";
import { isPlanReviewed } from "@/lib/domain/plan/review-status";
import { parseDateOnly } from "@/lib/dates";
import type { PlanStepDetails, PlanStepRow, PlanWithSteps } from "@/types/family";

export function openTakeawayActions(step: PlanStepRow) {
  return (step.action_items ?? []).filter(action => action.status !== "completed").sort((a, b) =>
    (actionTargetDate(a) ?? "9999-12-31").localeCompare(actionTargetDate(b) ?? "9999-12-31") || a.sort_order - b.sort_order || a.id.localeCompare(b.id),
  );
}

export type FamilyTakeawaySelection = {
  actionIds: string[];
  contactKeys: string[];
  nextCheckIn: string;
  discussedWithFamily: boolean;
};

export type FamilyTakeawayData = {
  goals: Array<{
    title: string;
    actions: Array<{
      id: string;
      title: string;
      owner: PlanStepDetails["owner"];
      date: string | null;
      dateLabel: string;
    }>;
    contacts: Array<{ name: string; phone: string; email: string }>;
  }>;
  nextCheckIn: string | null;
};

/** The family document receives only this allowlist, never a plan or its private narratives. */
export function buildFamilyTakeaway(plan: PlanWithSteps, selection: FamilyTakeawaySelection): FamilyTakeawayData {
  if (!isPlanReviewed(plan)) throw new Error("Review the current plan before preparing a family takeaway.");
  if (!selection.discussedWithFamily) throw new Error("Confirm that the selected details were discussed with the family.");
  if (!selection.actionIds.length) throw new Error("Select at least one action to share.");
  if (selection.nextCheckIn && !parseDateOnly(selection.nextCheckIn)) throw new Error("Enter a valid next check-in date.");

  const actionIds = new Set(selection.actionIds);
  const contactKeys = new Set(selection.contactKeys);
  const foundActions = new Set<string>();
  const foundContacts = new Set<string>();
  const goals = groupPlanStepsByGoal(plan.steps).flatMap((goal) => {
    const actions: FamilyTakeawayData["goals"][number]["actions"] = [];
    const contacts: FamilyTakeawayData["goals"][number]["contacts"] = [];
    for (const step of goal.steps) {
      const selectedActions = openTakeawayActions(step).filter(action => actionIds.has(action.id));
      if (!selectedActions.length) continue;
      for (const action of selectedActions) {
        foundActions.add(action.id);
        actions.push({
          id: action.id,
          title: action.title,
          owner: step.details?.owner,
          date: actionTargetDate(action),
          dateLabel: action.status === "blocked" ? "Follow-up" : "Target date",
        });
      }
      for (const [index, contact] of (step.details?.contacts ?? []).entries()) {
        const key = `${step.id}:${index}`;
        if (!contactKeys.has(key)) continue;
        foundContacts.add(key);
        contacts.push({ name: contact.name ?? "", phone: contact.phone ?? "", email: contact.email ?? "" });
      }
    }
    actions.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));
    return actions.length ? [{ title: goal.title, actions, contacts }] : [];
  });
  if (foundActions.size !== actionIds.size || foundContacts.size !== contactKeys.size) {
    throw new Error("The selected details changed. Choose actions and contacts from the current reviewed plan.");
  }
  return { goals, nextCheckIn: selection.nextCheckIn || null };
}
