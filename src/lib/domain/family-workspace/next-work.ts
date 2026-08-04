import type {
  FamilyWithCurrentStep,
  PlanStepActionItemRow,
  PlanStepDetails,
  PlanStepWorkflowData,
} from "@/types/family";

type WorkStep = {
  id: string;
  title: string;
  phase: string;
  status: string;
  due_date: string | null;
  sort_order: number;
  details?: PlanStepDetails | null;
  workflow_data?: PlanStepWorkflowData | null;
  action_items?: PlanStepActionItemRow[];
};

const OPEN_STATUSES = new Set(["pending", "in_progress", "blocked"]);

function compareOptionalDates(a: string | null, b: string | null): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Select the single clearest next action for a family list row. */
export function selectNextFamilyWork(
  steps: readonly WorkStep[],
): FamilyWithCurrentStep["current_step"] {
  const actionCandidates = steps.flatMap((step) =>
    (step.action_items ?? [])
      .filter((action) => OPEN_STATUSES.has(action.status))
      .map((action) => ({ step, action })),
  );

  actionCandidates.sort((a, b) => {
    const dateOrder = compareOptionalDates(a.action.target_date, b.action.target_date);
    if (dateOrder !== 0) return dateOrder;
    if (a.step.sort_order !== b.step.sort_order) {
      return a.step.sort_order - b.step.sort_order;
    }
    return a.action.sort_order - b.action.sort_order;
  });

  const nextAction = actionCandidates[0];
  if (nextAction) {
    const { step, action } = nextAction;
    return {
      id: step.id,
      title: step.title,
      phase: step.phase,
      status: action.status,
      due_date: action.target_date,
      action_needed_now: action.title,
      is_blocked: action.status === "blocked" || step.status === "blocked",
      is_escalated: Boolean(step.workflow_data?.needs_escalation),
    };
  }

  const nextStep = steps
    .filter((step) => OPEN_STATUSES.has(step.status))
    .toSorted((a, b) => {
      const dateOrder = compareOptionalDates(a.due_date, b.due_date);
      return dateOrder !== 0 ? dateOrder : a.sort_order - b.sort_order;
    })[0];

  if (!nextStep) return null;

  return {
    id: nextStep.id,
    title: nextStep.title,
    phase: nextStep.phase,
    status: nextStep.status,
    due_date: nextStep.due_date,
    action_needed_now: nextStep.details?.action_needed_now || nextStep.title,
    is_blocked: nextStep.status === "blocked",
    is_escalated: Boolean(nextStep.workflow_data?.needs_escalation),
  };
}
