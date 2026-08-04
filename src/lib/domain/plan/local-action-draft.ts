import type { PlanStepRow } from "@/types/family";

export type LocalActionDraft = {
  v: 1;
  planId: string;
  savedAt: string;
  step: PlanStepRow;
};

export function localActionDraftKey(planId: string): string {
  return `caselink:local-action-draft:${planId}`;
}

export function serializeLocalActionDraft(
  planId: string,
  step: PlanStepRow,
  savedAt = new Date().toISOString(),
): string {
  return JSON.stringify({ v: 1, planId, savedAt, step } satisfies LocalActionDraft);
}

export function parseLocalActionDraft(value: string | null): LocalActionDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LocalActionDraft>;
    if (
      parsed.v !== 1 ||
      typeof parsed.planId !== "string" ||
      typeof parsed.savedAt !== "string" ||
      !parsed.step ||
      typeof parsed.step.id !== "string" ||
      typeof parsed.step.title !== "string" ||
      !Array.isArray(parsed.step.action_items)
    ) {
      return null;
    }
    return parsed as LocalActionDraft;
  } catch {
    return null;
  }
}
