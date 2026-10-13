import type { FamilyDetail } from "@/types/family";
import { actionTargetDate, actionUiStatus, actionUserNotes } from "@/lib/domain/plan/action-state";
import { selectNextFamilyWork } from "@/lib/domain/family-workspace/next-work";
import { getPlanReviewStatus } from "@/lib/domain/plan/review-status";

const MAX_CONTEXT_CHARS = 70_000;

/** A bounded snapshot, separate from directory facts and chat history. No account/author identifiers. */
export function buildAssistantCaseContext(detail: FamilyDetail, now = new Date()): string {
  let shortened = false;
  const clip = (value: string | null | undefined, max = 500) => {
    if (value == null) return null;
    if (value.length <= max) return value;
    shortened = true;
    return `${value.slice(0, max)}… [shortened]`;
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
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
    as_of: today, date_timezone: "America/New_York", case_updated_at: detail.updated_at,
    summary: clip(detail.summary, 2000), circumstances: clip(detail.household_notes, 2000), urgency: detail.urgency,
    stated_goals: detail.goals.slice(0, 20).map(goal => clip(goal.label)), barriers: detail.barriers.slice(0, 20).map(barrier => clip(barrier.label)),
    plan: detail.plan ? { id: detail.plan.id, version: detail.plan.version, revision: detail.plan.review_revision, review: getPlanReviewStatus(detail.plan), generation: detail.plan.generation_state?.status ?? "complete" } : null,
    next_by_due_date: next ? { ...next, title: clip(next.title), action_needed_now: clip(next.action_needed_now) } : null,
    goals: allSteps.slice(0, 15).map(step => ({ id: step.id, title: clip(step.title), goal: clip(step.details?.stage_goal), summary: clip(step.description),
      owner: step.details?.owner ?? "case_manager", status: step.status, expected_result: clip(step.details?.expected_outcome),
      waiting_reason: clip(step.workflow_data?.blocker_reason), progress: clip(step.workflow_data?.outcome_notes) })),
    actions: allActions.slice(0, 40).map(({ step, action }) => {
      const date = actionTargetDate(action);
      return { id: action.id, goal_id: step.id, title: clip(action.title), description: clip(action.description), status: actionUiStatus(action),
        target_date: action.target_date, follow_up_date: action.follow_up_date, effective_date: date,
        overdue: action.status !== "completed" && date !== null && date < today,
        notes: clip(actionUserNotes(action.notes)), outcome: clip(action.outcome), updated_at: action.updated_at };
    }),
    recent_meetings: (detail.progressUpdates ?? []).toSorted((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).slice(0, 5).map(update => ({
      id: update.id, occurred_on: update.occurred_on, recorded_at: update.created_at, plan_id: update.plan_id, summary: clip(update.summary, 800),
      affected_actions: update.plan_changes.slice(0, 20).map(change => change.action_item_id),
    })),
    recent_notes: detail.caseNotes.toSorted((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5).map(note => ({ id: note.id, recorded_at: note.created_at, text: clip(note.body, 800) })),
    limits: { actions_total: allActions.length, goals_total: allSteps.length, actions_omitted: 0, goals_omitted: Math.max(0, allSteps.length - 15),
      meetings_omitted: Math.max(0, (detail.progressUpdates?.length ?? 0) - 5), notes_omitted: Math.max(0, detail.caseNotes.length - 5), stated_goals_omitted: Math.max(0, detail.goals.length - 20), barriers_omitted: Math.max(0, detail.barriers.length - 20), shortened_text: false },
  };
  // Keep earliest open work before recent completed work when the character budget is tight.
  while (JSON.stringify(context).length > MAX_CONTEXT_CHARS - 200) {
    if (context.goals.length > 1) context.goals.pop();
    else if (context.actions.length) context.actions.pop();
    else break;
  }
  context.limits.goals_omitted = allSteps.length - context.goals.length;
  context.limits.actions_omitted = allActions.length - context.actions.length;
  context.limits.shortened_text = shortened;
  return JSON.stringify(context);
}
