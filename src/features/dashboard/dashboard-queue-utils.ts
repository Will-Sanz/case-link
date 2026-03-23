import type { ActionableItem } from "@/lib/services/workflow";
import { extractDueDateKey, todayKeyUtc } from "@/lib/dashboard/action-queue-buckets";
import {
  familyCaseOverviewHref,
  familyCaseStepHref,
} from "@/lib/routes/family-case";

export function getQueueCtaLabel(item: ActionableItem): string {
  if (!item.step_id) return "Open case";
  const cp = item.checklist_progress;
  const allDone = cp && cp.total > 0 && cp.completed >= cp.total;
  if (allDone) return "Complete step";
  if (item.step_status === "in_progress" || (cp && cp.completed > 0)) return "Continue step";
  if (item.step_status === "blocked") return "Resolve blocker";
  return "Start step";
}

/** Human-readable timing for queue row (aligned with bucket). */
export function formatQueueTiming(
  item: ActionableItem,
  bucket: "overdue" | "today" | "upcoming",
): string {
  if (bucket === "overdue") {
    if (item.days_overdue != null && item.days_overdue > 0) {
      return `${item.days_overdue}d overdue`;
    }
    const k = extractDueDateKey(item.due_date);
    return k ? `Due ${k}` : "Overdue";
  }
  if (bucket === "today") return "Due today";
  const k = extractDueDateKey(item.due_date);
  if (!k) return "Soon";
  const todayK = todayKeyUtc();
  const diffDays = Math.round(
    (Date.parse(`${k}T00:00:00.000Z`) - Date.parse(`${todayK}T00:00:00.000Z`)) /
      (1000 * 60 * 60 * 24),
  );
  if (diffDays === 1) return "Tomorrow";
  return `In ${diffDays}d`;
}

export function queueItemHref(item: ActionableItem): string {
  if (item.step_id) {
    return familyCaseStepHref(item.family_id, item.step_id);
  }
  return familyCaseOverviewHref(item.family_id);
}
