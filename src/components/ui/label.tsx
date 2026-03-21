import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Label({
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label
      className={cn("block text-sm font-medium text-slate-800", className)}
      {...props}
    >
      {children}
    </label>
  );
}
