"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const QUICK_ACTIONS = [
  { href: "/families", label: "Continue active cases" },
  { href: "/families/new", label: "New family intake" },
  { href: "/calendar", label: "Calendar" },
  { href: "/resources", label: "Search resources" },
] as const;

function isQuickActionActive(href: string, pathname: string): boolean {
  if (href === "/families/new") {
    return pathname === "/families/new" || pathname.startsWith("/families/new/");
  }
  if (href === "/families") {
    if (pathname.startsWith("/families/new")) return false;
    return pathname === "/families" || pathname.startsWith("/families/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function QuickActionLink({
  href,
  children,
  compact,
}: {
  href: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = isQuickActionActive(href, pathname);

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md font-medium transition-colors duration-150",
        compact ?
          "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs"
        : "px-3 py-1.5 text-xs",
        active ?
          "bg-slate-100 text-slate-800"
        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      <span className={cn(!compact && "min-w-0 truncate")}>{children}</span>
      {!compact ?
        <span className="shrink-0 text-slate-400" aria-hidden>
          →
        </span>
      : null}
    </Link>
  );
}

/** Desktop / tablet sidebar: below main nav, subdued vs primary navigation. */
export function SidebarQuickActions({ className }: { className?: string }) {
  return (
    <div className={cn("px-2", className)}>
      <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Quick actions
      </p>
      <nav className="flex flex-col gap-0.5" aria-label="Quick actions">
        {QUICK_ACTIONS.map(({ href, label }) => (
          <QuickActionLink key={href} href={href}>
            {label}
          </QuickActionLink>
        ))}
      </nav>
    </div>
  );
}

/** Mobile header: horizontal shortcuts when the sidebar is hidden. */
export function MobileQuickActionsStrip({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "border-t border-slate-200 bg-slate-50/80 px-3 py-2 lg:hidden",
        className,
      )}
    >
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Quick actions
      </p>
      <nav
        className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Quick actions"
      >
        {QUICK_ACTIONS.map(({ href, label }) => (
          <QuickActionLink key={href} href={href} compact>
            {label}
          </QuickActionLink>
        ))}
      </nav>
    </div>
  );
}
