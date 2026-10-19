"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionTargetDate } from "@/lib/domain/plan/action-state";
import { groupPlanStepsByGoal } from "@/lib/domain/plan/group-plan-steps";
import { formatDateOnly } from "@/lib/dates";
import { buildFamilyTakeaway, openTakeawayActions, type FamilyTakeawaySelection as Selection } from "@/features/families/family-takeaway-data";
import type { PlanWithSteps } from "@/types/family";

const ownerLabels = { case_manager: "Case manager", family: "Family", shared: "Shared", school_program: "School / program" };

export function FamilyTakeawaySelection({ plan, onPrepare, onChange }: {
  plan: PlanWithSteps;
  onPrepare: (selection: Selection) => void;
  onChange: () => void;
}) {
  const [selection, setSelection] = useState<Selection>({ actionIds: [], contactKeys: [], nextCheckIn: "", discussedWithFamily: false });
  const [error, setError] = useState<string | null>(null);
  const goals = groupPlanStepsByGoal(plan.steps).filter(goal => goal.steps.some(step => step.action_items?.some(action => action.status !== "completed")));
  function change(patch: Partial<Selection>) {
    setSelection(previous => ({ ...previous, discussedWithFamily: false, ...patch }));
    setError(null);
    onChange();
  }

  return (
    <form
      className="space-y-5 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4 sm:p-5"
      onSubmit={event => {
        event.preventDefault();
        try {
          buildFamilyTakeaway(plan, selection);
          onPrepare(selection);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Check the selected details and try again.");
        }
      }}
    >
      <div>
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Choose what to share</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">Choose a manageable set of steps discussed with the family. The takeaway uses the goal, action title, owner, and date shown here. Internal notes and descriptions stay out.</p>
      </div>
      {goals.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">This plan has no open actions to share. You can still download the record PDF.</p> : null}
      {goals.map(goal => (
        <fieldset key={goal.key} className="border-t border-[var(--color-rule)] pt-3">
          <legend className="max-w-full break-words pr-3 text-sm font-semibold text-[var(--color-ink)]">{goal.title}</legend>
          {goal.steps.map(step => (
            <div key={step.id}>
              {openTakeawayActions(step).map(action => (
                <label key={action.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                    checked={selection.actionIds.includes(action.id)}
                    onChange={event => {
                      const actionIds = event.target.checked ? [...selection.actionIds, action.id] : selection.actionIds.filter(id => id !== action.id);
                      const stillSelected = step.action_items?.some(item => actionIds.includes(item.id));
                      change({ actionIds, contactKeys: stillSelected ? selection.contactKeys : selection.contactKeys.filter(key => !key.startsWith(`${step.id}:`)) });
                    }}
                  />
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-[var(--color-ink)]">{action.title}</span>
                    <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">{ownerLabels[step.details?.owner ?? "case_manager"]} · {action.status === "blocked" ? "Waiting · Follow-up" : "Target date"}: {formatDateOnly(actionTargetDate(action)) ?? "Not set"}</span>
                  </span>
                </label>
              ))}
              {step.action_items?.some(action => selection.actionIds.includes(action.id)) && step.details?.contacts?.length ? (
                <fieldset className="ml-7 border-t border-[var(--color-rule)] py-2">
                  <legend className="pr-2 text-xs font-medium text-[var(--color-ink-muted)]">Contacts to include (optional)</legend>
                  {step.details.contacts.map((contact, index) => {
                    const key = `${step.id}:${index}`;
                    const label = [contact.name, contact.phone, contact.email].filter(Boolean).join(" · ");
                    return label ? (
                      <label key={key} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm text-[var(--color-ink)]">
                        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" checked={selection.contactKeys.includes(key)} onChange={event => change({ contactKeys: event.target.checked ? [...selection.contactKeys, key] : selection.contactKeys.filter(value => value !== key) })} />
                        <span className="min-w-0 break-words">{label}</span>
                      </label>
                    ) : null;
                  })}
                </fieldset>
              ) : null}
            </div>
          ))}
        </fieldset>
      ))}
      <div className="max-w-xs">
        <label htmlFor="family-takeaway-check-in" className="mb-2 block text-sm font-medium text-[var(--color-ink)]">Next check-in (optional)</label>
        <Input id="family-takeaway-check-in" type="date" value={selection.nextCheckIn} onChange={event => change({ nextCheckIn: event.target.value })} aria-describedby="family-takeaway-check-in-help" />
        <p id="family-takeaway-check-in-help" className="mt-2 text-xs leading-5 text-[var(--color-ink-muted)]">Add only a date you discussed with the family.</p>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 border-t border-[var(--color-rule)] pt-4 text-sm leading-6 text-[var(--color-ink)]">
        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" checked={selection.discussedWithFamily} onChange={event => change({ discussedWithFamily: event.target.checked })} />
        <span>I discussed these selected steps and dates with the family and checked that all selected wording and contacts are appropriate to share.</span>
      </label>
      {error ? <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p> : null}
      <Button type="submit" className="min-h-11" disabled={!selection.actionIds.length || !selection.discussedWithFamily}>Prepare family takeaway</Button>
    </form>
  );
}
