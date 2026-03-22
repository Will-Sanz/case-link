import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  children: ReactNode;
};

const variants: Record<NonNullable<Props["variant"]>, string> = {
  primary:
    "rounded-lg bg-blue-500/90 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  secondary:
    "rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-blue-50 hover:border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  outline:
    "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  ghost:
    "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
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
