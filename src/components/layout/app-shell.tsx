import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
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
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex flex-wrap items-center gap-6">
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-slate-900"
            >
              CaseLink
            </Link>
            <Link
              href="/dashboard"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Dashboard
            </Link>
            <Link
              href="/families"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Families
            </Link>
            <Link
              href="/resources"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Resources
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {email}
              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                {role}
              </span>
            </span>
            <form action={signOutAction}>
              <Button type="submit" variant="secondary" className="py-1.5 text-xs">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
