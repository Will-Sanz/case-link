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
  no_activity: "No recent activity",
  new_plan: "New plan",
};

const TYPE_STYLES: Record<NeedsAttentionItem["type"], string> = {
  overdue: "border-red-200 bg-red-50/80 hover:bg-red-50",
  blocked: "border-amber-200 bg-amber-50/80 hover:bg-amber-50",
  follow_up_today: "border-teal-200 bg-teal-50/80 hover:bg-teal-50",
  follow_up_soon: "border-slate-200 bg-slate-50/80 hover:bg-slate-50",
  escalation: "border-amber-300 bg-amber-50/90 hover:bg-amber-50",
  no_activity: "border-slate-200 bg-slate-50/80 hover:bg-slate-50",
  new_plan: "border-teal-200 bg-teal-50/60 hover:bg-teal-50",
};

const ORDER: NeedsAttentionItem["type"][] = [
  "overdue",
  "follow_up_today",
  "blocked",
  "escalation",
  "follow_up_soon",
  "new_plan",
  "no_activity",
];

/** Action-first command center: what needs attention right now. One-click into work. */
export function CaseCommandCenter({
  items,
  familyId,
}: {
  items: NeedsAttentionItem[];
  familyId: string;
}) {
  const filtered = items.filter((i) => i.family_id === familyId).slice(0, 6);
  if (filtered.length === 0) return null;

  const sorted = [...filtered].sort(
    (a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)
  );

  return (
    <section
      className="rounded-2xl border-2 border-teal-200 bg-gradient-to-br from-teal-50/90 to-white shadow-lg shadow-slate-900/[0.03]"
      aria-labelledby="command-center-heading"
    >
      <div className="border-b border-teal-100 px-5 py-4 sm:px-6">
        <h2
          id="command-center-heading"
          className="text-base font-bold tracking-tight text-slate-900 sm:text-lg"
        >
          Action needed now
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">
          Today&apos;s priorities for this case — click to open the step
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {sorted.map((item, idx) => {
          const href = item.step_id
            ? `/families/${familyId}#step-${item.step_id}`
            : `/families/${familyId}`;
          const actionTitle =
            item.action_item_title ?? item.step_title ?? item.family_name;
          const badge = TYPE_LABELS[item.type];
          return (
            <li key={`${item.family_id}-${item.step_id ?? "na"}-${idx}`}>
              <Link
                href={href}
                className={cn(
                  "flex items-center justify-between gap-3 px-5 py-3.5 transition-colors sm:px-6",
                  TYPE_STYLES[item.type]
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{actionTitle}</p>
                  {(item.days_overdue != null && item.days_overdue > 0) ||
                  item.days_since_activity != null ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {item.days_overdue != null && item.days_overdue > 0
                        ? `${item.days_overdue} days overdue`
                        : item.days_since_activity != null
                          ? `No activity in ${item.days_since_activity} days`
                          : null}
                    </p>
                  ) : item.due_date ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      Due{" "}
                      {new Date(item.due_date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      item.type === "overdue" && "bg-red-200/80 text-red-900",
                      item.type === "follow_up_today" &&
                        "bg-teal-200/80 text-teal-900",
                      item.type === "blocked" && "bg-amber-200/80 text-amber-900",
                      item.type === "escalation" &&
                        "bg-amber-200/80 text-amber-900",
                      (item.type === "follow_up_soon" ||
                        item.type === "no_activity") &&
                        "bg-slate-200/80 text-slate-700",
                      item.type === "new_plan" && "bg-teal-200/80 text-teal-900"
                    )}
                  >
                    {badge}
                  </span>
                  <span className="text-xs font-medium text-teal-700">
                    Open →
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
