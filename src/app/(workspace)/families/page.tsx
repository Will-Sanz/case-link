import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarRotate as CalendarClock,
  Group as UsersRound,
  Plus,
  Search,
} from "iconoir-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enrichFamiliesWithCurrentStep, listFamilies } from "@/lib/services/families";
import { parseFamilyListQuery } from "@/lib/validations/family-list-query";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Families",
};

const statusLabel = { active: "Active", on_hold: "On hold", closed: "Closed" } as const;

function formatTargetDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

export default async function FamiliesPage({ searchParams }: PageProps) {
  const parsed = parseFamilyListQuery(await searchParams);
  const supabase = await createSupabaseServerClient();
  const familyList = await listFamilies(supabase, parsed);
  const items = await enrichFamiliesWithCurrentStep(supabase, familyList.items);
  const { total } = familyList;
  const empty = total === 0 && !parsed.q.trim();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="workspace-display text-3xl text-[var(--color-ink)] sm:text-4xl">Families</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">Your active family records and support plans.</p>
        </div>
        <Link href="/families/new" className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-ink)] [box-shadow:var(--shadow-action)] transition-colors hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30 focus-visible:ring-offset-2 active:bg-[var(--color-accent)]">
          <Plus className="size-4" aria-hidden /> Add a family
        </Link>
      </header>

      {!empty ? (
        <div className="mt-8 flex flex-col gap-4 border-b border-[var(--color-rule)] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <form className="relative w-full max-w-md">
            <label htmlFor="family-search" className="sr-only">Search families</label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-ink-faint)]" aria-hidden />
            <input id="family-search" name="q" defaultValue={parsed.q} placeholder="Search by family label or summary" className="min-h-11 w-full rounded-lg border border-[var(--color-rule-strong)] bg-[var(--color-surface)] pl-10 pr-4 text-sm text-[var(--color-ink-strong)] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-focus)] focus:ring-4 focus:ring-[var(--color-focus)]/10" />
          </form>
          <p className="shrink-0 text-sm text-[var(--color-ink-faint)]">{total} {total === 1 ? "family" : "families"}</p>
        </div>
      ) : null}

      {empty ? (
        <section className="mt-10 grid min-h-[430px] place-items-center rounded-2xl border border-dashed border-[var(--color-rule-strong)] bg-[var(--color-accent-soft)] px-6 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-accent)] [box-shadow:var(--shadow-surface)]"><UsersRound className="size-6" aria-hidden /></span>
            <h2 className="workspace-display mt-6 text-2xl text-[var(--color-ink)]">Add your first family</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">Start with a family label and the barriers you are helping them address. That is enough to begin a plan.</p>
            <Link href="/families/new" className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30 focus-visible:ring-offset-2">
              Add a family <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      ) : items.length === 0 ? (
        <section className="mt-10 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-6 py-14 text-center">
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">No families match that search.</h2>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Try a shorter family label or clear the search.</p>
          <Link href="/families" className="mt-5 inline-flex text-sm font-semibold text-[var(--color-accent)] underline decoration-[var(--color-accent-rule)] decoration-2 underline-offset-4">Clear search</Link>
        </section>
      ) : (
        <div className="mt-2 divide-y divide-[var(--color-rule)]">
          {items.map((family) => (
            <Link key={family.id} href={`/families/${family.id}/profile`} className="group grid gap-4 py-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="truncate text-lg font-semibold tracking-[-0.015em] text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">{family.name}</h2>
                  <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-positive)]">{statusLabel[family.status]}</span>
                  {family.urgency && family.urgency !== "low" ? <span className="rounded-full bg-[var(--color-attention-bg)] px-2.5 py-1 text-[11px] font-semibold capitalize text-[var(--color-attention)]">{family.urgency} priority</span> : null}
                </div>
                <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-[var(--color-ink-muted)]">{family.summary || "No family summary has been added yet."}</p>
                <div className="mt-3 flex items-start gap-2 text-sm leading-5">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-[var(--color-positive)]" aria-hidden />
                  {family.current_step ? (
                    <p className="text-[var(--color-ink-2)]">
                      <span className="font-semibold">Next: </span>
                      {family.current_step.action_needed_now || family.current_step.title}
                      <span className="text-[var(--color-ink-faint)]">
                        {family.current_step.due_date
                          ? ` · Target ${formatTargetDate(family.current_step.due_date)}`
                          : " · Target date needed"}
                      </span>
                    </p>
                  ) : (
                    <p className="text-[var(--color-ink-faint)]">Open this family to build or review the support plan.</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--color-ink-faint)] sm:justify-end">
                <span>Updated {new Date(family.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                <ArrowRight className="size-4 text-[var(--color-positive)] transition-transform group-hover:translate-x-1" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
