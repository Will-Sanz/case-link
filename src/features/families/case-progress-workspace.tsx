"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar as CalendarDays,
  CheckCircle as CheckCircle2,
  ClockRotateRight as History,
  NavArrowDown as ChevronDown,
} from "iconoir-react";
import { captureCaseProgressUpdate } from "@/app/actions/case-progress";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  describeProgressChange,
  listProgressActionOptions,
  progressStatusLabel,
} from "@/lib/domain/family-workspace/case-progress";
import { validateNoPii } from "@/lib/privacy/no-pii";
import type {
  CaseNoteRow,
  CaseProgressUpdateRow,
  PlanStepActionItemRow,
  PlanWithSteps,
} from "@/types/family";

type ActionDraft = {
  selected: boolean;
  status: PlanStepActionItemRow["status"];
  targetDate: string;
  followUpDate: string;
  notes: string;
  outcome: string;
};

function localDateOnly(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}

function initialDraft(action: PlanStepActionItemRow): ActionDraft {
  return {
    selected: false,
    status: action.status,
    targetDate: action.target_date ?? "",
    followUpDate: action.follow_up_date ?? "",
    notes: action.notes ?? "",
    outcome: action.outcome ?? "",
  };
}

function normalizedOptional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function CaseProgressWorkspace({
  familyId,
  plan,
  updates,
  earlierNotes,
}: {
  familyId: string;
  plan: PlanWithSteps;
  updates: CaseProgressUpdateRow[];
  earlierNotes: CaseNoteRow[];
}) {
  const router = useRouter();
  const actionOptions = useMemo(() => listProgressActionOptions(plan), [plan]);
  const [formOpen, setFormOpen] = useState(false);
  const [occurredOn, setOccurredOn] = useState(localDateOnly);
  const [summary, setSummary] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>(() =>
    Object.fromEntries(actionOptions.map(({ action }) => [action.id, initialDraft(action)])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const latestUpdate = updates[0] ?? null;
  const latestEarlierNote = earlierNotes[0] ?? null;
  const nextAction = actionOptions[0] ?? null;

  function patchDraft(actionId: string, patch: Partial<ActionDraft>) {
    setDrafts((current) => ({
      ...current,
      [actionId]: { ...(current[actionId] ?? initialDraft(
        actionOptions.find(({ action }) => action.id === actionId)!.action,
      )), ...patch },
    }));
    setError(null);
  }

  async function submitProgress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const selected = actionOptions.filter(({ action }) => drafts[action.id]?.selected);
    const privacy = validateNoPii([
      { field: "summary", label: "Progress note", value: summary },
      ...selected.flatMap(({ action }, index) => [
        {
          field: `changes.${index}.notes`,
          label: "Action progress note",
          value: drafts[action.id]?.notes,
        },
        {
          field: `changes.${index}.outcome`,
          label: "Action outcome",
          value: drafts[action.id]?.outcome,
        },
      ]),
    ]);
    if (!privacy.ok) {
      setError(privacy.error);
      return;
    }

    let validationError: string | null = null;
    const changes = selected.flatMap(({ action }) => {
      const draft = drafts[action.id];
      if (!draft) return [];
      if (["pending", "in_progress"].includes(draft.status) && !draft.targetDate) {
        validationError ??= `Choose a target date for “${action.title}”.`;
        return [];
      }
      if (draft.status === "blocked" && (!draft.followUpDate || !draft.notes.trim())) {
        validationError ??= `Add a waiting reason and follow-up date for “${action.title}”.`;
        return [];
      }
      const next = {
        actionItemId: action.id,
        expectedUpdatedAt: action.updated_at,
        status: draft.status,
        targetDate: draft.targetDate || null,
        followUpDate: draft.followUpDate || null,
        notes: normalizedOptional(draft.notes),
        outcome: normalizedOptional(draft.outcome),
      };
      const changed =
        next.status !== action.status ||
        next.targetDate !== action.target_date ||
        next.followUpDate !== action.follow_up_date ||
        next.notes !== normalizedOptional(action.notes) ||
        next.outcome !== normalizedOptional(action.outcome);
      return changed ? [next] : [];
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setPending(true);
    try {
      const result = await captureCaseProgressUpdate({
        familyId,
        planId: plan.id,
        occurredOn,
        summary,
        changes,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary("");
      setDrafts(
        Object.fromEntries(actionOptions.map(({ action }) => [action.id, initialDraft(action)])),
      );
      setFormOpen(false);
      setSuccess(
        changes.length > 0
          ? `Progress saved with ${changes.length} plan ${changes.length === 1 ? "change" : "changes"}.`
          : "Progress saved to the case history.",
      );
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] [box-shadow:var(--shadow-surface)]" aria-labelledby="continue-case-heading">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <History className="size-5" aria-hidden />
            </span>
            <div>
              <h2 id="continue-case-heading" className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">Continue from the last update</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--color-ink-muted)]">A shared record of what changed and what the plan says to do next.</p>
            </div>
          </div>

          {latestUpdate ? (
            <div className="mt-5 border-l border-[var(--color-rule-strong)] pl-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-strong)]">{latestUpdate.summary}</p>
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                Meeting {formatDate(latestUpdate.occurred_on)} · {latestUpdate.author?.email ?? "Case manager"}
              </p>
            </div>
          ) : latestEarlierNote ? (
            <div className="mt-5 border-l border-[var(--color-rule-strong)] pl-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-strong)]">{latestEarlierNote.body}</p>
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Earlier note · {formatDate(latestEarlierNote.created_at)}</p>
            </div>
          ) : (
            <p className="mt-5 max-w-xl text-sm leading-6 text-[var(--color-ink-muted)]">No progress update has been recorded yet. Save the next meeting once, with any plan changes, to establish the handoff.</p>
          )}
        </div>

        <div className="border-t border-[var(--color-rule-soft)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Next plan action</p>
          {nextAction ? (
            <div className="mt-3">
              <p className="text-sm font-medium leading-6 text-[var(--color-ink-strong)]">{nextAction.action.title}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-ink-faint)]">{nextAction.goal}</p>
              <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                <span className="rounded-full bg-[var(--color-paper-2)] px-2.5 py-1 font-semibold text-[var(--color-ink-2)]">{progressStatusLabel(nextAction.action.status)}</span>
                {nextAction.effectiveDate ? (
                  <time dateTime={nextAction.effectiveDate} className="inline-flex items-center gap-1.5 font-medium text-[var(--color-accent)]"><CalendarDays className="size-3.5" aria-hidden />{nextAction.action.status === "blocked" ? "Follow up" : "Target"} {formatDate(nextAction.effectiveDate)}</time>
                ) : (
                  <span className="font-medium text-[var(--color-attention)]">Date needed</span>
                )}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">All dated actions are complete. Record the outcome before planning new work.</p>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--color-rule)] bg-[var(--color-paper)] px-5 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => {
            setFormOpen((value) => !value);
            setError(null);
            setSuccess(null);
          }}
          aria-expanded={formOpen}
          className="flex min-h-11 w-full items-center justify-between gap-4 text-left text-sm font-semibold text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30"
        >
          <span>{formOpen ? "Close progress update" : "Record meeting progress"}</span>
          <ChevronDown className={`size-4 transition-transform ${formOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>

        {success ? <p className="mt-3 flex items-center gap-2 text-sm font-medium text-[var(--color-positive)]" role="status"><CheckCircle2 className="size-4" aria-hidden />{success}</p> : null}

        {formOpen ? (
          <form onSubmit={submitProgress} className="mt-5 space-y-6 border-t border-[var(--color-rule)] pt-5">
            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <label className="block text-sm font-medium text-[var(--color-ink-2)]">
                Meeting date
                <input type="date" value={occurredOn} max={localDateOnly()} onChange={(event) => setOccurredOn(event.target.value)} required className="mt-2 min-h-11 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)]" />
              </label>
              <label className="block text-sm font-medium text-[var(--color-ink-2)]">
                What changed since the last meeting?
                <Textarea value={summary} onChange={(event) => { setSummary(event.target.value); setError(null); }} required rows={4} maxLength={12000} placeholder="Record progress, decisions, barriers, and the agreed next focus…" className="mt-2 min-h-28 bg-[var(--color-surface)]" />
              </label>
            </div>

            {actionOptions.length > 0 ? (
              <fieldset>
                <legend className="text-sm font-semibold text-[var(--color-ink)]">Update plan actions <span className="font-normal text-[var(--color-ink-faint)]">(optional)</span></legend>
                <p className="mt-1 text-xs leading-5 text-[var(--color-ink-faint)]">Select only actions discussed in this meeting. Their current values stay in place until this whole update saves.</p>
                <div className="mt-3 divide-y divide-[var(--color-rule-soft)] border-y border-[var(--color-rule)]">
                  {actionOptions.map(({ action, goal }) => {
                    const draft = drafts[action.id] ?? initialDraft(action);
                    return (
                      <div key={action.id} className="py-4">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input type="checkbox" checked={draft.selected} onChange={(event) => patchDraft(action.id, { selected: event.target.checked })} className="mt-1 size-4 accent-[var(--color-accent)]" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--color-ink)]">{action.title}</span>
                            <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{goal} · {progressStatusLabel(action.status)}</span>
                          </span>
                        </label>

                        {draft.selected ? (
                          <div className="ml-7 mt-4 grid gap-4 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] p-4 sm:grid-cols-2">
                            <label className="text-xs font-medium text-[var(--color-ink-muted)]">Status
                              <select value={draft.status} onChange={(event) => patchDraft(action.id, { status: event.target.value as ActionDraft["status"] })} className="mt-1.5 min-h-11 w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)]">
                                <option value="pending">Not started</option>
                                <option value="in_progress">In progress</option>
                                <option value="blocked">Waiting</option>
                                <option value="completed">Completed</option>
                              </select>
                            </label>
                            {draft.status === "blocked" ? (
                              <label className="text-xs font-medium text-[var(--color-ink-muted)]">Next follow-up date
                                <input type="date" value={draft.followUpDate} onChange={(event) => patchDraft(action.id, { followUpDate: event.target.value })} required className="mt-1.5 min-h-11 w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)]" />
                              </label>
                            ) : draft.status !== "completed" ? (
                              <label className="text-xs font-medium text-[var(--color-ink-muted)]">Target date
                                <input type="date" value={draft.targetDate} onChange={(event) => patchDraft(action.id, { targetDate: event.target.value })} required className="mt-1.5 min-h-11 w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)]" />
                              </label>
                            ) : <div />}
                            <label className="text-xs font-medium text-[var(--color-ink-muted)] sm:col-span-2">{draft.status === "blocked" ? "Why is this waiting?" : "Progress note (optional)"}
                              <Textarea rows={2} value={draft.notes} onChange={(event) => patchDraft(action.id, { notes: event.target.value })} required={draft.status === "blocked"} maxLength={4000} className="mt-1.5 min-h-16" />
                            </label>
                            <label className="text-xs font-medium text-[var(--color-ink-muted)] sm:col-span-2">Outcome (optional)
                              <Textarea rows={2} value={draft.outcome} onChange={(event) => patchDraft(action.id, { outcome: event.target.value })} maxLength={4000} className="mt-1.5 min-h-16" />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {error ? <p className="rounded-lg bg-[var(--color-error-bg)] px-4 py-3 text-sm font-medium text-[var(--color-error)]" role="alert">{error}</p> : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-xs leading-5 text-[var(--color-ink-faint)]">Use household labels only. Saving creates one permanent history entry; it does not replace the plan or submit paperwork.</p>
              <Button type="submit" className="min-h-11" disabled={pending}>{pending ? "Saving update…" : "Save progress update"}</Button>
            </div>
          </form>
        ) : null}
      </div>

      {(updates.length > 0 || earlierNotes.length > 0) ? (
        <div className="border-t border-[var(--color-rule)] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">Case history</h3>
            <p className="text-xs text-[var(--color-ink-faint)]">Progress updates are saved records and cannot be edited or deleted.</p>
          </div>
          <ol className="mt-4 divide-y divide-[var(--color-rule-soft)] border-t border-[var(--color-rule-soft)]">
            {updates.slice(0, 8).map((update) => (
              <li key={update.id} className="py-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">Meeting {formatDate(update.occurred_on)}</p>
                  <p className="text-xs text-[var(--color-ink-faint)]">Saved {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(update.created_at))} · {update.author?.email ?? "Case manager"}</p>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-strong)]">{update.summary}</p>
                {update.plan_changes.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {update.plan_changes.map((change) => (
                      <li key={change.action_item_id} className="text-xs leading-5 text-[var(--color-ink-muted)]"><span className="font-semibold text-[var(--color-ink-2)]">{change.title}:</span> {describeProgressChange(change).join(" · ")}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {earlierNotes.slice(0, Math.max(0, 8 - updates.length)).map((note) => (
              <li key={note.id} className="py-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">Earlier case note</p>
                  <p className="text-xs text-[var(--color-ink-faint)]">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.created_at))} · {note.author?.email ?? "Case manager"}</p>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink-strong)]">{note.body}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
