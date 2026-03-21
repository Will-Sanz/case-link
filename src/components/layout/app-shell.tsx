import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/types/user-role";

export function AppShell({
  email,
  role,
  children,
}: {
  email: string;
  role: UserRole;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-[#f4f6f8]">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200/80 bg-white lg:flex lg:shadow-[1px_0_0_0_rgba(15,23,42,0.03)]">
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold text-white shadow-sm">
            CL
          </div>
          <span className="font-semibold tracking-tight text-slate-900">
            CaseLink
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3" aria-label="Main">
          <NavLink href="/dashboard">Today</NavLink>
          <NavLink href="/families">Families</NavLink>
          <NavLink href="/calendar">Calendar</NavLink>
          <NavLink href="/resources">Resources</NavLink>
        </nav>
        <div className="border-t border-slate-100 p-4">
          <p className="truncate text-xs text-slate-500" title={email}>
            {email}
          </p>
          <p className="mt-1">
            <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              {role}
            </span>
          </p>
          <form action={signOutAction} className="mt-3">
            <Button type="submit" variant="outline" className="w-full py-2 text-xs">
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-semibold text-slate-900"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold text-white">
                CL
              </span>
              CaseLink
            </Link>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" className="text-xs">
                Sign out
              </Button>
            </form>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2"
            aria-label="Main"
          >
            <NavLink href="/dashboard" className="shrink-0 whitespace-nowrap">
              Today
            </NavLink>
            <NavLink href="/families" className="shrink-0 whitespace-nowrap">
              Families
            </NavLink>
            <NavLink href="/calendar" className="shrink-0 whitespace-nowrap">
              Calendar
            </NavLink>
            <NavLink href="/resources" className="shrink-0 whitespace-nowrap">
              Resources
            </NavLink>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
