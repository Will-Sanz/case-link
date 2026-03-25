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
import type { PlanStepDetails, PlanStepRow } from "@/types/family";
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
  "text-[11px] font-semibold uppercase tracking-wider text-slate-500";

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className={sectionLabelClass}>{children}</p>;
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
    return <p className="text-[15px] leading-relaxed text-slate-700">{displayText}</p>;
  }
  if (focused) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-slate-400">One item per line</p>
        <textarea
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn(
            textareaClass,
            "min-h-[3rem] w-full resize-y border-0 border-b border-slate-200 bg-transparent px-0 py-1 text-[15px] leading-relaxed text-slate-800 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
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
      className="w-full text-left text-[15px] leading-relaxed text-slate-700 hover:bg-slate-50/80"
    >
      {displayText ?? (
        <span className="text-slate-400 italic">Add documents the client will need…</span>
      )}
    </button>
  );
}

export function PlanStepCaseNote({
  step,
  editing,
  onPatchStep,
  onPatchDetails,
  onPatchWorkflow,
  onBeginEdit,
  onSaveEdits,
  onCancelEdits,
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
  onPatchWorkflow?: (patch: NonNullable<PlanStepRow["workflow_data"]>) => void;
  onBeginEdit?: () => void;
  onSaveEdits?: () => void;
  onCancelEdits?: () => void;
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
  const d = (step.details ?? {}) as PlanStepDetails;
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
  const recordNotes = useMemo(() => formatRecordNotes(step.workflow_data), [step.workflow_data]);

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

  useEffect(() => {
    if (!editing) setFocus(null);
  }, [editing]);

  const metaLine = [
    step.status.replace("_", " "),
    `${step.phase}-day`,
    (step.priority ?? d.priority ?? "medium").replace("_", " ") + " priority",
  ]
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" · ");

  return (
    <article
      id={`step-${step.id}`}
      className={cn(
        "max-w-[760px] border-l-[3px] pl-4",
        step.phase === "30" && "border-l-teal-400/90 bg-teal-50/20",
        step.phase === "60" && "border-l-indigo-400/80 bg-indigo-50/15",
        step.phase === "90" && "border-l-violet-400/80 bg-violet-50/15",
        editing && "rounded-r-xl ring-1 ring-blue-200/70 ring-offset-2 ring-offset-transparent",
      )}
    >
      <div className="space-y-5 py-4 pr-2">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200/60 pb-3">
          {!editing ? (
            <Button
              type="button"
              variant="outline"
              className="h-8 border-slate-200/90 text-xs"
              onClick={() => onBeginEdit?.()}
            >
              Edit step
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                className="h-8 text-xs text-slate-600"
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
                "w-full resize-none border-0 border-b border-slate-200 bg-transparent px-0 py-0 text-lg font-semibold leading-snug text-slate-900 shadow-none focus-visible:ring-0",
              )}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={cn(
                "w-full text-left",
                editing && "rounded-sm hover:bg-slate-50/80",
              )}
              onClick={() => editing && setFocus("title")}
              aria-labelledby={titleId}
            >
              <h4 className="text-lg font-semibold tracking-tight text-slate-900">{step.title}</h4>
            </button>
          )}

          <p className="text-xs text-slate-500">{metaLine}</p>

          {editing ? (
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="text-slate-500">Phase</span>
              <select
                className="rounded border border-slate-200 bg-white px-2 py-1"
                value={step.phase}
                onChange={(e) => onPatchStep({ phase: e.target.value as PlanStepRow["phase"] })}
              >
                <option value="30">30-day</option>
                <option value="60">60-day</option>
                <option value="90">90-day</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="text-slate-500">Status</span>
              <select
                className="rounded border border-slate-200 bg-white px-2 py-1"
                value={step.status}
                onChange={(e) => onPatchStep({ status: e.target.value as PlanStepRow["status"] })}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="text-slate-500">Priority</span>
              <select
                className="rounded border border-slate-200 bg-white px-2 py-1"
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
                "w-full resize-y border-0 border-b border-slate-200 bg-transparent px-0 py-1 text-[15px] leading-relaxed text-slate-800 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
              )}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={cn(
                "w-full text-left",
                editing && "rounded-sm hover:bg-slate-50/80",
              )}
              onClick={() => editing && startBodyEdit()}
            >
              {mainParagraphRead ? (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                  {mainParagraphRead}
                </p>
              ) : editing ? (
                <span className="text-slate-400 italic">Click to write the case note for this step…</span>
              ) : (
                <span className="text-slate-500">No narrative entered for this step.</span>
              )}
            </button>
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
                <p className="text-xs text-slate-400">
                  One contact per line; separate name, phone, email, and notes with ·
                </p>
                <Textarea
                  rows={Math.max(2, contactEditable.split(/\r?\n/).length + 1)}
                  value={contactEditable}
                  onChange={(e) => onPatchDetails({ contacts: contactsFromEditable(e.target.value) })}
                  onBlur={() => setFocus(null)}
                  className="min-h-[3rem] w-full resize-y border-0 border-b border-slate-200 bg-transparent px-0 py-1 text-[15px] leading-relaxed text-slate-800 shadow-none focus-visible:ring-0"
                  autoFocus
                />
              </div>
            ) : !editing && contactDisplay ? (
              <p className="text-[15px] leading-relaxed text-slate-700">{contactDisplay}</p>
            ) : editing && !contactDisplay && focus !== "contact" ? (
              <button
                type="button"
                onClick={() => setFocus("contact")}
                className="w-full text-left text-slate-400 italic hover:bg-slate-50/80"
              >
                Add primary contact…
              </button>
            ) : editing && contactDisplay && focus !== "contact" ? (
              <button
                type="button"
                onClick={() => setFocus("contact")}
                className="w-full text-left text-[15px] leading-relaxed text-slate-700 hover:bg-slate-50/80"
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
                className="min-h-[3rem] w-full resize-y border-0 border-b border-slate-200 bg-transparent px-0 py-1 text-[15px] leading-relaxed text-slate-800 shadow-none focus-visible:ring-0"
                autoFocus
              />
            ) : !editing && outcomeDisplay ? (
              <p className="text-[15px] leading-relaxed text-slate-700">{outcomeDisplay}</p>
            ) : editing && !outcomeDisplay && focus !== "outcome" ? (
              <button
                type="button"
                onClick={() => setFocus("outcome")}
                className="w-full text-left text-slate-400 italic hover:bg-slate-50/80"
              >
                Add expected outcome…
              </button>
            ) : editing && outcomeDisplay && focus !== "outcome" ? (
              <button
                type="button"
                onClick={() => setFocus("outcome")}
                className="w-full text-left text-[15px] leading-relaxed text-slate-700 hover:bg-slate-50/80"
              >
                {outcomeDisplay}
              </button>
            ) : null}
          </section>
        )}

        {recordNotes ? (
          <section className="space-y-1.5 border-t border-slate-200/80 pt-5">
            <SectionLabel>Updates</SectionLabel>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-600">{recordNotes}</p>
          </section>
        ) : null}

        {editing && onPatchWorkflow ? (
          <section className="space-y-3 border-t border-slate-200/80 pt-5">
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
              className="w-full resize-y border-slate-200/90 text-sm"
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
              className="w-full resize-y border-slate-200/90 text-sm"
            />
          </section>
        ) : null}

        {editing ? (
          <section className="space-y-3 border-t border-slate-200/80 pt-5">
            <SectionLabel>Assist</SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" className="h-8 text-xs" onClick={onOpenRefine}>
                Refine step
              </Button>
            </div>
            {refineOpen ? (
              <div
                className="space-y-3 rounded-lg border border-slate-200/90 bg-white/80 p-3 shadow-sm"
                role="region"
                aria-label="Refine step with AI"
              >
                <p className="text-xs text-slate-600">
                  Describe how this step should read. Preview updates this step&apos;s draft only until
                  you apply; use <strong>Save edits</strong> to persist.
                </p>
                <Textarea
                  rows={3}
                  value={refineInstruction}
                  onChange={(e) => onRefineInstruction(e.target.value)}
                  placeholder="e.g. Shorten for a city intake form; keep contacts and documents."
                  className="border-slate-200 text-sm"
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
                  <div className="space-y-3 border-t border-slate-200 pt-3">
                    <div className="space-y-1.5">
                      <SectionLabel>Preview title</SectionLabel>
                      <p className="text-[15px] font-semibold text-slate-900">{refinePreview.title}</p>
                    </div>
                    <div className="space-y-1.5">
                      <SectionLabel>Preview summary</SectionLabel>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                        {refinePreview.description}
                      </p>
                    </div>
                    {refinePreview.details.expected_outcome?.trim() ? (
                      <div className="space-y-1.5">
                        <SectionLabel>Preview outcome</SectionLabel>
                        <p className="text-[15px] leading-relaxed text-slate-700">
                          {refinePreview.details.expected_outcome}
                        </p>
                      </div>
                    ) : null}
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
      </div>
    </article>
  );
}
