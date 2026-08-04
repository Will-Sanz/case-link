import type {
  CaseProgressPlanChange,
  PlanStepActionItemRow,
  PlanWithSteps,
} from "@/types/family";

export type ProgressActionOption = {
  action: PlanStepActionItemRow;
  goal: string;
  stepTitle: string;
  effectiveDate: string | null;
};

/** Open dated actions in the order a case manager is most likely to discuss them. */
export function listProgressActionOptions(plan: PlanWithSteps): ProgressActionOption[] {
  return plan.steps
    .flatMap((step) =>
      (step.action_items ?? [])
        .filter((action) => action.status !== "completed")
        .map((action) => ({
          action,
          goal: step.details?.stage_goal?.trim() || step.title.trim(),
          stepTitle: step.title.trim(),
          effectiveDate:
            action.status === "blocked"
              ? action.follow_up_date ?? action.target_date
              : action.target_date,
          stepOrder: step.sort_order,
        })),
    )
    .sort((a, b) => {
      if (a.effectiveDate && b.effectiveDate && a.effectiveDate !== b.effectiveDate) {
        return a.effectiveDate.localeCompare(b.effectiveDate);
      }
      if (a.effectiveDate && !b.effectiveDate) return -1;
      if (!a.effectiveDate && b.effectiveDate) return 1;
      return a.stepOrder - b.stepOrder || a.action.sort_order - b.action.sort_order;
    })
    .map((item) => ({
      action: item.action,
      goal: item.goal,
      stepTitle: item.stepTitle,
      effectiveDate: item.effectiveDate,
    }));
}

export function progressStatusLabel(status: string): string {
  if (status === "in_progress") return "In progress";
  if (status === "blocked") return "Waiting";
  if (status === "completed") return "Completed";
  return "Not started";
}

export function describeProgressChange(change: CaseProgressPlanChange): string[] {
  const descriptions: string[] = [];
  if (change.previous.status !== change.current.status) {
    descriptions.push(
      `${progressStatusLabel(change.previous.status)} → ${progressStatusLabel(change.current.status)}`,
    );
  }
  if (change.previous.target_date !== change.current.target_date) {
    descriptions.push(
      change.current.target_date
        ? `Target ${change.current.target_date}`
        : "Target date cleared",
    );
  }
  if (change.previous.follow_up_date !== change.current.follow_up_date) {
    descriptions.push(
      change.current.follow_up_date
        ? `Follow up ${change.current.follow_up_date}`
        : "Follow-up date cleared",
    );
  }
  if (change.previous.notes !== change.current.notes) descriptions.push("Progress note updated");
  if (change.previous.outcome !== change.current.outcome) descriptions.push("Outcome updated");
  return descriptions.length > 0 ? descriptions : ["Action reviewed"];
}
