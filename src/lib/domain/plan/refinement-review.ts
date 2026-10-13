import type { PlanStepActionItemRow, PlanStepDetails, PlanStepRow } from "@/types/family";
import type { DraftStepRefineInput } from "@/lib/plan-generator/plan-refine-lean";
import { matchPlanRowsById } from "./refinement-identity";

export type RefinementChange = {
  id: string;
  stepId: string;
  label: string;
  before: string;
  after: string;
  stepPatch?: Pick<Partial<PlanStepRow>, "title" | "description" | "priority">;
  detailsPatch?: Pick<Partial<PlanStepDetails>, "required_documents" | "materials_needed" | "contacts" | "expected_outcome" | "timing_guidance" | "priority">;
  actionPatch?: { id: string; fields: Pick<Partial<PlanStepActionItemRow>, "title" | "description" | "target_date" | "follow_up_date"> };
};

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join("\n") || "None";
  if (value && typeof value === "object") return Object.values(value).filter(Boolean).join(" · ");
  return value == null || value === "" ? "Not set" : String(value);
}

export function toRefinementDraft(step: PlanStepRow): DraftStepRefineInput {
  return {
    id: step.id, updated_at: step.updated_at, status: step.status, phase: step.phase,
    title: step.title, description: step.description, details: step.details ?? {}, workflow_data: step.workflow_data ?? {},
    action_items: (step.action_items ?? []).map(action => ({ id: action.id, updated_at: action.updated_at,
      title: action.title, description: action.description, week_index: action.week_index, target_date: action.target_date,
      status: action.status, notes: action.notes, outcome: action.outcome, follow_up_date: action.follow_up_date })),
  };
}

/** Only these content fields can become proposals; progress and completed work are never patched. */
export function collectRefinementChanges(base: PlanStepRow[], proposed: DraftStepRefineInput[]): RefinementChange[] {
  const matched = matchPlanRowsById(base, proposed);
  const changes: RefinementChange[] = [];
  base.forEach((step, i) => {
    const next = matched[i];
    if (step.phase !== next.phase) throw new Error("The preview changed the goal structure. Request a smaller edit.");
    const actions = matchPlanRowsById(step.action_items ?? [], next.action_items);
    if (step.status === "completed") return;
    const add = (key: string, label: string, before: unknown, after: unknown, patch: Partial<RefinementChange>) => {
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;
      changes.push({ id: `${step.id}:${key}`, stepId: step.id, label: `${step.title} — ${label}`, before: display(before), after: display(after), ...patch });
    };
    for (const [field, label] of [["title", "Title"], ["description", "Summary"]] as const) {
      add(field, label, step[field], next[field], { stepPatch: { [field]: next[field] } });
    }
    for (const [field, label] of [["required_documents", "Documents"], ["contacts", "Contacts"], ["expected_outcome", "Expected result"], ["timing_guidance", "Timing guidance"]] as const) {
      // Unchanged draft details may omit optional fields; omission must never erase a human value.
      if (next.details[field] === undefined) continue;
      if (field === "required_documents") {
        if (JSON.stringify(step.details?.required_documents ?? []) !== JSON.stringify(next.details.required_documents) || JSON.stringify(step.details?.materials_needed) !== JSON.stringify(next.details.materials_needed)) {
          add(field, label, [...(step.details?.required_documents ?? []), ...(step.details?.materials_needed ?? [])], next.details.required_documents,
            { detailsPatch: { required_documents: next.details.required_documents, materials_needed: undefined } });
        }
        continue;
      }
      add(field, label, step.details?.[field], next.details[field], { detailsPatch: { [field]: next.details[field] } });
    }
    if (next.details.priority !== undefined) {
      add("priority", "Priority", step.priority ?? step.details?.priority, next.details.priority,
        { stepPatch: { priority: next.details.priority }, detailsPatch: { priority: next.details.priority } });
    }
    (step.action_items ?? []).forEach((action, j) => {
      if (action.status === "completed") return;
      const proposal = actions[j];
      for (const [field, label] of [["title", "Task title"], ["description", "Task description"]] as const) {
        add(`${action.id}:${field}`, `${action.title} — ${label}`, action[field], proposal[field],
          { actionPatch: { id: action.id, fields: { [field]: proposal[field] ?? null } } });
      }
      if (proposal.target_date) {
        add(`${action.id}:target_date`, `${action.title} — ${action.status === "blocked" ? "Follow-up date" : "Target date"}`,
          action.status === "blocked" ? action.follow_up_date : action.target_date, proposal.target_date,
          { actionPatch: { id: action.id, fields: { target_date: proposal.target_date, ...(action.status === "blocked" ? { follow_up_date: proposal.target_date } : {}) } } });
      }
    });
  });
  return changes;
}

export function applyRefinementChanges(base: PlanStepRow[], changes: RefinementChange[], selected: string[]): PlanStepRow[] {
  const chosen = new Set(selected);
  return base.map(step => changes.filter(change => change.stepId === step.id && chosen.has(change.id)).reduce((draft, change) => ({
    ...draft, ...change.stepPatch,
    ...(change.detailsPatch ? { details: { ...draft.details, ...change.detailsPatch } } : {}),
    ...(change.actionPatch ? { action_items: draft.action_items?.map(action => action.id === change.actionPatch!.id ? { ...action, ...change.actionPatch!.fields } : action) } : {}),
  }), step));
}
