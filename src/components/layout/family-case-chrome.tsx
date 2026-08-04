"use client";

import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  Group as UsersRound,
  HelpCircle as CircleHelp,
  Menu,
  Page as FileText,
  Settings,
  ShieldCheck,
  SidebarCollapse as PanelLeftClose,
  TaskList as ListChecks,
} from "iconoir-react";
import { CaseLinkWordmark } from "@/components/brand/caselink-mark";
import { MainContent } from "@/components/layout/main-content";
import { cn } from "@/lib/utils/cn";

function WorkspaceLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof UsersRound; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors duration-[var(--dur-short)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2", active ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)]")}>
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
    { href: `/families/${familyId}/paperwork`, label: "Review PDF", icon: FileText },
  ] : [];

  return (
    <div className="workspace-shell flex min-h-dvh items-start">
      <a href="#main-content" className="sr-only z-[100] rounded-lg bg-[var(--color-surface)] px-4 py-3 font-semibold text-[var(--color-accent)] shadow-[var(--shadow-menu)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to main content</a>
      <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-[var(--color-rule)] bg-[var(--color-surface)] lg:flex">
        <Link href="/families" className="flex h-[76px] items-center border-b border-[var(--color-rule-soft)] px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus)]/30">
          <CaseLinkWordmark />
        </Link>
        <nav className="space-y-1 p-3" aria-label="Workspace">
          <p className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">Workspace</p>
          <WorkspaceLink href="/families" label="Families" icon={UsersRound} active={pathname === "/families"} />
        </nav>
        {familyTabs.length ? (
          <nav className="mx-3 border-t border-[var(--color-rule-soft)] pt-4" aria-label="Family workspace">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">Open family</p>
            <div className="space-y-1">
              {familyTabs.map((item) => <WorkspaceLink key={item.href} {...item} active={pathname === item.href} />)}
            </div>
          </nav>
        ) : null}
        <nav className="mt-auto space-y-1 border-t border-[var(--color-rule-soft)] p-3" aria-label="Account and help">
          <WorkspaceLink href="/profile" label="Settings" icon={Settings} active={pathname === "/profile"} />
          <WorkspaceLink href="/product" label="Help & product guide" icon={CircleHelp} active={false} />
        </nav>
      </aside>

      <div className="flex h-dvh max-h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-20 flex h-[76px] shrink-0 items-center justify-between border-b border-[var(--color-rule)] bg-[var(--color-surface)] px-5 lg:hidden">
          <Link href="/families" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30"><CaseLinkWordmark /></Link>
          <details className="group relative">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-lg border border-[var(--color-rule)] text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-paper-2)] [&::-webkit-details-marker]:hidden"><Menu className="size-5 group-open:hidden" aria-hidden /><PanelLeftClose className="hidden size-5 group-open:block" aria-hidden /><span className="sr-only">Open navigation</span></summary>
            <nav className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-2 [box-shadow:var(--shadow-menu)]" aria-label="Mobile workspace">
              <WorkspaceLink href="/families" label="Families" icon={UsersRound} active={pathname === "/families"} />
              {familyTabs.map((item) => <WorkspaceLink key={item.href} {...item} active={pathname === item.href} />)}
              <div className="mt-2 border-t border-[var(--color-rule-soft)] pt-2">
                <WorkspaceLink href="/profile" label="Settings" icon={Settings} active={pathname === "/profile"} />
                <WorkspaceLink href="/product" label="Help & product guide" icon={CircleHelp} active={false} />
              </div>
            </nav>
          </details>
        </header>
        <MainContent>{children}</MainContent>
      </div>
    </div>
  );
}
