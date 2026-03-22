"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

export type StepStatus = "pending" | "in_progress" | "completed" | "blocked";

const STATUS_LABELS: Record<StepStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  completed: "Complete",
  blocked: "Blocked",
};

const STATUS_CLASSES: Record<StepStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-amber-100 text-amber-900",
  completed: "bg-emerald-100 text-emerald-900",
  blocked: "bg-red-100 text-red-900",
};

export function StepStatusBadge({
  status,
  onChange,
  disabled,
  className,
}: {
  status: StepStatus;
  onChange?: (status: StepStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const cls = STATUS_CLASSES[status] ?? STATUS_CLASSES.pending;
  const label = STATUS_LABELS[status] ?? status.replace("_", " ");

  if (onChange && !disabled) {
    return (
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as StepStatus)}
        className={cn(
          "rounded-md border-0 px-2 py-0.5 text-xs font-medium focus:ring-2 focus:ring-teal-600/25 cursor-pointer",
          cls,
          className,
        )}
        title="Update step status"
      >
        <option value="pending">{STATUS_LABELS.pending}</option>
        <option value="in_progress">{STATUS_LABELS.in_progress}</option>
        <option value="completed">{STATUS_LABELS.completed}</option>
        <option value="blocked">{STATUS_LABELS.blocked}</option>
      </select>
    );
  }

  return <Badge className={cn(cls, className)}>{label}</Badge>;
}

/** Compact progress display: "2 of 5" with optional progress bar */
export function ChecklistProgressBadge({
  completed,
  total,
  showBar = false,
  className,
}: {
  completed: number;
  total: number;
  showBar?: boolean;
  className?: string;
}) {
  if (total === 0) return null;

  const pct = total > 0 ? (completed / total) * 100 : 0;
  const allDone = completed >= total;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "text-xs font-medium",
          allDone ? "text-emerald-700" : "text-slate-600",
        )}
      >
        {completed} of {total}
      </span>
      {showBar && (
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              allDone ? "bg-emerald-500" : "bg-amber-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
