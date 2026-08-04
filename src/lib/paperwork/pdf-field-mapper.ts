import type { FamilyDetail } from "@/types/family";
import type { PdfFieldDescriptor, PdfFieldMapping } from "@/types/paperwork";

export type PaperworkSource = {
  familySummary: string;
  currentCircumstances: string;
  goals: string[];
  barriers: string[];
  planSummary: string;
  planActions: Array<{
    goal: string;
    title: string;
    description: string;
    targetDate: string;
    status: string;
    expectedOutcome: string;
  }>;
};

export function buildPaperworkSource(family: FamilyDetail): PaperworkSource {
  return {
    familySummary: family.summary?.trim() ?? "",
    currentCircumstances: family.household_notes?.trim() ?? "",
    goals: [
      ...family.goals.map((goal) => goal.label.trim()),
      ...(family.plan?.steps ?? []).map((step) => step.details?.stage_goal?.trim() ?? ""),
    ].filter((goal, index, all) => Boolean(goal) && all.indexOf(goal) === index),
    barriers: family.barriers.map((barrier) => barrier.label.trim()).filter(Boolean),
    planSummary: family.plan?.summary?.trim() ?? "",
    planActions: (family.plan?.steps ?? []).flatMap((step) => {
      const goal = step.details?.stage_goal?.trim() || step.title.trim();
      const expectedOutcome = step.details?.expected_outcome?.trim() ?? "";
      const actions = step.action_items ?? [];
      if (actions.length === 0) {
        return [{
          goal,
          title: step.details?.action_needed_now?.trim() || step.title.trim(),
          description: step.description.trim(),
          targetDate: step.due_date?.slice(0, 10) ?? "",
          status: step.status,
          expectedOutcome,
        }];
      }
      return actions.map((action) => ({
        goal,
        title: action.title.trim(),
        description: action.description?.trim() ?? step.description.trim(),
        targetDate: action.target_date ?? "",
        status: action.status,
        expectedOutcome,
      }));
    }),
  };
}

function clip(value: string, maxLength: number | null): string {
  return maxLength && maxLength > 0 ? value.slice(0, maxLength) : value;
}

/** Safe, deterministic mappings used when a field name clearly names a CaseLink source. */
export function createDeterministicMappings(fields: PdfFieldDescriptor[], source: PaperworkSource): PdfFieldMapping[] {
  const firstPlanAction = source.planActions[0]?.title ?? "";
  const allPlanActions = source.planActions
    .map((action) =>
      [
        action.goal ? `${action.goal}: ${action.title}` : action.title,
        action.targetDate ? `target ${action.targetDate}` : null,
      ]
        .filter(Boolean)
        .join(" — "),
    )
    .filter(Boolean)
    .join("\n");

  return fields.map((field) => {
    const key = field.name.toLowerCase().replace(/[_\-.]+/g, " ");
    const ordinalMatch = key.match(/(?:#|number|no\.?|factor|goal|objective|strategy)?\s*([1-9]\d*)/);
    const ordinal = ordinalMatch ? Number(ordinalMatch[1]) - 1 : 0;
    const indexedBarrier = source.barriers[ordinal] ?? source.barriers[0] ?? "";
    const indexedGoal = source.goals[ordinal] ?? source.goals[0] ?? "";
    const indexedAction = source.planActions[ordinal] ?? source.planActions[0];
    let value = "";
    let sourceLabel = "No confident source found";
    if (/contributing factor|barrier|challenge|primary need|presenting need/.test(key) && source.barriers.length) {
      value = /(?:#|number|no\.?|factor)\s*[1-9]/.test(key) ? indexedBarrier : source.barriers.join(", ");
      sourceLabel = "Current barriers";
    } else if (/goal|desired outcome/.test(key) && source.goals.length) {
      value = /(?:#|number|no\.?|goal)\s*[1-9]/.test(key) ? indexedGoal : source.goals.join(", ");
      sourceLabel = "Reviewed plan goals";
    } else if (/case worker objective|case manager objective|strategy/.test(key) && indexedAction) {
      value = indexedAction.title;
      sourceLabel = "Reviewed plan action";
    } else if (/progress status|action status/.test(key) && indexedAction) {
      value = indexedAction.status.replace("_", " ");
      sourceLabel = "Current action status";
    } else if (/target date|due date/.test(key) && indexedAction?.targetDate) {
      value = indexedAction.targetDate;
      sourceLabel = "Reviewed action target date";
    } else if (/circumstance|situation|case context|family context/.test(key) && source.currentCircumstances) {
      value = source.currentCircumstances;
      sourceLabel = "Current circumstances";
    } else if (/summary|assessment/.test(key) && (source.familySummary || source.planSummary)) {
      value = source.familySummary || source.planSummary;
      sourceLabel = source.familySummary ? "Family summary" : "Reviewed plan summary";
    } else if (/first action|immediate action|next step/.test(key) && firstPlanAction) {
      value = firstPlanAction;
      sourceLabel = "Reviewed intervention plan";
    } else if (/intervention|action plan|service plan|plan steps/.test(key) && (allPlanActions || source.planSummary)) {
      value = allPlanActions || source.planSummary;
      sourceLabel = "Reviewed intervention plan";
    }

    return {
      fieldName: field.name,
      value: field.kind === "text" ? clip(value, field.maxLength) : "",
      confidence: value && field.kind === "text" ? "high" : "low",
      source: field.kind === "text" ? sourceLabel : "Confirm this field manually",
      needsReview: !value || field.kind !== "text",
    };
  });
}
