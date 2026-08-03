import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-[#cfdccc] bg-white px-3 py-2.5 text-sm text-[#253f23] placeholder:text-[#778874] transition-[border-color,box-shadow] duration-150 focus:border-[#46923c] focus:outline-none focus:ring-4 focus:ring-[#46923c]/10 disabled:cursor-not-allowed disabled:bg-[#f3f7f1] disabled:text-[#687b65]",
        className,
      )}
      {...props}
    />
  );
}
