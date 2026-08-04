import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--color-ink-strong)] placeholder:text-[var(--color-ink-faint)] transition-[border-color,box-shadow] duration-[var(--dur-short)] focus:border-[var(--input-focus)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:bg-[var(--color-paper-2)] disabled:text-[var(--color-ink-faint)]",
        className,
      )}
      {...props}
    />
  );
}
