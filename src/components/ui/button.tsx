import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  children: ReactNode;
};

const variants: Record<NonNullable<Props["variant"]>, string> = {
  primary:
    "whitespace-nowrap rounded-lg bg-[var(--button-bg)] px-4 py-2 text-sm font-semibold text-[var(--button-fg)] [box-shadow:var(--shadow-action)] transition-colors duration-[var(--dur-short)] [transition-timing-function:var(--ease-out)] hover:bg-[var(--button-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 active:bg-[var(--button-bg)] disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "whitespace-nowrap rounded-lg bg-[var(--color-accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--color-accent)] transition-colors duration-[var(--dur-short)] hover:bg-[var(--color-paper-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 active:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50",
  outline:
    "whitespace-nowrap rounded-lg border border-[var(--color-rule-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-2)] transition-colors duration-[var(--dur-short)] hover:bg-[var(--color-paper-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 active:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-ink-muted)] transition-colors duration-[var(--dur-short)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 active:bg-[var(--color-paper-3)] disabled:cursor-not-allowed disabled:opacity-50",
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: Props) {
  return (
    <button
      type={type}
      className={cn(variants[variant], className)}
      {...props}
    />
  );
}
