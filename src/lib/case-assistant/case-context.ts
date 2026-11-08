import { schoolDate, SCHOOL_TIME_ZONE } from "@/lib/dates";
import type { FamilyDetail } from "@/types/family";
import { actionTargetDate, actionUiStatus, actionUserNotes } from "@/lib/domain/plan/action-state";
import { selectNextFamilyWork } from "@/lib/domain/family-workspace/next-work";
import { getPlanReviewStatus } from "@/lib/domain/plan/review-status";
import { buildCaseFacts, serializeCaseContext } from "@/lib/ai/case-facts";

const MAX_CONTEXT_CHARS = 70_000;

/** A bounded snapshot, separate from directory facts and chat history. No account/author identifiers. */
export function buildAssistantCaseContext(detail: FamilyDetail, now = new Date()): string {
  const today = schoolDate(now);
  const allSteps = detail.plan?.steps ?? [];
  const allActions = allSteps.flatMap(step => (step.action_items ?? []).map(action => ({ step, action })));
  allActions.sort((a, b) => {
    const completed = Number(a.action.status === "completed") - Number(b.action.status === "completed");
    if (completed) return completed;
    if (a.action.status === "completed") return b.action.updated_at.localeCompare(a.action.updated_at);
    return (actionTargetDate(a.action) ?? "9999-12-31").localeCompare(actionTargetDate(b.action) ?? "9999-12-31") || a.step.sort_order - b.step.sort_order || a.action.sort_order - b.action.sort_order;
  });
  const next = selectNextFamilyWork(allSteps);
  const context = {
    ...buildCaseFacts(detail),
    as_of: today, date_timezone: SCHOOL_TIME_ZONE,
    plan: detail.plan ? { id: detail.plan.id, version: detail.plan.version, revision: detail.plan.review_revision, review: getPlanReviewStatus(detail.plan), generation: detail.plan.generation_state?.status ?? "complete" } : null,
    next_by_due_date: next,
    goals: allSteps.map(step => ({ id: step.id, title: step.title, goal: step.details?.stage_goal, summary: step.description,
      owner: step.details?.owner ?? "case_manager", status: step.status, expected_result: step.details?.expected_outcome,
      waiting_reason: step.workflow_data?.blocker_reason, progress: step.workflow_data?.outcome_notes })),
    actions: allActions.map(({ step, action }) => {
      const date = actionTargetDate(action);
      return { id: action.id, goal_id: step.id, title: action.title, description: action.description, status: actionUiStatus(action),
        target_date: action.target_date, follow_up_date: action.follow_up_date, effective_date: date,
        completion_date: null,
        overdue: action.status !== "completed" && date !== null && date < today,
        notes: actionUserNotes(action.notes), outcome: action.outcome, updated_at: action.updated_at };
    }),
  };
  return serializeCaseContext(context, MAX_CONTEXT_CHARS);
}
