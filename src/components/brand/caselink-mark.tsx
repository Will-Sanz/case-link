import { Link as Link2 } from "iconoir-react";
import { cn } from "@/lib/utils/cn";

export function CaseLinkMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-[9px] bg-[var(--color-accent)] text-[var(--color-accent-ink)] [box-shadow:var(--shadow-action)]",
        className,
      )}
    >
      <Link2 className="size-6" strokeWidth={2.25} />
    </span>
  );
}

export function CaseLinkWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <CaseLinkMark />
      <span className="font-[family-name:var(--font-display)] text-[1.75rem] font-[560] leading-none tracking-[-0.025em] text-[var(--color-ink)]">
        CaseLink
      </span>
    </span>
  );
}
