"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { textareaClass } from "@/lib/ui/form-classes";
import { cn } from "@/lib/utils/cn";
import {
  actionUiStatus,
  actionUserNotes,
  encodeActionNotes,
  isActionNoLongerNeeded,
  type ActionUiStatus,
} from "@/lib/domain/plan/action-state";
import type { PlanStepActionItemRow, PlanStepDetails, PlanStepRow } from "@/types/family";
import {
  buildMainParagraph,
  contactsFromEditable,
  contactsToEditable,
  documentsFromEditable,
  documentsToEditable,
  formatContactDisplay,
  formatDocumentsDisplay,
  formatOutcomeDisplay,
  formatRecordNotes,
  parseMainParagraphOnSave,
} from "@/features/families/plan-case-note-derive";

type FocusField = "title" | "body" | "documents" | "contact" | "outcome" | null;

const sectionLabelClass =
  "text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]";

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className={sectionLabelClass}>{children}</p>;
}

function RefineComparisonCard({
  label,
  title,
  summary,
  outcome,
  documents,
  contact,
  proposed = false,
}: {
  label: string;
  title: string;
  summary: string;
  outcome: string | null;
  documents: string | null;
  contact: string | null;
  proposed?: boolean;
}) {
  const fields = [
    ["Title", title],
    ["Summary", summary],
    ["Expected result", outcome],
    ["Documents", documents],
    ["Contact", contact],
  ] as const;

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        proposed
          ? "border-[var(--color-positive-rule)] bg-[var(--color-positive-bg)]"
          : "border-[var(--color-rule)] bg-[var(--color-paper)]",
      )}
    >
      <p className={cn(sectionLabelClass, proposed && "text-[var(--color-positive)]")}>{label}</p>
      <dl className="mt-3 space-y-3">
        {fields.map(([fieldLabel, value]) => (
          <div key={fieldLabel}>
            <dt className="text-[11px] font-medium text-[var(--color-ink-faint)]">{fieldLabel}</dt>
            <dd
              className={cn(
                "mt-0.5 whitespace-pre-wrap text-sm leading-relaxed",
                value?.trim() ? "text-[var(--color-ink-strong)]" : "italic text-[var(--color-ink-faint)]",
                fieldLabel === "Title" && value?.trim() && "font-semibold text-[var(--color-ink)]",
              )}
            >
              {value?.trim() || "Not set"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatDateOnly(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(parsed);
}

function ownerLabel(owner: PlanStepDetails["owner"]): string {
  if (owner === "family") return "Family";
  if (owner === "school_program") return "School / program";
  if (owner === "shared") return "Shared";
  return "Case manager";
}

function useAutosizeTextarea(value: string, minRows = 3) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lineCount = value.split(/\r?\n/).length;
  const rows = Math.max(minRows, Math.min(24, lineCount + 1));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 24)}px`;
  }, [value, minRows]);

  return { ref, rows };
}

function DocumentField({
  editing,
  focused,
  onFocus,
  onBlur,
  value,
  onChange,
  displayText,
}: {
  editing: boolean;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  value: string;
  onChange: (v: string) => void;
  displayText: string | null;
}) {
  const { ref, rows } = useAutosizeTextarea(value, 2);
  if (!editing) {
    if (!displayText) return null;
    return <p className="text-[15px] leading-relaxed text-[var(--color-ink-2)]">{displayText}</p>;
  }
  if (focused) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-[var(--color-ink-faint)]">One item per line</p>
        <textarea
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn(
            textareaClass,
            "min-h-[3rem] w-full resize-y border-0 border-b border-[var(--color-rule)] bg-transparent px-0 py-1 text-[15px] leading-relaxed text-[var(--color-ink-strong)] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
          autoFocus
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onFocus}
      className="w-full text-left text-[15px] leading-relaxed text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]"
    >
      {displayText ?? (
        <span className="text-[var(--color-ink-faint)] italic">Add documents the client will need…</span>
      )}
    </button>
  );
}

export function PlanStepCaseNote({
  step,
  editing,
  onPatchStep,
  onPatchDetails,
  onPatchActionItem,
  onToggleActionItem,
  actionToggleDisabled,
  onPatchWorkflow,
  onBeginEdit,
  onSaveEdits,
  onCancelEdits,
  onDeleteStep,
  stepSavePending,
  stepDirty,
  refineOpen,
  refineInstruction,
  refinePreview,
  refinePending,
  onRefineInstruction,
  onRefineRun,
  onRefineApply,
  onRefineClose,
  onRefineDiscardPreview,
  onOpenRefine,
}: {
  step: PlanStepRow;
  editing: boolean;
  onPatchStep: (patch: Partial<PlanStepRow>) => void;
  onPatchDetails: (patch: Partial<PlanStepDetails>) => void;
  onPatchActionItem: (actionItemId: string, patch: Partial<PlanStepActionItemRow>) => void;
  onToggleActionItem?: (actionItemId: string, done: boolean, expectedUpdatedAt: string) => void;
  actionToggleDisabled?: boolean;
  onPatchWorkflow?: (patch: NonNullable<PlanStepRow["workflow_data"]>) => void;
  onBeginEdit?: () => void;
  onSaveEdits?: () => void;
  onCancelEdits?: () => void;
  onDeleteStep?: () => void;
  stepSavePending?: boolean;
  stepDirty?: boolean;
  refineOpen: boolean;
  refineInstruction: string;
  refinePreview: {
    title: string;
    description: string;
    details: PlanStepDetails;
    stepPriority?: PlanStepRow["priority"];
  } | null;
  refinePending: boolean;
  onRefineInstruction: (v: string) => void;
  onRefineRun: () => void;
  onRefineApply: () => void;
  onRefineClose: () => void;
  onRefineDiscardPreview: () => void;
  onOpenRefine: () => void;
}) {
  const d = useMemo(() => (step.details ?? {}) as PlanStepDetails, [step.details]);
  const [focus, setFocus] = useState<FocusField>(null);
  const titleId = useId();
  const bodyId = useId();

  const mainParagraphRead = useMemo(() => buildMainParagraph(step), [step]);
  const [bodyDraft, setBodyDraft] = useState("");
  const documentsEditable = useMemo(() => documentsToEditable(d), [d]);
  const contactEditable = useMemo(() => contactsToEditable(d.contacts), [d.contacts]);
  const outcomeEditable = d.expected_outcome?.trim() ?? "";
  const documentsDisplay = useMemo(() => formatDocumentsDisplay(d), [d]);
  const contactDisplay = useMemo(() => formatContactDisplay(d), [d]);
  const outcomeDisplay = useMemo(() => formatOutcomeDisplay(d), [d]);
  const refineDocumentsDisplay = useMemo(
    () => (refinePreview ? formatDocumentsDisplay(refinePreview.details) : null),
    [refinePreview],
  );
  const refineContactDisplay = useMemo(
    () => (refinePreview ? formatContactDisplay(refinePreview.details) : null),
    [refinePreview],
  );
  const recordNotes = useMemo(() => formatRecordNotes(step.workflow_data), [step.workflow_data]);
  const actions = useMemo(
    () =>
      [...(step.action_items ?? [])].sort((a, b) => {
        if (a.target_date && b.target_date && a.target_date !== b.target_date) {
          return a.target_date.localeCompare(b.target_date);
        }
        if (a.target_date && !b.target_date) return -1;
        if (!a.target_date && b.target_date) return 1;
        return a.sort_order - b.sort_order;
      }),
    [step.action_items],
  );
  const completedActionCount = actions.filter((action) => action.status === "completed").length;

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const { ref: bodyRef, rows: bodyRows } = useAutosizeTextarea(
    focus === "body" ? bodyDraft : mainParagraphRead,
    4,
  );

  const commitBody = useCallback(
    (text: string) => {
      const { description, timing_guidance } = parseMainParagraphOnSave(text);
      onPatchStep({ description });
      onPatchDetails({
        timing_guidance: timing_guidance || undefined,
      });
    },
    [onPatchDetails, onPatchStep],
  );

  const startBodyEdit = useCallback(() => {
    setBodyDraft(buildMainParagraph(step));
    setFocus("body");
  }, [step]);

  const blurBody = useCallback(() => {
    commitBody(bodyDraft);
    setFocus(null);
  }, [bodyDraft, commitBody]);

  // Clear field focus when leaving edit mode so the next edit session starts neutral.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local UI state when `editing` flips off
    if (!editing) setFocus(null);
  }, [editing]);

  const metaLine = [
    step.status === "blocked" ? "Waiting" : step.status.replace("_", " "),
    `Owner: ${ownerLabel(d.owner)}`,
    (step.priority ?? d.priority ?? "medium").replace("_", " ") + " priority",
    actions.length > 0 ? `${completedActionCount} of ${actions.length} actions complete` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" · ");

  return (
    <article
      id={`step-${step.id}`}
      className={cn(
        "max-w-[760px] rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-4",
        editing && "border-[var(--color-accent-rule)] ring-2 ring-[var(--color-focus)]/15 ring-offset-2 ring-offset-transparent",
      )}
    >
      <div className="space-y-5 py-4 pr-2">
        <section className="space-y-1.5">
          <SectionLabel>Title</SectionLabel>
          {editing && focus === "title" ? (
            <textarea
              ref={titleRef}
              id={titleId}
              value={step.title}
              onChange={(e) => onPatchStep({ title: e.target.value })}
              onBlur={() => setFocus(null)}
              rows={2}
              className={cn(
                textareaClass,
                "w-full resize-none border-0 border-b border-[var(--color-rule)] bg-transparent px-0 py-0 text-lg font-semibold leading-snug text-[var(--color-ink)] shadow-none focus-visible:ring-0",
              )}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={cn(
                "w-full text-left",
                editing && "rounded-sm hover:bg-[var(--color-paper)]",
              )}
              onClick={() => editing && setFocus("title")}
              aria-labelledby={titleId}
            >
              <h4 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">{step.title}</h4>
            </button>
          )}

          <p className="text-xs text-[var(--color-ink-faint)]">{metaLine}</p>

          {editing ? (
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
            <label className="inline-flex items-center gap-1.5 text-[var(--color-ink-muted)]">
              <span className="text-[var(--color-ink-faint)]">Status</span>
              <select
                className="rounded border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1"
                value={step.status}
                onChange={(e) => onPatchStep({ status: e.target.value as PlanStepRow["status"] })}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="blocked">Waiting</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-[var(--color-ink-muted)]">
              <span className="text-[var(--color-ink-faint)]">Owner</span>
              <select
                className="rounded border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1"
                value={d.owner ?? "case_manager"}
                onChange={(e) =>
                  onPatchDetails({ owner: e.target.value as NonNullable<PlanStepDetails["owner"]> })
                }
              >
                <option value="case_manager">Case manager</option>
                <option value="shared">Shared</option>
                <option value="school_program">School / program</option>
                <option value="family">Family</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-[var(--color-ink-muted)]">
              <span className="text-[var(--color-ink-faint)]">Priority</span>
              <select
                className="rounded border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1"
                value={step.priority ?? "medium"}
                onChange={(e) => {
                  const p = e.target.value as PlanStepRow["priority"];
                  const dp = p === "urgent" ? "high" : p ?? "medium";
                  onPatchStep({ priority: p });
                  onPatchDetails({ priority: dp });
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
        ) : null}
        </section>

        <section className="space-y-1.5">
          <SectionLabel>Summary</SectionLabel>
          {editing && focus === "body" ? (
            <textarea
              ref={bodyRef}
              id={bodyId}
              rows={bodyRows}
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              onBlur={blurBody}
              className={cn(
                textareaClass,
                "w-full resize-y border-0 border-b border-[var(--color-rule)] bg-transparent px-0 py-1 text-[15px] leading-relaxed text-[var(--color-ink-strong)] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
              )}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={cn(
                "w-full text-left",
                editing && "rounded-sm hover:bg-[var(--color-paper)]",
              )}
              onClick={() => editing && startBodyEdit()}
            >
              {mainParagraphRead ? (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--color-ink-strong)]">
                  {mainParagraphRead}
                </p>
              ) : editing ? (
                <span className="text-[var(--color-ink-faint)] italic">Click to write the case note for this action…</span>
              ) : (
                <span className="text-[var(--color-ink-faint)]">No narrative entered for this action.</span>
              )}
            </button>
          )}
        </section>

        <section className="space-y-3 border-t border-[var(--color-rule)] pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Actions and target dates</SectionLabel>
            {actions.length > 0 ? (
              <p className="text-xs text-[var(--color-ink-faint)]">
                {completedActionCount} of {actions.length} complete
              </p>
            ) : null}
          </div>
          {editing && actions.length > 1 ? (
            <p className="text-xs leading-relaxed text-[var(--color-ink-faint)]">
              Actions stay in target-date order. Change a date to move an action earlier or later.
            </p>
          ) : null}

          {actions.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950">
              This older plan item has no scheduled task. Add a dated action below the plan so it can be tracked.
            </p>
          ) : editing ? (
            <div className="space-y-3">
              {actions.map((action, actionIndex) => (
                <div
                  key={action.id}
                  className="space-y-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] p-3"
                >
                  <label className="block space-y-1 text-xs text-[var(--color-ink-muted)]">
                    <span>Action {actionIndex + 1}</span>
                    <input
                      type="text"
                      value={action.title}
                      onChange={(event) =>
                        onPatchActionItem(action.id, { title: event.target.value })
                      }
                      className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1 text-xs text-[var(--color-ink-muted)]">
                      <span>Target date</span>
                      <input
                        type="date"
                        value={action.target_date ?? ""}
                        onChange={(event) =>
                          onPatchActionItem(action.id, {
                            target_date: event.target.value || null,
                          })
                        }
                        className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
                        required={action.status !== "completed"}
                      />
                    </label>
                    <label className="block space-y-1 text-xs text-[var(--color-ink-muted)]">
                      <span>Status</span>
                      <select
                        value={actionUiStatus(action)}
                        onChange={(event) => {
                          const next = event.target.value as ActionUiStatus;
                          if (next === "no_longer_needed") {
                            onPatchActionItem(action.id, {
                              status: "completed",
                              notes: encodeActionNotes(action.notes, true),
                              follow_up_date: null,
                            });
                            return;
                          }
                          onPatchActionItem(action.id, {
                            status: next === "waiting" ? "blocked" : next,
                            notes: encodeActionNotes(action.notes, false),
                            follow_up_date: next === "waiting" ? action.follow_up_date : null,
                          });
                        }}
                        className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
                      >
                        <option value="pending">Not started</option>
                        <option value="in_progress">In progress</option>
                        <option value="waiting">Waiting</option>
                        <option value="completed">Completed</option>
                        <option value="no_longer_needed">No longer needed</option>
                      </select>
                    </label>
                  </div>
                  <label className="block space-y-1 text-xs text-[var(--color-ink-muted)]">
                    <span>How to do it (optional)</span>
                    <Textarea
                      rows={2}
                      value={action.description ?? ""}
                      onChange={(event) =>
                        onPatchActionItem(action.id, {
                          description: event.target.value || null,
                        })
                      }
                      className="min-h-[64px] border-[var(--color-rule)] bg-[var(--color-surface)] text-sm"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1 text-xs text-[var(--color-ink-muted)]">
                      <span>
                        {action.status === "blocked" ? "Why is this waiting?" : "Progress note (optional)"}
                      </span>
                      <Textarea
                        rows={2}
                        value={actionUserNotes(action.notes)}
                        onChange={(event) =>
                          onPatchActionItem(action.id, {
                            notes: encodeActionNotes(
                              event.target.value || null,
                              isActionNoLongerNeeded(action),
                            ),
                          })
                        }
                        className="min-h-[64px] border-[var(--color-rule)] bg-[var(--color-surface)] text-sm"
                        required={action.status === "blocked"}
                      />
                    </label>
                    <label className="block space-y-1 text-xs text-[var(--color-ink-muted)]">
                      <span>
                        {action.status === "blocked" ? "Next follow-up date" : "Follow-up date (optional)"}
                      </span>
                      <input
                        type="date"
                        value={action.follow_up_date ?? ""}
                        onChange={(event) =>
                          onPatchActionItem(action.id, {
                            follow_up_date: event.target.value || null,
                          })
                        }
                        className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
                        required={action.status === "blocked"}
                      />
                    </label>
                  </div>
                  <label className="block space-y-1 text-xs text-[var(--color-ink-muted)]">
                    <span>Outcome (optional)</span>
                    <Textarea
                      rows={2}
                      value={action.outcome ?? ""}
                      onChange={(event) =>
                        onPatchActionItem(action.id, {
                          outcome: event.target.value || null,
                        })
                      }
                      placeholder="What happened after outreach or completion?"
                      className="min-h-[64px] border-[var(--color-rule)] bg-[var(--color-surface)] text-sm"
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {actions.map((action) => {
                const done = action.status === "completed";
                const noLongerNeeded = isActionNoLongerNeeded(action);
                const targetLabel = formatDateOnly(action.target_date);
                const followUpLabel = formatDateOnly(action.follow_up_date);
                const userNotes = actionUserNotes(action.notes);
                return (
                  <li
                    key={action.id}
                    className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-3"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={(event) =>
                          onToggleActionItem?.(
                            action.id,
                            event.target.checked,
                            action.updated_at,
                          )
                        }
                        disabled={actionToggleDisabled || !onToggleActionItem}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                        aria-label={`${done ? "Reopen" : "Complete"} ${action.title}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm font-medium text-[var(--color-ink)]",
                            done && !noLongerNeeded && "text-[var(--color-ink-faint)] line-through",
                            noLongerNeeded && "text-[var(--color-ink-faint)]",
                          )}
                        >
                          {action.title}
                        </span>
                        {action.description?.trim() ? (
                          <span className="mt-1 block text-xs leading-relaxed text-[var(--color-ink-muted)]">
                            {action.description}
                          </span>
                        ) : null}
                        {userNotes ? (
                          <span className="mt-1 block text-xs leading-relaxed text-[var(--color-ink-muted)]">
                            {userNotes}
                          </span>
                        ) : null}
                        {action.outcome?.trim() ? (
                          <span className="mt-1 block text-xs leading-relaxed text-[var(--color-ink-2)]">
                            <span className="font-semibold">Outcome:</span> {action.outcome}
                          </span>
                        ) : null}
                        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          {targetLabel ? (
                            <time
                              dateTime={action.target_date ?? undefined}
                              className="font-medium text-[var(--color-accent)]"
                            >
                              Target {targetLabel}
                            </time>
                          ) : (
                            <span className="font-medium text-amber-800">Target date needed</span>
                          )}
                          {action.status === "blocked" ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                              Waiting
                            </span>
                          ) : noLongerNeeded ? (
                            <span className="rounded-full bg-[var(--color-paper-2)] px-2 py-0.5 font-medium text-[var(--color-ink-2)]">
                              No longer needed
                            </span>
                          ) : action.status === "in_progress" ? (
                            <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 font-medium text-[var(--color-accent)]">
                              In progress
                            </span>
                          ) : null}
                          {followUpLabel ? (
                            <time dateTime={action.follow_up_date ?? undefined} className="text-[var(--color-ink-muted)]">
                              Follow up {followUpLabel}
                            </time>
                          ) : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {(documentsDisplay || editing) && (
          <section className="space-y-1.5">
            <SectionLabel>Documents</SectionLabel>
            <DocumentField
              editing={editing}
              focused={focus === "documents"}
              onFocus={() => setFocus("documents")}
              onBlur={() => setFocus(null)}
              value={documentsEditable}
              onChange={(v) => {
                const { required_documents } = documentsFromEditable(v);
                onPatchDetails({
                  required_documents,
                  materials_needed: undefined,
                });
              }}
              displayText={documentsDisplay}
            />
          </section>
        )}

        {(contactDisplay || editing) && (
          <section className="space-y-1.5">
            <SectionLabel>Contact</SectionLabel>
            {editing && focus === "contact" ? (
              <div className="space-y-1.5">
                <p className="text-xs text-[var(--color-ink-faint)]">
                  One contact per line; separate name, phone, email, and notes with ·
                </p>
                <Textarea
                  rows={Math.max(2, contactEditable.split(/\r?\n/).length + 1)}
                  value={contactEditable}
                  onChange={(e) => onPatchDetails({ contacts: contactsFromEditable(e.target.value) })}
                  onBlur={() => setFocus(null)}
                  className="min-h-[3rem] w-full resize-y border-0 border-b border-[var(--color-rule)] bg-transparent px-0 py-1 text-[15px] leading-relaxed text-[var(--color-ink-strong)] shadow-none focus-visible:ring-0"
                  autoFocus
                />
              </div>
            ) : !editing && contactDisplay ? (
              <p className="text-[15px] leading-relaxed text-[var(--color-ink-2)]">{contactDisplay}</p>
            ) : editing && !contactDisplay && focus !== "contact" ? (
              <button
                type="button"
                onClick={() => setFocus("contact")}
                className="w-full text-left text-[var(--color-ink-faint)] italic hover:bg-[var(--color-paper)]"
              >
                Add primary contact…
              </button>
            ) : editing && contactDisplay && focus !== "contact" ? (
              <button
                type="button"
                onClick={() => setFocus("contact")}
                className="w-full text-left text-[15px] leading-relaxed text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]"
              >
                {contactDisplay}
              </button>
            ) : null}
          </section>
        )}

        {(outcomeDisplay || editing) && (
          <section className="space-y-1.5">
            <SectionLabel>Expected outcome</SectionLabel>
            {editing && focus === "outcome" ? (
              <Textarea
                rows={Math.max(2, outcomeEditable.split(/\r?\n/).length + 1)}
                value={outcomeEditable}
                onChange={(e) => onPatchDetails({ expected_outcome: e.target.value || undefined })}
                onBlur={() => setFocus(null)}
                className="min-h-[3rem] w-full resize-y border-0 border-b border-[var(--color-rule)] bg-transparent px-0 py-1 text-[15px] leading-relaxed text-[var(--color-ink-strong)] shadow-none focus-visible:ring-0"
                autoFocus
              />
            ) : !editing && outcomeDisplay ? (
              <p className="text-[15px] leading-relaxed text-[var(--color-ink-2)]">{outcomeDisplay}</p>
            ) : editing && !outcomeDisplay && focus !== "outcome" ? (
              <button
                type="button"
                onClick={() => setFocus("outcome")}
                className="w-full text-left text-[var(--color-ink-faint)] italic hover:bg-[var(--color-paper)]"
              >
                Add expected outcome…
              </button>
            ) : editing && outcomeDisplay && focus !== "outcome" ? (
              <button
                type="button"
                onClick={() => setFocus("outcome")}
                className="w-full text-left text-[15px] leading-relaxed text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]"
              >
                {outcomeDisplay}
              </button>
            ) : null}
          </section>
        )}

        {recordNotes ? (
          <section className="space-y-1.5 border-t border-[var(--color-rule)] pt-5">
            <SectionLabel>Updates</SectionLabel>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--color-ink-muted)]">{recordNotes}</p>
          </section>
        ) : null}

        {editing && onPatchWorkflow ? (
          <section className="space-y-3 border-t border-[var(--color-rule)] pt-5">
            <SectionLabel>Case record</SectionLabel>
            <Textarea
              rows={3}
              value={(step.workflow_data?.outcome_notes as string | undefined) ?? ""}
              onChange={(e) =>
                onPatchWorkflow({
                  ...step.workflow_data,
                  outcome_notes: e.target.value || null,
                })
              }
              placeholder="Outcomes, attempts, or follow-up notes…"
              className="w-full resize-y border-[var(--color-rule)] text-sm"
            />
            <Textarea
              rows={2}
              value={(step.workflow_data?.blocker_reason as string | undefined) ?? ""}
              onChange={(e) =>
                onPatchWorkflow({
                  ...step.workflow_data,
                  blocker_reason: e.target.value || null,
                })
              }
              placeholder="If blocked, describe why…"
              className="w-full resize-y border-[var(--color-rule)] text-sm"
            />
          </section>
        ) : null}

        {editing ? (
          <section className="space-y-3 border-t border-[var(--color-rule)] pt-5">
            <SectionLabel>Assist</SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" className="h-8 text-xs" onClick={onOpenRefine}>
                Refine action
              </Button>
            </div>
            {refineOpen ? (
              <div
                className="space-y-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] p-3 shadow-sm"
                role="region"
                aria-label="Refine action with AI"
              >
                <p className="text-xs text-[var(--color-ink-muted)]">
                  Describe how this action should read. Preview updates this action&apos;s draft only until
                  you apply; use <strong>Save edits</strong> to persist.
                </p>
                <Textarea
                  rows={3}
                  value={refineInstruction}
                  onChange={(e) => onRefineInstruction(e.target.value)}
                  placeholder="e.g. Shorten for a city intake form; keep contacts and documents."
                  className="border-[var(--color-rule)] text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 text-xs"
                    disabled={refinePending}
                    onClick={onRefineRun}
                  >
                    {refinePending ? "Working…" : "Generate preview"}
                  </Button>
                  <Button type="button" variant="ghost" className="h-8 text-xs" onClick={onRefineClose}>
                    Close
                  </Button>
                </div>
                {refinePreview ? (
                  <div className="space-y-3 border-t border-[var(--color-rule)] pt-3" aria-live="polite">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-ink)]">Review changes</p>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                        Compare the proposal with your current draft. Nothing changes until you apply
                        it, and <strong>Save edits</strong> is still required.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <RefineComparisonCard
                        label="Current draft"
                        title={step.title}
                        summary={mainParagraphRead}
                        outcome={outcomeDisplay}
                        documents={documentsDisplay}
                        contact={contactDisplay}
                      />
                      <RefineComparisonCard
                        label="Proposed draft"
                        title={refinePreview.title}
                        summary={refinePreview.description}
                        outcome={refinePreview.details.expected_outcome?.trim() || null}
                        documents={refineDocumentsDisplay}
                        contact={refineContactDisplay}
                        proposed
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button type="button" className="h-8 text-xs" onClick={onRefineApply}>
                        Apply to draft
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 text-xs"
                        onClick={onRefineDiscardPreview}
                      >
                        Discard preview
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-rule)] pt-4">
          {!editing ? (
            <Button
              type="button"
              variant="outline"
              className="h-8 border-[var(--color-rule)] text-xs"
              onClick={() => onBeginEdit?.()}
            >
              Edit action
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="mr-auto h-8 border-red-200 text-xs text-red-700 hover:bg-red-50 hover:text-red-800"
                onClick={() => onDeleteStep?.()}
                disabled={stepSavePending}
              >
                Remove action
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-8 text-xs text-[var(--color-ink-muted)]"
                onClick={() => onCancelEdits?.()}
                disabled={stepSavePending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-8 text-xs"
                onClick={() => onSaveEdits?.()}
                disabled={!stepDirty || stepSavePending}
              >
                {stepSavePending ? "Saving…" : "Save edits"}
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
