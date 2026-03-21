import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { AddCaseNoteForm } from "@/features/families/add-case-note-form";
import { PhasePlaceholder } from "@/features/families/phase-placeholder";
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

export function FamilyWorkspace({ family }: { family: FamilyDetail }) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/families"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            ← Families
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            {family.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={family.status} />
            <UrgencyBadge urgency={family.urgency} />
            {family.creator?.email ? (
              <span className="text-sm text-slate-500">
                Created by {family.creator.email}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Updated {formatDt(family.updated_at)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle className="text-base">Overview & circumstances</CardTitle>
          <div className="mt-4">
            <UpdateFamilyForm family={family} />
          </div>
        </Card>
        <Card>
          <CardTitle className="text-base">Goals</CardTitle>
          {family.goals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No goals recorded.</p>
          ) : (
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-800">
              {family.goals.map((g) => (
                <li key={g.id}>{g.label}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle className="text-base">Barriers</CardTitle>
          {family.barriers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No barriers recorded.</p>
          ) : (
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-800">
              {family.barriers.map((b) => (
                <li key={b.id}>{b.label}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle className="text-base">Household members</CardTitle>
          {family.members.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              No additional members listed.
            </p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm text-slate-800">
              {family.members.map((m) => (
                <li key={m.id} className="border-b border-slate-100 pb-3 last:border-0">
                  <p className="font-medium">{m.display_name}</p>
                  {m.relationship ? (
                    <p className="text-slate-600">{m.relationship}</p>
                  ) : null}
                  {m.age_approx != null ? (
                    <p className="text-slate-600">Age ~{m.age_approx}</p>
                  ) : null}
                  {m.notes ? (
                    <p className="mt-1 text-slate-600">{m.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle className="text-base">Case notes</CardTitle>
        <div className="mt-4 border-b border-slate-100 pb-6">
          <AddCaseNoteForm familyId={family.id} />
        </div>
        {family.caseNotes.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No notes yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {family.caseNotes.map((n) => (
              <li
                key={n.id}
                className="border-b border-slate-100 pb-4 last:border-0"
              >
                <p className="text-xs text-slate-500">
                  {formatDt(n.created_at)}
                  {n.author?.email ? (
                    <span className="ml-2">· {n.author.email}</span>
                  ) : null}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                  {n.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle className="text-base">Activity</CardTitle>
        {family.activity.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No events yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {family.activity.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="shrink-0 text-xs text-slate-500">
                  {formatDt(a.created_at)}
                </span>
                <span>
                  <span className="font-medium text-slate-800">{a.action}</span>
                  {a.entity_type ? (
                    <span className="text-slate-600"> · {a.entity_type}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <PhasePlaceholder
          title="Matched resources"
          description="Deterministic matching and accept/dismiss will appear in Phase 3."
        />
        <PhasePlaceholder
          title="30 / 60 / 90 day plan"
          description="Plan generation and editable steps ship in Phase 4."
        />
        <PhasePlaceholder
          title="Referrals & tasks"
          description="Outreach tracking and tasks land in Phase 5."
        />
      </div>
    </div>
  );
}
