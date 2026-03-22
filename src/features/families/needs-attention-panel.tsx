"use client";

import Link from "next/link";
import type { NeedsAttentionItem } from "@/lib/services/workflow";
import { cn } from "@/lib/utils/cn";

const TYPE_LABELS: Record<NeedsAttentionItem["type"], string> = {
  overdue: "Overdue",
  blocked: "Blocked",
  follow_up_today: "Due today",
  follow_up_soon: "Due soon",
  escalation: "Escalation",
  in_progress: "In progress",
  no_activity: "No recent activity",
  new_plan: "New plan",
};

const TYPE_STYLES: Record<NeedsAttentionItem["type"], string> = {
  overdue: "border-red-200 bg-red-50/50",
  blocked: "border-amber-200 bg-amber-50/50",
  follow_up_today: "border-blue-200 bg-blue-50/50",
  follow_up_soon: "border-slate-200 bg-slate-50/50",
  escalation: "border-amber-300 bg-amber-50/80",
  in_progress: "border-blue-200 bg-blue-50/30",
  no_activity: "border-slate-200 bg-slate-50/50",
  new_plan: "border-blue-200 bg-blue-50/30",
};

export function NeedsAttentionPanel({
  items,
  familyId,
  compact = false,
}: {
  items: NeedsAttentionItem[];
  familyId?: string;
  compact?: boolean;
}) {
  const filtered = familyId ? items.filter((i) => i.family_id === familyId) : items;
  if (filtered.length === 0) return null;

  const grouped = filtered.reduce(
    (acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push(item);
      return acc;
    },
    {} as Record<NeedsAttentionItem["type"], NeedsAttentionItem[]>,
  );

  const order: NeedsAttentionItem["type"][] = [
    "overdue",
    "follow_up_today",
    "blocked",
    "escalation",
    "follow_up_soon",
    "in_progress",
    "new_plan",
    "no_activity",
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-medium text-slate-500">
          Needs attention
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">
          {familyId
            ? "Items requiring action on this case"
            : "Overdue, blocked, and follow-ups across your caseload"}
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {order.map((type) => {
          const group = grouped[type];
          if (!group?.length) return null;
          return (
            <li key={type}>
              <div className="px-4 py-2 sm:px-5">
                <p className="text-xs font-medium text-slate-500">
                  {TYPE_LABELS[type]}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {group.map((item, idx) => (
                    <li key={`${item.family_id}-${item.step_id ?? "na"}-${idx}`}>
                      <Link
                        href={
                          item.step_id
                            ? `/families/${item.family_id}#step-${item.step_id}`
                            : `/families/${item.family_id}`
                        }
                        className={cn(
                          "block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-slate-50",
                          TYPE_STYLES[type],
                        )}
                      >
                        <span className="font-medium text-slate-900">
                          {item.family_name}
                        </span>
                        {item.step_title ? (
                          <>
                            {" — "}
                            <span className="text-slate-700">
                              {item.step_title}
                            </span>
                          </>
                        ) : null}
                        {item.days_overdue != null ? (
                          <span className="ml-1 text-red-700">
                            ({item.days_overdue}d overdue)
                          </span>
                        ) : null}
                        {item.days_since_activity != null ? (
                          <span className="ml-1 text-slate-600">
                            (no activity in {item.days_since_activity} days)
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
