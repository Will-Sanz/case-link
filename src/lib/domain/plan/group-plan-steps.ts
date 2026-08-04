import type { PlanStepActionItemRow, PlanStepDetails, PlanStepRow } from "@/types/family";

export type PlanGoalGroup = {
  key: string;
  title: string;
  steps: PlanStepRow[];
  actionCount: number;
  completedActionCount: number;
  earliestOpenTargetDate: string | null;
};

function normalizedGoalTitle(step: PlanStepRow): string {
  const details = (step.details ?? {}) as PlanStepDetails;
  return (details.stage_goal?.trim() || step.title.trim() || "Family support goal").replace(
    /\s+/g,
    " ",
  );
}

function isOpenAction(action: PlanStepActionItemRow): boolean {
  return action.status !== "completed";
}

function earliestDate(actions: PlanStepActionItemRow[], openOnly: boolean): string | null {
  const dates = actions
    .filter((action) => !openOnly || isOpenAction(action))
    .map((action) => action.target_date)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates[0] ?? null;
}

function stepSortDate(step: PlanStepRow): string | null {
  const actions = step.action_items ?? [];
  return earliestDate(actions, true) ?? earliestDate(actions, false) ?? step.due_date;
}

/**
 * Converts the storage-oriented plan shape into the user-facing structure.
 * Legacy 30/60/90 phases remain in the database but never determine the UI grouping.
 */
export function groupPlanStepsByGoal(steps: PlanStepRow[]): PlanGoalGroup[] {
  const groups = new Map<string, PlanGoalGroup & { firstSortOrder: number }>();

  for (const step of [...steps].sort((a, b) => a.sort_order - b.sort_order)) {
    const title = normalizedGoalTitle(step);
    const key = title.toLocaleLowerCase();
    const actions = step.action_items ?? [];
    const existing = groups.get(key);

    if (existing) {
      existing.steps.push(step);
      existing.actionCount += actions.length;
      existing.completedActionCount += actions.filter(
        (action) => action.status === "completed",
      ).length;
      const candidate = earliestDate(actions, true);
      if (
        candidate &&
        (!existing.earliestOpenTargetDate || candidate < existing.earliestOpenTargetDate)
      ) {
        existing.earliestOpenTargetDate = candidate;
      }
      continue;
    }

    groups.set(key, {
      key,
      title,
      steps: [step],
      actionCount: actions.length,
      completedActionCount: actions.filter((action) => action.status === "completed").length,
      earliestOpenTargetDate: earliestDate(actions, true),
      firstSortOrder: step.sort_order,
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      steps: [...group.steps].sort((a, b) => {
        const aDate = stepSortDate(a);
        const bDate = stepSortDate(b);
        if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;
        return a.sort_order - b.sort_order;
      }),
    }))
    .sort((a, b) => {
      if (a.earliestOpenTargetDate && b.earliestOpenTargetDate) {
        const dateOrder = a.earliestOpenTargetDate.localeCompare(b.earliestOpenTargetDate);
        if (dateOrder !== 0) return dateOrder;
      } else if (a.earliestOpenTargetDate) {
        return -1;
      } else if (b.earliestOpenTargetDate) {
        return 1;
      }
      return a.firstSortOrder - b.firstSortOrder;
    })
    .map((group) => ({
      key: group.key,
      title: group.title,
      steps: group.steps,
      actionCount: group.actionCount,
      completedActionCount: group.completedActionCount,
      earliestOpenTargetDate: group.earliestOpenTargetDate,
    }));
}
