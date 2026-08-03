"use client";

import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  CircleHelp,
  FileCheck2,
  ListChecks,
  LogOut,
  Menu,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { CaseLinkWordmark } from "@/components/brand/caselink-mark";
import { MainContent } from "@/components/layout/main-content";
import { cn } from "@/lib/utils/cn";

function WorkspaceLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof UsersRound; active: boolean }) {
  return (
    <Link href={href} className={cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/30", active ? "bg-[#e2efe0] text-[#276221]" : "text-[#5d705a] hover:bg-[#f1f6ef] hover:text-[#173a15]")}>
      <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
      {label}
    </Link>
  );
}

export function FamilyCaseChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const familyId = useMemo(() => pathname?.match(/^\/families\/([0-9a-f-]{36})(?:\/.*)?$/i)?.[1] ?? null, [pathname]);
  const familyTabs = familyId ? [
    { href: `/families/${familyId}/profile`, label: "Family profile", icon: UsersRound },
    { href: `/families/${familyId}/overview`, label: "Barriers", icon: ShieldCheck },
    { href: `/families/${familyId}/plan`, label: "Intervention plan", icon: ListChecks },
    { href: `/families/${familyId}/paperwork`, label: "Paperwork", icon: FileCheck2 },
  ] : [];

  return (
    <div className="flex min-h-dvh items-start bg-[#f6f8f4]">
      <a href="#main-content" className="sr-only z-[100] rounded-lg bg-white px-4 py-3 font-semibold text-[#276221] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to main content</a>
      <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-[#dce6d9] bg-white lg:flex">
        <Link href="/families" className="flex h-[72px] items-center border-b border-[#e2ebe0] px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#46923c]/30">
          <CaseLinkWordmark />
        </Link>
        <nav className="space-y-1 p-3" aria-label="Workspace">
          <p className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#82917f]">Workspace</p>
          <WorkspaceLink href="/families" label="Families" icon={UsersRound} active={pathname === "/families" || Boolean(familyId)} />
          <WorkspaceLink href="/profile" label="Settings" icon={Settings} active={pathname === "/profile"} />
        </nav>
        {familyTabs.length ? (
          <nav className="mx-3 border-t border-[#e2ebe0] pt-4" aria-label="Family workspace">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#82917f]">Open family</p>
            <div className="space-y-1">
              {familyTabs.map((item) => <WorkspaceLink key={item.href} {...item} active={pathname === item.href} />)}
            </div>
          </nav>
        ) : null}
        <div className="mt-auto border-t border-[#e2ebe0] p-3">
          <Link href="/product" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#5d705a] hover:bg-[#f1f6ef] hover:text-[#173a15]"><CircleHelp className="size-[18px]" strokeWidth={1.8} aria-hidden /> Help &amp; product guide</Link>
          <form action={signOutAction}>
            <button type="submit" className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#5d705a] hover:bg-[#f1f6ef] hover:text-[#173a15]"><LogOut className="size-[18px]" strokeWidth={1.8} aria-hidden /> Sign out</button>
          </form>
        </div>
      </aside>

      <div className="flex h-dvh max-h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-[#dce6d9] bg-white px-4 lg:hidden">
          <Link href="/families" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/30"><CaseLinkWordmark /></Link>
          <details className="group relative">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-lg border border-[#dce6d9] text-[#365134] [&::-webkit-details-marker]:hidden"><Menu className="size-5 group-open:hidden" aria-hidden /><PanelLeftClose className="hidden size-5 group-open:block" aria-hidden /><span className="sr-only">Open navigation</span></summary>
            <nav className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-[#dce6d9] bg-white p-2 shadow-[0_16px_40px_rgba(30,70,27,0.14)]" aria-label="Mobile workspace">
              <WorkspaceLink href="/families" label="Families" icon={UsersRound} active={pathname === "/families"} />
              {familyTabs.map((item) => <WorkspaceLink key={item.href} {...item} active={pathname === item.href} />)}
              <WorkspaceLink href="/profile" label="Settings" icon={Settings} active={pathname === "/profile"} />
              <div className="mt-2 border-t border-[#e2ebe0] pt-2">
                <WorkspaceLink href="/product" label="Help & product guide" icon={CircleHelp} active={false} />
                <form action={signOutAction}>
                  <button type="submit" className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#5d705a] hover:bg-[#f1f6ef] hover:text-[#173a15]"><LogOut className="size-[18px]" strokeWidth={1.8} aria-hidden /> Sign out</button>
                </form>
              </div>
            </nav>
          </details>
        </header>
        <MainContent>{children}</MainContent>
      </div>
    </div>
  );
}
