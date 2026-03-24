"use client";

import Link from "next/link";
import {
  type ReactNode,
  useMemo,
} from "react";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { MainContent } from "@/components/layout/main-content";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

function StandardAside({
  familyTabs,
  activeFamilyTab,
}: {
  familyTabs?: Array<{ href: string; label: string }>;
  activeFamilyTab?: string;
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/90 text-xs font-semibold text-white">
          CL
        </div>
        <span className="font-semibold text-slate-900">CaseLink</span>
      </div>
      <nav className="shrink-0 flex flex-col gap-0.5 p-2 pb-1" aria-label="Main">
        <NavLink href="/families">Families</NavLink>
        <NavLink href="/profile">Profile</NavLink>
      </nav>
      {familyTabs && familyTabs.length > 0 ? (
        <>
          <div className="mx-3 shrink-0 border-t border-slate-200" />
          <div className="px-2 py-3">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Family workspace
            </p>
            <nav className="flex flex-col gap-0.5" aria-label="Family tabs">
              {familyTabs.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                    activeFamilyTab === item.href
                      ? "bg-blue-50/70 text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </>
      ) : null}
    </aside>
  );
}

export function FamilyCaseChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const familyId = useMemo(() => {
    const m = (pathname ?? "").match(
      /^\/families\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/.*)?$/i,
    );
    return m?.[1] ?? null;
  }, [pathname]);
  const familyTabs = useMemo(
    () =>
      familyId
        ? [
            { href: `/families/${familyId}/plan`, label: "30/60/90 Plan" },
            { href: `/families/${familyId}/resources`, label: "Resources" },
            { href: `/families/${familyId}/timeline`, label: "Timeline" },
            { href: `/families/${familyId}/assistant`, label: "Case Assistant" },
          ]
        : [],
    [familyId],
  );
  const activeFamilyTab = useMemo(() => {
    if (!familyId) return "";
    return (
      familyTabs.find((t) => pathname === t.href || pathname?.startsWith(`${t.href}/`))
        ?.href ?? ""
    );
  }, [familyId, familyTabs, pathname]);

  return (
    <div className="flex min-h-dvh items-start bg-[#f4f6f8]">
      <StandardAside familyTabs={familyTabs} activeFamilyTab={activeFamilyTab} />

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link
              href="/families"
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
            <NavLink href="/families" className="shrink-0 whitespace-nowrap">
              Families
            </NavLink>
            <NavLink href="/profile" className="shrink-0 whitespace-nowrap">
              Profile
            </NavLink>
            {familyTabs.map((item) => (
              <NavLink key={item.href} href={item.href} className="shrink-0 whitespace-nowrap">
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <MainContent>{children}</MainContent>
      </div>
    </div>
  );
}
