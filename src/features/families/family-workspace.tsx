import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddCaseNoteForm } from "@/features/families/add-case-note-form";
import { PlanPanel } from "@/features/families/plan-panel";
import { PhasePlaceholder } from "@/features/families/phase-placeholder";
import { ResourceMatchesPanel } from "@/features/families/resource-matches-panel";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import { UpdateFamilyForm } from "@/features/families/update-family-form";
import type { FamilyDetail } from "@/types/family";

function formatDt(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </p>
  );
}

export function FamilyWorkspace({ family }: { family: FamilyDetail }) {
  return (
    <div className="space-y-10">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-900/[0.03] sm:p-8">
        <Link
          href="/families"
          className="text-sm font-medium text-teal-800 underline-offset-2 hover:text-teal-900 hover:underline"
        >
          ← Back to families
        </Link>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {family.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={family.status} />
              <UrgencyBadge urgency={family.urgency} />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {family.creator?.email ? (
                <>
                  <span>Created by {family.creator.email}</span>
                  <span className="mx-2 text-slate-300" aria-hidden>
                    ·
                  </span>
                </>
              ) : null}
              <time dateTime={family.updated_at}>
                Updated {formatDt(family.updated_at)}
              </time>
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <SectionLabel>Profile & household</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            Context & members
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Narrative, status, and who is in the household. Keep this current
            before running matching or refreshing the plan.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle>Overview & circumstances</CardTitle>
            <div className="mt-5">
              <UpdateFamilyForm family={family} />
            </div>
          </Card>
          <Card>
            <CardTitle>Goals</CardTitle>
            {family.goals.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  className="border-slate-200/80 bg-slate-50/40 py-8"
                  title="No goals recorded"
                  description="Goals from intake will appear here."
                />
              </div>
            ) : (
              <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-800">
                {family.goals.map((g) => (
                  <li
                    key={g.id}
                    className="flex gap-2 rounded-lg bg-slate-50/80 px-3 py-2"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-600" />
                    <span>{g.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Barriers</CardTitle>
            {family.barriers.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  className="border-slate-200/80 bg-slate-50/40 py-8"
                  title="No barriers recorded"
                  description="Barriers from intake will appear here."
                />
              </div>
            ) : (
              <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-800">
                {family.barriers.map((b) => (
                  <li
                    key={b.id}
                    className="flex gap-2 rounded-lg bg-slate-50/80 px-3 py-2"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>{b.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Household members</CardTitle>
            {family.members.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  className="border-slate-200/80 bg-slate-50/40 py-8"
                  title="No additional members"
                  description="Optional members from intake will be listed here."
                />
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100">
                {family.members.map((m) => (
                  <li key={m.id} className="py-4 first:pt-0">
                    <p className="font-medium text-slate-900">{m.display_name}</p>
                    {m.relationship ? (
                      <p className="text-sm text-slate-600">{m.relationship}</p>
                    ) : null}
                    {m.age_approx != null ? (
                      <p className="text-sm text-slate-600">Age ~{m.age_approx}</p>
                    ) : null}
                    {m.notes ? (
                      <p className="mt-2 text-sm leading-relaxed text-slate-700">
                        {m.notes}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <SectionLabel>Documentation</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            Case notes
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Dated entries for the file after visits, calls, or partner contact.
          </p>
        </div>
        <Card>
          <CardTitle>Case notes</CardTitle>
          <div className="mt-5 border-b border-slate-100 pb-6">
            <AddCaseNoteForm familyId={family.id} />
          </div>
          {family.caseNotes.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                className="border-slate-200/80 bg-slate-50/40 py-8"
                title="No notes yet"
                description="Add a dated entry above when you speak with the family or partners."
              />
            </div>
          ) : (
            <ul className="mt-6 space-y-5">
              {family.caseNotes.map((n) => (
                <li
                  key={n.id}
                  className="border-l-2 border-teal-200 pl-4"
                >
                  <p className="text-xs font-medium text-slate-500">
                    {formatDt(n.created_at)}
                    {n.author?.email ? (
                      <span className="text-slate-400"> · {n.author.email}</span>
                    ) : null}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                    {n.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <SectionLabel>Planning</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            Resources & 30/60/90 plan
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Review suggested programs, then build and track the family&apos;s plan
            by phase.
          </p>
        </div>
        <div className="space-y-6">
          <ResourceMatchesPanel
            familyId={family.id}
            matches={family.resourceMatches}
          />
          <PlanPanel familyId={family.id} plan={family.plan ?? null} />
          <PhasePlaceholder
            title="Referrals & tasks"
            description="Outreach tracking and tasks land in Phase 5."
          />
        </div>
      </section>
    </div>
  );
}
