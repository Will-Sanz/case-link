"use client";

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { SetFamilyCaseTitleContext } from "@/components/layout/family-case-title-context";
import { MainContent } from "@/components/layout/main-content";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import {
  extractFamilyCaseId,
  FAMILY_WORKSPACE_SECTIONS,
  isFamilyCaseDetailPath,
  parseFamilyWorkspaceSection,
} from "@/features/families/family-workspace-sections";
import type { UserRole } from "@/types/user-role";
import { cn } from "@/lib/utils/cn";

function StandardAside({
  email,
  role,
}: {
  email: string;
  role: UserRole;
}) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/90 text-xs font-semibold text-white">
          CL
        </div>
        <span className="font-semibold text-slate-900">CaseLink</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Main">
        <NavLink href="/dashboard">Today</NavLink>
        <NavLink href="/families">Families</NavLink>
        <NavLink href="/calendar">Calendar</NavLink>
        <NavLink href="/resources">Resources</NavLink>
      </nav>
      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-xs text-slate-500" title={email}>
          {email}
        </p>
        <p className="mt-1">
          <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {role}
          </span>
        </p>
        <form action={signOutAction} className="mt-3">
          <Button type="submit" variant="secondary" className="w-full py-2 text-sm">
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}

function UnifiedAsideBody({
  email,
  role,
  familyId,
  familyTitle,
}: {
  email: string;
  role: UserRole;
  familyId: string;
  familyTitle: string | null;
}) {
  const searchParams = useSearchParams();
  const activeSection = parseFamilyWorkspaceSection(searchParams.get("section"));
  const base = `/families/${familyId}`;

  return (
    <aside className="sticky top-0 hidden h-dvh w-[15.5rem] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/90 text-xs font-semibold text-white">
          CL
        </div>
        <span className="truncate font-semibold text-slate-900">CaseLink</span>
      </div>

      <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
        <NavLink href="/dashboard">Today</NavLink>
        <NavLink href="/families">Families</NavLink>
        <NavLink href="/calendar">Calendar</NavLink>
        <NavLink href="/resources">Resources</NavLink>
      </nav>

      <div className="mx-3 border-t border-slate-200" />

      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 pt-3">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Current case
        </p>
        <p
          className="mt-1 truncate px-3 text-sm font-semibold text-slate-900"
          title={familyTitle ?? undefined}
        >
          {familyTitle ?? "—"}
        </p>
        <nav className="mt-2 flex flex-col gap-0.5" aria-label="Case sections">
          {FAMILY_WORKSPACE_SECTIONS.map(({ id, label }) => (
            <Link
              key={id}
              href={`${base}?section=${id}`}
              scroll={false}
              className={cn(
                "rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                activeSection === id
                  ? "bg-blue-50/80 text-blue-800"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-auto shrink-0 border-t border-slate-200 p-3">
        <p className="truncate text-xs text-slate-500" title={email}>
          {email}
        </p>
        <p className="mt-1">
          <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {role}
          </span>
        </p>
        <form action={signOutAction} className="mt-3">
          <Button type="submit" variant="secondary" className="w-full py-2 text-sm">
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}

function UnifiedAsideFallback({
  email,
  role,
  familyId,
  familyTitle,
}: {
  email: string;
  role: UserRole;
  familyId: string;
  familyTitle: string | null;
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[15.5rem] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/90 text-xs font-semibold text-white">
          CL
        </div>
        <span className="truncate font-semibold text-slate-900">CaseLink</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
        <NavLink href="/dashboard">Today</NavLink>
        <NavLink href="/families">Families</NavLink>
        <NavLink href="/calendar">Calendar</NavLink>
        <NavLink href="/resources">Resources</NavLink>
      </nav>
      <div className="mx-3 border-t border-slate-200" />
      <div className="px-2 pb-2 pt-3">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Current case
        </p>
        <p className="mt-1 truncate px-3 text-sm font-semibold text-slate-900">
          {familyTitle ?? "—"}
        </p>
        <p className="mt-3 px-3 text-xs text-slate-400">Loading sections…</p>
      </div>
      <div className="mt-auto border-t border-slate-200 p-3">
        <p className="truncate text-xs text-slate-500">{email}</p>
        <p className="mt-1">
          <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {role}
          </span>
        </p>
        <form action={signOutAction} className="mt-3">
          <Button type="submit" variant="secondary" className="w-full py-2 text-sm">
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}

export function FamilyCaseChrome({
  email,
  role,
  children,
}: {
  email: string;
  role: UserRole;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isCaseDetail = isFamilyCaseDetailPath(pathname);
  const familyId = useMemo(() => extractFamilyCaseId(pathname), [pathname]);

  const [familyTitle, setFamilyTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!isCaseDetail) setFamilyTitle(null);
  }, [isCaseDetail]);

  const setTitle = useCallback((name: string | null) => {
    setFamilyTitle(name);
  }, []);

  return (
    <SetFamilyCaseTitleContext.Provider value={setTitle}>
      <div className="flex min-h-dvh bg-[#f4f6f8]">
        {isCaseDetail && familyId ?
          <Suspense
            fallback={
              <UnifiedAsideFallback
                email={email}
                role={role}
                familyId={familyId}
                familyTitle={familyTitle}
              />
            }
          >
            <UnifiedAsideBody
              email={email}
              role={role}
              familyId={familyId}
              familyTitle={familyTitle}
            />
          </Suspense>
        : <StandardAside email={email} role={role} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white lg:hidden">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 font-semibold text-slate-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/90 text-xs font-semibold text-white">
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
              className="flex gap-1 overflow-x-auto border-t border-slate-200 px-3 py-2"
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

          <MainContent>{children}</MainContent>
        </div>
      </div>
    </SetFamilyCaseTitleContext.Provider>
  );
}
