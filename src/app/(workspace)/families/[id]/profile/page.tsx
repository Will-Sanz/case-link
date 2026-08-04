import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Group as UsersRound,
  TaskList as ListChecks,
  WarningCircle as CircleAlert,
} from "iconoir-react";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFamilyDetail } from "@/lib/services/families";
import { UpdateFamilyForm } from "@/features/families/update-family-form";

type PageProps = { params: Promise<{ id: string }> };

export default async function FamilyProfilePage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const supabase = await createSupabaseServerClient();
  const family = await getFamilyDetail(supabase, parsed.data);
  if (!family) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-5 border-b border-[var(--color-rule)] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/families" className="text-sm font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]">Families</Link>
          <h1 className="workspace-display mt-3 text-3xl text-[var(--color-ink)] sm:text-4xl">{family.name}</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-faint)]">Family profile · Updated {new Date(family.updated_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        </div>
        <Link href={`/families/${family.id}/overview`} className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-ink)] [box-shadow:var(--shadow-action)] transition-colors hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30 focus-visible:ring-offset-2 active:bg-[var(--color-accent)]">
          Review barriers <ArrowRight className="size-4" aria-hidden />
        </Link>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="family-details" className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-6 [box-shadow:var(--shadow-surface)] sm:p-7">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]"><UsersRound className="size-5" aria-hidden /></span>
            <div><h2 id="family-details" className="text-lg font-semibold text-[var(--color-ink)]">Current context</h2><p className="text-xs text-[var(--color-ink-faint)]">Used to create and update the plan</p></div>
          </div>
          <div className="mt-6"><UpdateFamilyForm family={family} /></div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-accent-soft)] p-5">
            <div className="flex items-center gap-2 text-[var(--color-accent)]"><CircleAlert className="size-4" aria-hidden /><h2 className="text-sm font-semibold">Privacy reminder</h2></div>
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">Use a household label instead of names. Do not enter dates of birth, student IDs, addresses, or other identifying information.</p>
          </section>
          <section className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-5">
            <div className="flex items-center gap-2 text-[var(--color-ink)]"><ListChecks className="size-4 text-[var(--color-positive)]" aria-hidden /><h2 className="text-sm font-semibold">Planning context</h2></div>
            <dl className="mt-4 divide-y divide-[var(--color-rule-soft)] text-sm">
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--color-ink-faint)]">Goals</dt><dd className="font-semibold text-[var(--color-ink-2)]">{family.goals.length}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--color-ink-faint)]">Barriers</dt><dd className="font-semibold text-[var(--color-ink-2)]">{family.barriers.length}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--color-ink-faint)]">Plan</dt><dd className="font-semibold text-[var(--color-ink-2)]">{family.plan ? "Created" : "Not created"}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
