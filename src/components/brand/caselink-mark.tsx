import Image from "next/image";
import { cn } from "@/lib/utils/cn";

export function CaseLinkMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-10 shrink-0", className)}
    >
      <Image src="/favicon.svg?v=4" width={40} height={40} alt="" />
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
