import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-2)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
