"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddCaseNoteForm } from "@/features/families/add-case-note-form";
import { CaseActivityTimeline } from "@/features/families/case-activity-timeline";
import { CaseCommandCenter } from "@/features/families/case-command-center";
import { PlanPanel } from "@/features/families/plan-panel";
import { CaseAssistantPanel } from "@/features/families/case-assistant-panel";
import { PhasePlaceholder } from "@/features/families/phase-placeholder";
import { ResourceMatchesPanel } from "@/features/families/resource-matches-panel";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import { UpdateFamilyForm } from "@/features/families/update-family-form";
import { updateFamilyMeta, deleteFamily } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { getNextAction } from "@/lib/utils/next-action";
import type { FamilyDetail } from "@/types/family";
import { cn } from "@/lib/utils/cn";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "open-work", label: "Open work" },
  { id: "plan", label: "30 / 60 / 90 plan" },
  { id: "members", label: "Household members" },
  { id: "goals", label: "Goals" },
  { id: "barriers", label: "Barriers" },
  { id: "notes", label: "Notes" },
  { id: "activity", label: "Activity" },
  { id: "resources", label: "Resources" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

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

export function FamilyWorkspace({ family }: { family: FamilyDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hasNeedsAttention = family.needsAttention && family.needsAttention.length > 0;
  const [activeSection, setActiveSection] = useState<SectionId>(
    hasNeedsAttention ? "open-work" : "overview",
  );

  function handleCloseCase() {
    setError(null);
    startTransition(async () => {
      const r = await updateFamilyMeta({ familyId: family.id, status: "closed" });
      if (!r.ok) setError(r.error);
      else router.push("/families");
    });
  }

  function handleDeleteCase() {
    if (!confirm("Delete this case permanently? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteFamily({ familyId: family.id });
      if (!r.ok) setError(r.error);
      else router.push("/families");
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col lg:flex-row">
      {/* Internal family nav sidebar */}
      <nav
        className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-slate-200 bg-white px-4 py-3 lg:w-52 lg:flex-col lg:flex-nowrap lg:border-b-0 lg:border-r lg:py-6"
        aria-label="Family sections"
      >
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSection(id)}
            className={cn(
              "rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
              activeSection === id
                ? "bg-blue-50/70 text-blue-800"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <div className="min-w-0 flex-1 overflow-auto">
        {/* Compact header */}
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-4 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <Link
                href="/families"
                className="text-sm font-medium text-blue-600/90 hover:text-blue-600"
              >
                ← Back to families
              </Link>
              <h1 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">
                {family.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={family.status} />
                <UrgencyBadge urgency={family.urgency} />
              </div>
              {getNextAction(family) && (
                <p className="mt-2 font-medium text-blue-700">
                  Next: {getNextAction(family)}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {family.creator?.email ? (
                  <>Created by {family.creator.email} · </>
                ) : null}
                <time dateTime={family.updated_at}>Updated {formatDt(family.updated_at)}</time>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {family.status === "closed" ? (
                <Button
                  variant="secondary"
                  className="text-sm"
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const r = await updateFamilyMeta({ familyId: family.id, status: "active" });
                      if (!r.ok) setError(r.error);
                      else router.refresh();
                    });
                  }}
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Reopen case"}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="text-sm"
                  onClick={handleCloseCase}
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Close case"}
                </Button>
              )}
              <Button
                variant="outline"
                className="border-red-200 text-sm text-red-700 hover:bg-red-50"
                onClick={handleDeleteCase}
                disabled={pending}
              >
                Delete case
              </Button>
            </div>
          </div>
          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
        </header>

        {/* Section content */}
        <div className="px-4 py-6 lg:px-8">
          {activeSection === "overview" && (
            <OverviewSection family={family} />
          )}
          {activeSection === "open-work" && (
            <OpenWorkSection family={family} hasNeedsAttention={!!hasNeedsAttention} />
          )}
          {activeSection === "plan" && (
            <PlanSection family={family} />
          )}
          {activeSection === "members" && (
            <MembersSection family={family} />
          )}
          {activeSection === "goals" && (
            <GoalsSection family={family} />
          )}
          {activeSection === "barriers" && (
            <BarriersSection family={family} />
          )}
          {activeSection === "notes" && (
            <NotesSection family={family} formatDt={formatDt} />
          )}
          {activeSection === "activity" && (
            <ActivitySection family={family} />
          )}
          {activeSection === "resources" && (
            <ResourcesSection family={family} />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewSection({ family }: { family: FamilyDetail }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Overview & circumstances</h2>
        <p className="mt-1 text-sm text-slate-600">
          Narrative and status. Keep this current before running matching or refreshing the plan.
        </p>
        <div className="mt-4">
          <UpdateFamilyForm family={family} />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Goals</h2>
          {family.goals.length === 0 ? (
            <EmptyState
              className="mt-3 border-slate-200 bg-slate-50/50 py-6"
              title="No goals recorded"
              description="Goals from intake will appear here."
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {family.goals.map((g) => (
                <li key={g.id} className="flex gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-800">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500/90" />
                  <span>{g.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Barriers</h2>
          {family.barriers.length === 0 ? (
            <EmptyState
              className="mt-3 border-slate-200 bg-slate-50/50 py-6"
              title="No barriers recorded"
              description="Barriers from intake will appear here."
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {family.barriers.map((b) => (
                <li key={b.id} className="flex gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-800">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500/90" />
                  <span>{b.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function OpenWorkSection({
  family,
  hasNeedsAttention,
}: {
  family: FamilyDetail;
  hasNeedsAttention: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Open work</h2>
        <p className="mt-1 text-sm text-slate-600">
          Steps and items needing attention. Click to open and update progress.
        </p>
      </div>
      {hasNeedsAttention ? (
        <CaseCommandCenter items={family.needsAttention!} familyId={family.id} />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white py-12">
          <EmptyState
            title="No open work"
            description="All caught up. Add or update plan steps to see items here."
          />
        </div>
      )}
      <PlanPanel
        familyId={family.id}
        plan={family.plan ?? null}
        familyName={family.name}
        resourceMatches={family.resourceMatches}
      />
    </div>
  );
}

function PlanSection({ family }: { family: FamilyDetail }) {
  return (
    <div className="space-y-6">
      <PlanPanel
        familyId={family.id}
        plan={family.plan ?? null}
        familyName={family.name}
        resourceMatches={family.resourceMatches}
      />
    </div>
  );
}

function MembersSection({ family }: { family: FamilyDetail }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Household members</h2>
      <p className="mt-1 text-sm text-slate-600">
        People in the household from intake.
      </p>
      {family.members.length === 0 ? (
        <EmptyState
          className="mt-4 border-slate-200 bg-slate-50/50 py-8"
          title="No additional members"
          description="Optional members from intake will be listed here."
        />
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {family.members.map((m) => (
            <li key={m.id} className="px-4 py-4 first:pt-4">
              <p className="font-medium text-slate-900">{m.display_name}</p>
              {m.relationship && (
                <p className="text-sm text-slate-600">{m.relationship}</p>
              )}
              {m.age_approx != null && (
                <p className="text-sm text-slate-600">Age ~{m.age_approx}</p>
              )}
              {m.notes && (
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{m.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GoalsSection({ family }: { family: FamilyDetail }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Goals</h2>
      <p className="mt-1 text-sm text-slate-600">
        Family goals from intake.
      </p>
      {family.goals.length === 0 ? (
        <EmptyState
          className="mt-4 border-slate-200 bg-slate-50/50 py-8"
          title="No goals recorded"
          description="Goals from intake will appear here."
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {family.goals.map((g) => (
            <li key={g.id} className="flex gap-2 rounded-lg border border-slate-100 bg-white px-4 py-3 text-sm text-slate-800">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500/90" />
              <span>{g.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BarriersSection({ family }: { family: FamilyDetail }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Barriers</h2>
      <p className="mt-1 text-sm text-slate-600">
        Known barriers from intake.
      </p>
      {family.barriers.length === 0 ? (
        <EmptyState
          className="mt-4 border-slate-200 bg-slate-50/50 py-8"
          title="No barriers recorded"
          description="Barriers from intake will appear here."
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {family.barriers.map((b) => (
            <li key={b.id} className="flex gap-2 rounded-lg border border-slate-100 bg-white px-4 py-3 text-sm text-slate-800">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500/90" />
              <span>{b.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotesSection({
  family,
  formatDt,
}: {
  family: FamilyDetail;
  formatDt: (iso: string) => string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Case notes</h2>
        <p className="mt-1 text-sm text-slate-600">
          Dated entries for the file after visits, calls, or partner contact.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <AddCaseNoteForm familyId={family.id} />
      </div>
      {family.caseNotes.length === 0 ? (
        <EmptyState
          className="border-slate-200 bg-slate-50/50 py-8"
          title="No notes yet"
          description="Add a dated entry above when you speak with the family or partners."
        />
      ) : (
        <ul className="space-y-5">
          {family.caseNotes.map((n) => (
            <li key={n.id} className="border-l-2 border-blue-200/70 pl-4">
              <p className="text-xs font-medium text-slate-500">
                {formatDt(n.created_at)}
                {n.author?.email && (
                  <span className="text-slate-400"> · {n.author.email}</span>
                )}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {n.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivitySection({ family }: { family: FamilyDetail }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Activity history</h2>
      <p className="mt-1 text-sm text-slate-600">
        Recent plan step updates and actions.
      </p>
      <div className="mt-4">
        <CaseActivityTimeline items={family.caseActivity ?? []} maxItems={25} />
      </div>
    </div>
  );
}

function ResourcesSection({ family }: { family: FamilyDetail }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Resource matches</h2>
        <p className="mt-1 text-sm text-slate-600">
          Suggested programs that feed into the plan. Run matching before generating or regenerating.
        </p>
      </div>
      <ResourceMatchesPanel
        familyId={family.id}
        matches={family.resourceMatches}
        plan={family.plan}
      />
      <PhasePlaceholder
        title="Referrals & tasks"
        description="Outreach tracking and tasks land in Phase 5."
      />
      <CaseAssistantPanel familyId={family.id} familyName={family.name} />
    </div>
  );
}
