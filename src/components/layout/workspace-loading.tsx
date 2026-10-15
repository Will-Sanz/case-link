"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export function WorkspaceLoading() {
  const pathname = usePathname();
  const familyWorkspace = /^\/families\/[^/]+\//.test(pathname ?? "");
  return (
    <div className={cn("w-full space-y-8", familyWorkspace && "px-4 py-7 sm:px-6 lg:px-8 lg:py-10")}>
      <p role="status" className="text-sm font-medium text-[var(--color-ink-muted)]">Loading workspace…</p>
      <div aria-hidden="true" className="space-y-8 motion-safe:animate-pulse">
        <div className="space-y-3">
          <div className="h-8 w-48 rounded bg-[var(--color-rule)]" />
          <div className="h-4 w-72 max-w-full rounded bg-[var(--color-rule-soft)]" />
        </div>
        <div className="min-h-80 space-y-6 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-6">
          <div className="h-5 w-36 rounded bg-[var(--color-rule)]" />
          <div className="h-12 rounded-lg bg-[var(--color-paper-2)]" />
          <div className="h-12 rounded-lg bg-[var(--color-paper-2)]" />
          <div className="h-12 w-2/3 rounded-lg bg-[var(--color-paper-2)]" />
        </div>
      </div>
    </div>
  );
}
