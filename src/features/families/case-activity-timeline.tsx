"use client";

import type { CaseActivityItem } from "@/lib/services/workflow";

const ACTION_LABELS: Record<string, string> = {
  "plan.generated": "Plan generated",
  "plan.regenerated": "Plan regenerated",
  "step.added": "Step added",
  "step.edited": "Step edited",
  "step.deleted": "Step deleted",
  "step.status_changed": "Status changed",
  "step.escalation_flagged": "Escalation flagged",
  "step.activity_logged": "Activity logged",
  "step.completed": "Step completed",
  "step.refined": "Step refined",
  "matching.run": "Resource matching run",
  "matching.accepted": "Resource accepted",
  "matching.dismissed": "Resource dismissed",
  "matching.manual_add": "Resource added manually",
  "matching.linked_to_step": "Resource linked to plan step",
  "matching.unlinked_from_step": "Resource unlinked from step",
  "note.added": "Case note added",
  "context.updated": "Context updated",
};

function formatDt(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatRelative(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDt(iso);
  } catch {
    return iso;
  }
}

export function CaseActivityTimeline({
  items,
  maxItems = 20,
}: {
  items: CaseActivityItem[];
  maxItems?: number;
}) {
  const visible = items.slice(0, maxItems);

  return (
    <section className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-rule-soft)] px-4 py-3 sm:px-5">
        <h2 className="text-sm font-medium text-[var(--color-ink-faint)]">
          Case activity
        </h2>
        <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
          Chronological record of actions on this case.
        </p>
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--color-ink-faint)] sm:px-5">
          No activity recorded yet.
        </p>
      ) : (
      <ul className="divide-y divide-[var(--color-rule-soft)]">
        {visible.map((item) => (
          <li key={item.id} className="px-4 py-3 sm:px-5">
            <div className="flex gap-3">
              <div className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--color-ink-strong)]">
                  {ACTION_LABELS[item.action] ?? item.action.replace(/\./g, " ")}
                  {item.actor_email ? (
                    <span className="text-[var(--color-ink-faint)]"> · {item.actor_email}</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                  {formatRelative(item.created_at)}
                  <span className="sr-only"> ({formatDt(item.created_at)})</span>
                </p>
                {item.details && Object.keys(item.details).length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {JSON.stringify(item.details)
                      .replace(/[{}"]/g, " ")
                      .replace(/,/g, " · ")
                      .trim()}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
