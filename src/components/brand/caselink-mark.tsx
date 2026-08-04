import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function CaseLinkMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--color-accent)] text-[var(--color-accent-ink)] [box-shadow:var(--shadow-action)]",
        className,
      )}
    >
      <Link2 className="size-[1.35rem]" strokeWidth={2.25} />
    </span>
  );
}

export function CaseLinkWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CaseLinkMark />
      <span className="font-[family-name:var(--font-display)] text-[1.45rem] font-semibold leading-none tracking-[-0.025em] text-[var(--color-ink)]">
        CaseLink
      </span>
    </span>
  );
}

export function PublicCaseLinkMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-[9px] bg-[var(--public-accent)] text-[var(--public-accent-ink)] [box-shadow:var(--public-shadow-action)]",
        className,
      )}
    >
      <Link2 className="size-6" strokeWidth={2.25} />
    </span>
  );
}

export function PublicCaseLinkWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <PublicCaseLinkMark />
      <span className="font-[family-name:var(--public-font-display)] text-[1.75rem] font-semibold leading-none tracking-[-0.025em] text-[var(--public-ink)]">
        CaseLink
      </span>
    </span>
  );
}
