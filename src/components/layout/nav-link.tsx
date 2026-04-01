"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "";
  }
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  if (href === "/profile") {
    return pathname === "/profile";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-blue-50/70 text-blue-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-800",
        className,
      )}
    >
      {children}
    </Link>
  );
}
