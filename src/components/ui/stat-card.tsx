import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function StatCard({
  label,
  value,
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-5",
        className,
      )}
    >
      <p className="text-xs font-medium text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </p>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </div>
  );
}
