import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--color-rule)] bg-[var(--card-bg)] p-5 transition-colors duration-[var(--dur-short)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2 className={cn("text-sm font-semibold text-[var(--color-ink)]", className)}>
      {children}
    </h2>
  );
}
