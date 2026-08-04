import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function CaseLinkMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#276221] text-white shadow-[0_5px_14px_rgba(39,98,33,0.18)]",
        className,
      )}
    >
      <svg viewBox="0 0 28 28" className="size-6" fill="none">
        <path
          d="M8.25 9.25h5.25a4 4 0 0 1 4 4v5.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M19.75 18.75H14.5a4 4 0 0 1-4-4v-5.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="8.25" cy="9.25" r="2.25" fill="#ACD8A7" />
        <circle cx="19.75" cy="18.75" r="2.25" fill="#ACD8A7" />
      </svg>
    </span>
  );
}

export function CaseLinkWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CaseLinkMark />
      <span className="text-[1.05rem] font-semibold tracking-[-0.025em] text-[#173a15]">
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
