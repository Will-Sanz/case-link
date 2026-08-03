import type { FamilyDetail } from "@/types/family";
import type { PdfFieldDescriptor, PdfFieldMapping } from "@/types/paperwork";

export type PaperworkSource = {
  familySummary: string;
  currentCircumstances: string;
  goals: string[];
  barriers: string[];
  planSummary: string;
  planSteps: Array<{ phase: string; title: string; description: string; action: string }>;
};

export function buildPaperworkSource(family: FamilyDetail): PaperworkSource {
  return {
    familySummary: family.summary?.trim() ?? "",
    currentCircumstances: family.household_notes?.trim() ?? "",
    goals: family.goals.map((goal) => goal.label.trim()).filter(Boolean),
    barriers: family.barriers.map((barrier) => barrier.label.trim()).filter(Boolean),
    planSummary: family.plan?.summary?.trim() ?? "",
    planSteps: (family.plan?.steps ?? []).map((step) => ({
      phase: step.phase,
      title: step.title.trim(),
      description: step.description.trim(),
      action: step.details?.action_needed_now?.trim() ?? "",
    })),
  };
}

function clip(value: string, maxLength: number | null): string {
  return maxLength && maxLength > 0 ? value.slice(0, maxLength) : value;
}

/** Safe, deterministic mappings used when a field name clearly names a CaseLink source. */
export function createDeterministicMappings(fields: PdfFieldDescriptor[], source: PaperworkSource): PdfFieldMapping[] {
  const firstPlanAction = source.planSteps.find((step) => step.action)?.action ?? source.planSteps[0]?.description ?? "";
  const allPlanActions = source.planSteps.map((step) => `${step.phase}-day: ${step.action || step.description}`).filter((value) => !value.endsWith(": ")).join("\n");

  return fields.map((field) => {
    const key = field.name.toLowerCase().replace(/[_\-.]+/g, " ");
    let value = "";
    let sourceLabel = "No confident source found";
    if (/barrier|challenge|primary need|presenting need/.test(key) && source.barriers.length) {
      value = source.barriers.join(", ");
      sourceLabel = "Current barriers";
    } else if (/goal|desired outcome/.test(key) && source.goals.length) {
      value = source.goals.join(", ");
      sourceLabel = "Family goals";
    } else if (/circumstance|situation|case context|family context/.test(key) && source.currentCircumstances) {
      value = source.currentCircumstances;
      sourceLabel = "Current circumstances";
    } else if (/summary|assessment/.test(key) && (source.familySummary || source.planSummary)) {
      value = source.familySummary || source.planSummary;
      sourceLabel = source.familySummary ? "Family summary" : "Reviewed plan summary";
    } else if (/30.?day|first action|immediate action|next step/.test(key) && firstPlanAction) {
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
