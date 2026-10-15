"use client";

import type { RefinementChange } from "@/lib/domain/plan/refinement-review";

export function RefinementChangeReview({ changes, selected, onSelect }: {
  changes: RefinementChange[];
  selected: string[];
  onSelect: (id: string, checked: boolean) => void;
}) {
  return <fieldset className="space-y-3">
    <legend className="text-sm font-semibold text-[var(--color-ink)]">Choose changes to apply</legend>
    <p className="text-xs text-[var(--color-ink-muted)]">Select only the changes you want. Completed tasks, ownership, and progress notes stay unchanged.</p>
    {changes.length === 0 ? <p role="status" className="text-sm">No supported changes were proposed.</p> : changes.map(change => <label key={change.id} className="block rounded-lg border border-[var(--color-rule)] p-3">
      <span className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" checked={selected.includes(change.id)} onChange={event => onSelect(change.id, event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]" aria-label={change.label} />{change.label}</span>
      <span className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
        <span><span className="block text-xs text-[var(--color-ink-muted)]">Current draft</span><span className="whitespace-pre-wrap">{change.before}</span></span>
        <span><span className="block text-xs text-[var(--color-ink-muted)]">Proposed change</span><span className="whitespace-pre-wrap">{change.after}</span></span>
      </span>
    </label>)}
  </fieldset>;
}
