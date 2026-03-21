"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  ActionableItem,
  DashboardFamilySummary,
} from "@/lib/services/workflow";
import { cn } from "@/lib/utils/cn";

const PHASE_LABELS: Record<string, string> = {
  "30": "30-day",
  "60": "60-day",
  "90": "90-day",
};

export function SummaryCounts({
  counts,
}: {
  counts: { overdue: number; blocked: number; dueToday: number; escalated: number };
}) {
  const total = counts.overdue + counts.blocked + counts.dueToday + counts.escalated;
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {counts.overdue > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/60 px-4 py-2">
          <span className="text-sm font-medium text-red-900">Overdue</span>
          <Badge className="bg-red-200 text-red-900">{counts.overdue}</Badge>
        </div>
      ) : null}
      {counts.blocked > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2">
          <span className="text-sm font-medium text-amber-900">Blocked</span>
          <Badge className="bg-amber-200 text-amber-900">{counts.blocked}</Badge>
        </div>
      ) : null}
      {counts.dueToday > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-2">
          <span className="text-sm font-medium text-teal-900">Due today</span>
          <Badge className="bg-teal-200 text-teal-900">{counts.dueToday}</Badge>
        </div>
      ) : null}
      {counts.escalated > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-2">
          <span className="text-sm font-medium text-amber-900">Escalation</span>
          <Badge className="bg-amber-200 text-amber-900">{counts.escalated}</Badge>
        </div>
      ) : null}
    </div>
  );
}

export function DashboardFamilyCards({
  families,
}: {
  families: DashboardFamilySummary[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {families.map((f) => (
        <Card
          key={f.family_id}
          className={cn(
            "p-4 transition-shadow hover:shadow-md",
            f.current_step?.is_blocked && "border-amber-200",
            f.current_step?.is_escalated && "border-amber-300 ring-1 ring-amber-200/50",
          )}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{f.family_name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge
                    className={cn(
                      "text-xs",
                      f.urgency === "crisis" && "bg-red-100 text-red-900",
                      f.urgency === "high" && "bg-amber-100 text-amber-900",
                    )}
                  >
                    {f.urgency ?? "—"}
                  </Badge>
                  <Badge className="text-xs">{f.status}</Badge>
                </div>
              </div>
              <Link href={`/families/${f.family_id}`}>
                <Button type="button" variant="secondary" className="h-8 text-xs">
                  Open case
                </Button>
              </Link>
            </div>

            {f.current_step ? (
              <div className="rounded-lg bg-slate-50/80 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">
                  {PHASE_LABELS[f.current_step.phase] ?? f.current_step.phase} ·{" "}
                  {f.current_step.status.replace("_", " ")}
                </p>
                <p className="mt-0.5 font-medium text-slate-800">
                  {f.current_step.title}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {f.current_step.action_needed_now}
                </p>
                {f.current_step.due_date ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Follow-up:{" "}
                    {new Date(f.current_step.due_date).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" },
                    )}
                    {f.current_step.days_overdue != null &&
                    f.current_step.days_overdue > 0 ? (
                      <span className="text-red-600">
                        {" "}
                        ({f.current_step.days_overdue}d overdue)
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {(f.current_step.is_blocked || f.current_step.is_escalated) && (
                  <div className="mt-2 flex gap-2">
                    {f.current_step.is_blocked ? (
                      <Badge className="bg-amber-100 text-amber-900">
                        Blocked
                      </Badge>
                    ) : null}
                    {f.current_step.is_escalated ? (
                      <Badge className="bg-amber-100 text-amber-900">
                        Escalation
                      </Badge>
                    ) : null}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No active step — open case to continue
              </p>
            )}

            <Link
              href={
                f.current_step
                  ? `/families/${f.family_id}#step-${f.current_step.id}`
                  : `/families/${f.family_id}`
              }
              className="text-sm font-medium text-teal-700 hover:text-teal-900 hover:underline"
            >
              {f.current_step ? "Open current step →" : "Open case →"}
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function ActionableNowList({ items }: { items: ActionableItem[] }) {
  const typeStyles: Record<string, string> = {
    overdue: "border-red-200 bg-red-50/50",
    blocked: "border-amber-200 bg-amber-50/50",
    follow_up_today: "border-teal-200 bg-teal-50/50",
    follow_up_soon: "border-slate-200 bg-slate-50/50",
    escalation: "border-amber-300 bg-amber-50/80",
    no_activity: "border-slate-200 bg-slate-50/50",
    new_plan: "border-teal-200 bg-teal-50/30",
  };

  return (
    <ul className="space-y-2">
      {items.map((item, idx) => (
        <li key={`${item.family_id}-${item.step_id}-${idx}`}>
          <Link
            href={
              item.step_id
                ? `/families/${item.family_id}#step-${item.step_id}`
                : `/families/${item.family_id}`
            }
            className={cn(
              "block rounded-lg border px-4 py-3 text-sm transition-colors hover:shadow-sm",
              typeStyles[item.type] ?? "border-slate-200 bg-white",
            )}
          >
            <span className="font-medium text-slate-900">{item.family_name}</span>
            <span className="text-slate-700"> — </span>
            <span className="text-slate-700">{item.action}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CurrentStepByFamily({
  families,
}: {
  families: DashboardFamilySummary[];
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Family
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Current step
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Status
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Action needed
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Link
              </th>
            </tr>
          </thead>
          <tbody>
            {families.map((f) => (
              <tr
                key={f.family_id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/families/${f.family_id}`}
                    className="font-medium text-slate-900 hover:text-teal-800 hover:underline"
                  >
                    {f.family_name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {f.current_step ? (
                    <>
                      <span className="text-slate-500">
                        {PHASE_LABELS[f.current_step.phase] ?? f.current_step.phase}:
                      </span>{" "}
                      {f.current_step.title}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {f.current_step ? (
                    <span className="capitalize">
                      {f.current_step.status.replace("_", " ")}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {f.current_step?.action_needed_now ?? "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {f.current_step ? (
                    <Link
                      href={`/families/${f.family_id}#step-${f.current_step.id}`}
                      className="text-teal-700 hover:underline"
                    >
                      Open step
                    </Link>
                  ) : (
                    <Link
                      href={`/families/${f.family_id}`}
                      className="text-teal-700 hover:underline"
                    >
                      Open case
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
