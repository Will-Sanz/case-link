"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddCaseNoteForm } from "@/features/families/add-case-note-form";
import { CaseActivityTimeline } from "@/features/families/case-activity-timeline";
import { PlanPanel } from "@/features/families/plan-panel";
import { CaseAssistantPanel } from "@/features/families/case-assistant-panel";
import { PhasePlaceholder } from "@/features/families/phase-placeholder";
import { ResourceMatchesPanel } from "@/features/families/resource-matches-panel";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import { UpdateFamilyForm } from "@/features/families/update-family-form";
import {
  updateFamilyMeta,
  deleteFamily,
  updateFamilyGoals,
  updateFamilyBarriers,
  updateFamilyMembers,
} from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getNextAction } from "@/lib/utils/next-action";
import {
  selectInputClass,
  textareaClass,
} from "@/lib/ui/form-classes";
import type { FamilyDetail } from "@/types/family";
import { cn } from "@/lib/utils/cn";

const SECTIONS = [
  { id: "overview", label: "Overview" },
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
  const [activeSection, setActiveSection] = useState<SectionId>("overview");

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
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 lg:px-8">
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
        <div className="px-4 py-4 lg:px-8">
          {activeSection === "overview" && (
            <OverviewSection family={family} />
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
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Edit overview</h2>
        </div>
        <UpdateFamilyForm
          family={family}
          onCancel={() => setIsEditing(false)}
          onSuccess={() => setIsEditing(false)}
        />
      </div>
    );
  }

  const statusLabel = family.status === "on_hold" ? "On hold" : family.status === "closed" ? "Closed" : "Active";
  const urgencyLabel = family.urgency ?? "—";

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Overview & circumstances</h2>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 text-sm"
            onClick={() => setIsEditing(true)}
          >
            Edit
          </Button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Status</dt>
            <dd className="font-medium text-slate-900">{statusLabel}</dd>
            <dt className="text-slate-500">Urgency</dt>
            <dd className="font-medium text-slate-900 capitalize">{String(urgencyLabel)}</dd>
          </dl>
          {family.summary ? (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-xs font-medium text-slate-500">Summary</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{family.summary}</p>
            </div>
          ) : null}
          {family.household_notes ? (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-xs font-medium text-slate-500">Current circumstances</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{family.household_notes}</p>
            </div>
          ) : null}
          {!family.summary && !family.household_notes ? (
            <p className="mt-2 text-sm text-slate-500">No summary or circumstances recorded.</p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Goals</h3>
          {family.goals.length === 0 ? (
            <p className="text-sm text-slate-500">No goals recorded</p>
          ) : (
            <ul className="space-y-1">
              {family.goals.map((g) => (
                <li key={g.id} className="flex gap-2 rounded border border-slate-100 bg-white px-2 py-1.5 text-sm text-slate-800">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-blue-500/90" />
                  <span>{g.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Barriers</h3>
          {family.barriers.length === 0 ? (
            <p className="text-sm text-slate-500">No barriers recorded</p>
          ) : (
            <ul className="space-y-1">
              {family.barriers.map((b) => (
                <li key={b.id} className="flex gap-2 rounded border border-slate-100 bg-white px-2 py-1.5 text-sm text-slate-800">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500/90" />
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

function PlanSection({ family }: { family: FamilyDetail }) {
  return (
    <div className="space-y-6">
      <PlanPanel
        key={family.plan?.id ?? "no-plan"}
        familyId={family.id}
        plan={family.plan ?? null}
        familyName={family.name}
        resourceMatches={family.resourceMatches}
      />
    </div>
  );
}

function MembersSection({ family }: { family: FamilyDetail }) {
  const [isEditing, setIsEditing] = useState(false);
  const [members, setMembers] = useState(family.members);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addMember() {
    setMembers((prev) => [
      ...prev,
      {
        id: "",
        family_id: family.id,
        display_name: "",
        relationship: null,
        notes: null,
        age_approx: null,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  function removeMember(index: number) {
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = members
      .filter((m) => m.display_name.trim())
      .map((m) => ({
        id: m.id || undefined,
        display_name: m.display_name.trim(),
        relationship: m.relationship,
        notes: m.notes,
        age_approx: m.age_approx,
      }));
    startTransition(async () => {
      const r = await updateFamilyMembers({
        familyId: family.id,
        members: valid,
      });
      if (!r.ok) setError(r.error);
      else setIsEditing(false);
    });
  }

  if (isEditing) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Edit household members</h2>
          <Button type="button" variant="outline" className="text-sm" onClick={() => setIsEditing(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          {members.map((m, i) => (
            <div key={m.id || i} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-sm font-medium text-slate-600">Member {i + 1}</span>
                <Button type="button" variant="ghost" className="text-sm" onClick={() => removeMember(i)}>
                  Remove
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`m-name-${i}`}>Name</Label>
                  <Input
                    id={`m-name-${i}`}
                    value={m.display_name}
                    onChange={(e) =>
                      setMembers((prev) => {
                        const next = [...prev];
                        next[i] = { ...next[i]!, display_name: e.target.value };
                        return next;
                      })
                    }
                    className="mt-1"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor={`m-rel-${i}`}>Relationship</Label>
                  <Input
                    id={`m-rel-${i}`}
                    value={m.relationship ?? ""}
                    onChange={(e) =>
                      setMembers((prev) => {
                        const next = [...prev];
                        next[i] = { ...next[i]!, relationship: e.target.value || null };
                        return next;
                      })
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`m-age-${i}`}>Age (approx)</Label>
                  <Input
                    id={`m-age-${i}`}
                    type="number"
                    min={0}
                    max={120}
                    value={m.age_approx ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMembers((prev) => {
                        const next = [...prev];
                        next[i] = { ...next[i]!, age_approx: v === "" ? null : parseInt(v, 10) || null };
                        return next;
                      });
                    }}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor={`m-notes-${i}`}>Notes</Label>
                <textarea
                  id={`m-notes-${i}`}
                  value={m.notes ?? ""}
                  onChange={(e) =>
                    setMembers((prev) => {
                      const next = [...prev];
                      next[i] = { ...next[i]!, notes: e.target.value || null };
                      return next;
                    })
                  }
                  className={cn("mt-1 min-h-[4rem]", textareaClass)}
                />
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="text-sm" onClick={addMember}>
              Add member
            </Button>
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Household members</h2>
          <p className="mt-1 text-sm text-slate-600">People in the household.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="text-sm"
          onClick={() => {
            setMembers(family.members);
            setIsEditing(true);
          }}
        >
          Edit
        </Button>
      </div>
      {family.members.length === 0 ? (
        <EmptyState
          className="mt-4 border-slate-200 bg-slate-50/50 py-8"
          title="No additional members"
          description="Add household members to track who is in the family."
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
  const [isEditing, setIsEditing] = useState(false);
  const [goals, setGoals] = useState(family.goals);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addGoal() {
    setGoals((prev) => [
      ...prev,
      {
        id: "",
        family_id: family.id,
        preset_key: null,
        label: "",
        sort_order: prev.length,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  function removeGoal(index: number) {
    setGoals((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = goals.filter((g) => g.label.trim()).map((g) => ({ id: g.id || undefined, label: g.label.trim() }));
    startTransition(async () => {
      const r = await updateFamilyGoals({
        familyId: family.id,
        goals: valid,
      });
      if (!r.ok) setError(r.error);
      else setIsEditing(false);
    });
  }

  if (isEditing) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Edit goals</h2>
          <Button type="button" variant="outline" className="text-sm" onClick={() => setIsEditing(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          {goals.map((g, i) => (
            <div key={g.id || i} className="flex items-center gap-2">
              <Input
                value={g.label}
                onChange={(e) =>
                  setGoals((prev) => {
                    const next = [...prev];
                    next[i] = { ...next[i]!, label: e.target.value };
                    return next;
                  })
                }
                placeholder="Goal"
                className="flex-1"
              />
              <Button type="button" variant="ghost" className="text-sm" onClick={() => removeGoal(i)}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="text-sm" onClick={addGoal}>
              Add goal
            </Button>
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Goals</h2>
          <p className="mt-1 text-sm text-slate-600">Family goals.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="text-sm"
          onClick={() => {
            setGoals(family.goals);
            setIsEditing(true);
          }}
        >
          Edit
        </Button>
      </div>
      {family.goals.length === 0 ? (
        <EmptyState
          className="mt-4 border-slate-200 bg-slate-50/50 py-8"
          title="No goals recorded"
          description="Add goals to track what the family is working toward."
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
  const [isEditing, setIsEditing] = useState(false);
  const [barriers, setBarriers] = useState(family.barriers);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addBarrier() {
    setBarriers((prev) => [
      ...prev,
      {
        id: "",
        family_id: family.id,
        preset_key: null,
        label: "",
        sort_order: prev.length,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  function removeBarrier(index: number) {
    setBarriers((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = barriers
      .filter((b) => b.label.trim())
      .map((b) => ({ id: b.id || undefined, label: b.label.trim() }));
    startTransition(async () => {
      const r = await updateFamilyBarriers({
        familyId: family.id,
        barriers: valid,
      });
      if (!r.ok) setError(r.error);
      else setIsEditing(false);
    });
  }

  if (isEditing) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Edit barriers</h2>
          <Button type="button" variant="outline" className="text-sm" onClick={() => setIsEditing(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          {barriers.map((b, i) => (
            <div key={b.id || i} className="flex items-center gap-2">
              <Input
                value={b.label}
                onChange={(e) =>
                  setBarriers((prev) => {
                    const next = [...prev];
                    next[i] = { ...next[i]!, label: e.target.value };
                    return next;
                  })
                }
                placeholder="Barrier"
                className="flex-1"
              />
              <Button type="button" variant="ghost" className="text-sm" onClick={() => removeBarrier(i)}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="text-sm" onClick={addBarrier}>
              Add barrier
            </Button>
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Barriers</h2>
          <p className="mt-1 text-sm text-slate-600">Known barriers.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="text-sm"
          onClick={() => {
            setBarriers(family.barriers);
            setIsEditing(true);
          }}
        >
          Edit
        </Button>
      </div>
      {family.barriers.length === 0 ? (
        <EmptyState
          className="mt-4 border-slate-200 bg-slate-50/50 py-8"
          title="No barriers recorded"
          description="Add barriers to track what the family is working to overcome."
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
