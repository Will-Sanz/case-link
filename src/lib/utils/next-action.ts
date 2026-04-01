import type { FamilyDetail } from "@/types/family";
import type { NeedsAttentionItem } from "@/lib/services/workflow";

const TYPE_PRIORITY: Record<NeedsAttentionItem["type"], number> = {
  overdue: 0,
  follow_up_today: 1,
  blocked: 2,
  escalation: 3,
  follow_up_soon: 4,
  in_progress: 5,
  new_plan: 6,
  no_activity: 7,
};

/** Derive a short, concrete "next action" for a case */
export function getNextAction(
  family: FamilyDetail,
  needsAttention?: NeedsAttentionItem[],
): string | null {
  const familyItems = (needsAttention ?? family.needsAttention ?? []).filter(
    (i) => i.family_id === family.id,
  );
  const sorted = [...familyItems].sort(
    (a, b) => (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99),
  );

  const top = sorted[0];
  if (top) {
    if (top.action_item_title) return top.action_item_title;
    if (top.step_title) {
      const suffix = top.type === "overdue" && top.days_overdue
        ? ` (${top.days_overdue}d overdue)`
        : top.type === "follow_up_today"
          ? ", due today"
          : top.type === "blocked"
            ? ", blocked"
            : top.type === "in_progress"
              ? ", in progress"
              : "";
      return `${top.step_title}${suffix}`;
    }
    if (top.type === "no_activity" && top.days_since_activity != null) {
      return `Check in (no activity in ${top.days_since_activity} days)`;
    }
    if (top.type === "new_plan") return "Review new plan";
    return top.family_name;
  }

  const plan = family.plan;
  if (!plan?.steps?.length) return null;

  const activeStep = plan.steps.find(
    (s) => s.status === "in_progress" || s.status === "pending",
  );
  if (!activeStep) return null;

  const d = activeStep.details as { action_needed_now?: string } | null;
  const actionNow =
    d?.action_needed_now ??
    (activeStep.ai_helper_data as { action_needed_now?: string } | null)
      ?.action_needed_now;

  if (actionNow) return actionNow;

  const firstActionItem = activeStep.action_items?.find(
    (a) => a.status !== "completed",
  );
  if (firstActionItem?.title) return firstActionItem.title;

  return activeStep.title;
}
