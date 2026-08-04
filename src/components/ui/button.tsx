import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  children: ReactNode;
};

const variants: Record<NonNullable<Props["variant"]>, string> = {
  primary:
    "rounded-lg bg-[#276221] px-4 py-2 text-sm font-semibold text-white shadow-[0_5px_14px_rgba(39,98,33,0.14)] transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-[#1f531b] hover:shadow-[0_7px_18px_rgba(39,98,33,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/30 focus-visible:ring-offset-2 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50",
  secondary:
    "rounded-lg bg-[#edf4eb] px-4 py-2 text-sm font-semibold text-[#276221] transition-colors duration-150 hover:bg-[#dfeedd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/25 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  outline:
    "rounded-lg border border-[#cfdccc] bg-white px-4 py-2 text-sm font-semibold text-[#365134] transition-colors duration-150 hover:bg-[#f3f7f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/25 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  ghost:
    "rounded-lg px-3 py-2 text-sm font-medium text-[#5d705a] transition-colors duration-150 hover:bg-[#edf4eb] hover:text-[#173a15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/25 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
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
