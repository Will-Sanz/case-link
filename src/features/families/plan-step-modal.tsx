"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { deletePlanStep, logPlanStepActivity, refinePlanStep, toggleChecklistItem, updatePlanStep, updatePlanStepActionItem } from "@/app/actions/plans";
import { generateStepHelperAction, saveStepHelperAction } from "@/app/actions/step-helper";
import { suggestNextMoveForBlockedStep } from "@/app/actions/suggest-next-move";
import { fetchStepActivity } from "@/app/actions/step-activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { textareaClass } from "@/lib/ui/form-classes";
import { cn } from "@/lib/utils/cn";
import type {
  PlanStepRow,
  PlanStepDetails,
  PlanStepWorkflowData,
  PlanWithSteps,
} from "@/types/family";
import { ACTIVITY_TYPES } from "@/lib/validations/plans";

const PHASE_LABELS: Record<string, string> = {
  "30": "30-day",
  "60": "60-day",
  "90": "90-day",
};

function ModalStatusSelect({
  status,
  onChange,
  disabled,
}: {
  status: PlanStepRow["status"];
  onChange: (s: PlanStepRow["status"]) => void;
  disabled?: boolean;
}) {
  const cls =
    status === "completed"
      ? "bg-emerald-100 text-emerald-900"
      : status === "in_progress"
        ? "bg-amber-100 text-amber-900"
        : status === "blocked"
          ? "bg-red-100 text-red-900"
          : "bg-slate-100 text-slate-700";
  return (
    <select
      value={status}
      onChange={(e) =>
        onChange(e.target.value as PlanStepRow["status"])
      }
      disabled={disabled}
      className={cn(
        "w-full max-w-[220px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium",
        cls,
        "focus:outline-none focus:ring-2 focus:ring-teal-600/25",
      )}
    >
      <option value="pending">Pending</option>
      <option value="in_progress">In progress</option>
      <option value="completed">Completed</option>
      <option value="blocked">Blocked</option>
    </select>
  );
}

function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type PlanStepModalInnerProps = {
  step: PlanStepRow;
  plan: PlanWithSteps;
  familyId: string;
  onClose: () => void;
};

const OUTREACH_RESULTS = [
  "",
  "No answer",
  "Left voicemail",
  "Appointment scheduled",
  "Documents requested",
  "Application submitted",
  "Ineligible / closed",
  "Other",
] as const;

function PlanStepModalInner({
  step,
  plan,
  familyId,
  onClose,
}: PlanStepModalInnerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [status, setStatus] = useState<PlanStepRow["status"]>(step.status);
  const [workflow, setWorkflow] = useState<PlanStepWorkflowData>({
    blocker_reason: step.workflow_data?.blocker_reason ?? null,
    outcome_notes: step.workflow_data?.outcome_notes ?? null,
    contact_attempted_at: step.workflow_data?.contact_attempted_at ?? null,
    outreach_result: step.workflow_data?.outreach_result ?? null,
    needs_escalation: step.workflow_data?.needs_escalation ?? false,
    documents_received: step.workflow_data?.documents_received ?? false,
    family_understood: step.workflow_data?.family_understood ?? false,
    case_manager_assisted: step.workflow_data?.case_manager_assisted ?? false,
  });
  const [dueDate, setDueDate] = useState(
    step.due_date
      ? new Date(step.due_date).toISOString().slice(0, 10)
      : "",
  );
  const [stepActivity, setStepActivity] = useState<
    Array<{ id: string; action: string; activity_type: string | null; notes: string | null; created_at: string }>
  >([]);
  const [logActivityType, setLogActivityType] = useState("");
  const [logActivityNotes, setLogActivityNotes] = useState("");
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggestPending, setSuggestPending] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [refineFeedback, setRefineFeedback] = useState("");
  const [refinePending, setRefinePending] = useState(false);
  const [helperType, setHelperType] = useState<string | null>(null);
  const [helperContent, setHelperContent] = useState<string | null>(null);
  const [helperList, setHelperList] = useState<string[] | null>(null);
  const [helperPending, setHelperPending] = useState(false);
  const aiHelper = step.ai_helper_data;

  useEffect(() => {
    fetchStepActivity(step.id).then(setStepActivity);
  }, [step.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const saveWorkflow = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const payload: Record<string, unknown> = {
        stepId: step.id,
        familyId,
        status,
        workflow_data: {
          ...workflow,
          blocker_reason: workflow.blocker_reason || null,
          outcome_notes: workflow.outcome_notes || null,
          contact_attempted_at: workflow.contact_attempted_at || null,
          outreach_result: workflow.outreach_result || null,
        },
      };
      if (dueDate) {
        payload.due_date = new Date(dueDate).toISOString();
      } else {
        payload.due_date = null;
      }
      const r = await updatePlanStep(payload);
      if (!r.ok) {
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  }, [step.id, familyId, status, workflow, dueDate, router]);

  const handleStatusChange = useCallback(
    (next: PlanStepRow["status"]) => {
      setStatus(next);
      setError(null);
      startTransition(async () => {
        const r = await updatePlanStep({
          stepId: step.id,
          familyId,
          status: next,
        });
        if (!r.ok) {
          setError(r.error);
          setStatus(step.status);
        } else {
          router.refresh();
        }
      });
    },
    [step.id, step.status, familyId, router],
  );

  const saveEdit = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStep({
        stepId: step.id,
        familyId,
        title: title.trim(),
        description: description.trim(),
      });
      if (!r.ok) {
        setError(r.error);
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }, [step.id, familyId, title, description, router]);

  const handleDelete = useCallback(() => {
    if (!confirm("Delete this plan step?")) return;
    setError(null);
    startTransition(async () => {
      const r = await deletePlanStep({ stepId: step.id, familyId });
      if (!r.ok) {
        setError(r.error);
      } else {
        onClose();
        router.refresh();
      }
    });
  }, [step.id, familyId, onClose, router]);

  const planMeta = plan;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-step-modal-title"
        className="relative z-10 flex max-h-[min(90vh,800px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xl shadow-slate-900/15"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {PHASE_LABELS[step.phase] ?? step.phase} phase · Plan v
              {planMeta.version}
            </p>
            <h2
              id="plan-step-modal-title"
              className="mt-1 text-lg font-semibold leading-snug text-slate-900"
            >
              {editing ? "Edit step" : step.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {planMeta.generation_source === "openai" ? (
                <Badge className="border-teal-200/80 bg-teal-50 text-teal-900">
                  AI draft
                  {planMeta.ai_model ? ` · ${planMeta.ai_model}` : ""}
                </Badge>
              ) : planMeta.generation_source === "manual" ? (
                <Badge className="bg-slate-100 text-slate-700">Manual</Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-700">
                  Rules / resources
                </Badge>
              )}
              {workflow.needs_escalation ? (
                <Badge className="bg-amber-100 text-amber-900">
                  Needs escalation
                </Badge>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="shrink-0 px-2 text-slate-500 hover:text-slate-800"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p
              className="mb-4 rounded-lg border border-red-200 bg-red-50/90 px-3 py-2 text-sm text-red-900"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {/* Action needed now */}
          {(() => {
            const actionNow =
              (step.details as { action_needed_now?: string })?.action_needed_now ??
              aiHelper?.action_needed_now;
            if (!actionNow) return null;
            return (
              <div className="mb-6 rounded-xl border-2 border-teal-200 bg-teal-50/60 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">
                  Action needed now
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {actionNow}
                </p>
              </div>
            );
          })()}

          {/* Workflow section */}
          <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Case manager actions
            </h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-slate-700">Status</Label>
                <div className="mt-1.5">
                  <ModalStatusSelect
                    status={status}
                    onChange={handleStatusChange}
                    disabled={pending || editing}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="modal-due-date" className="text-slate-700">
                  Follow-up / due date
                </Label>
                <Input
                  id="modal-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1.5"
                  disabled={pending}
                />
              </div>
            </div>

            {status === "blocked" ? (
              <div className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="modal-blocker" className="text-slate-700">
                    Blocker reason
                  </Label>
                  <Input
                    id="modal-blocker"
                    value={workflow.blocker_reason ?? ""}
                    onChange={(e) =>
                      setWorkflow((w) => ({
                        ...w,
                        blocker_reason: e.target.value || null,
                      }))
                    }
                    placeholder="What is blocking this step?"
                    className="mt-1.5"
                    disabled={pending}
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="py-1.5 px-3 text-sm"
                    disabled={suggestPending || pending}
                    onClick={() => {
                      setSuggestPending(true);
                      setSuggestions(null);
                      suggestNextMoveForBlockedStep(step.id, familyId).then(
                        (r) => {
                          setSuggestPending(false);
                          if (r.ok) setSuggestions(r.suggestions);
                        },
                      );
                    }}
                  >
                    {suggestPending ? "Thinking…" : "Suggest next move"}
                  </Button>
                  {suggestions && suggestions.length > 0 ? (
                    <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">
                        Suggested next moves
                      </p>
                      <ul className="mt-2 space-y-1.5 text-sm text-slate-800">
                        {suggestions.map((s, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="shrink-0 text-teal-600">•</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {status === "completed" ? (
              <div className="mt-4">
                <Label htmlFor="modal-outcome" className="text-slate-700">
                  Outcome achieved
                </Label>
                <Input
                  id="modal-outcome"
                  value={workflow.outcome_notes ?? ""}
                  onChange={(e) =>
                    setWorkflow((w) => ({
                      ...w,
                      outcome_notes: e.target.value || null,
                    }))
                  }
                  placeholder="What was accomplished?"
                  className="mt-1.5"
                  disabled={pending}
                />
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              <Label className="text-slate-700">Outreach</Label>
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[140px]">
                  <Label className="text-xs text-slate-500">
                    Contact attempted
                  </Label>
                  <Input
                    type="date"
                    value={
                      workflow.contact_attempted_at
                        ? workflow.contact_attempted_at.slice(0, 10)
                        : ""
                    }
                    onChange={(e) =>
                      setWorkflow((w) => ({
                        ...w,
                        contact_attempted_at: e.target.value
                          ? `${e.target.value}T12:00:00Z`
                          : null,
                      }))
                    }
                    className="mt-1"
                    disabled={pending}
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <Label className="text-xs text-slate-500">Result</Label>
                  <select
                    value={workflow.outreach_result ?? ""}
                    onChange={(e) =>
                      setWorkflow((w) => ({
                        ...w,
                        outreach_result: e.target.value || null,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    disabled={pending}
                  >
                    {OUTREACH_RESULTS.map((r) => (
                      <option key={r || "empty"} value={r}>
                        {r || "—"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={workflow.needs_escalation ?? false}
                  onChange={(e) =>
                    setWorkflow((w) => ({
                      ...w,
                      needs_escalation: e.target.checked,
                    }))
                  }
                  disabled={pending}
                  className="rounded border-slate-300"
                />
                Needs escalation
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={workflow.documents_received ?? false}
                  onChange={(e) =>
                    setWorkflow((w) => ({
                      ...w,
                      documents_received: e.target.checked,
                    }))
                  }
                  disabled={pending}
                  className="rounded border-slate-300"
                />
                Documents received
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={workflow.family_understood ?? false}
                  onChange={(e) =>
                    setWorkflow((w) => ({
                      ...w,
                      family_understood: e.target.checked,
                    }))
                  }
                  disabled={pending}
                  className="rounded border-slate-300"
                />
                Family understood
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={workflow.case_manager_assisted ?? false}
                  onChange={(e) =>
                    setWorkflow((w) => ({
                      ...w,
                      case_manager_assisted: e.target.checked,
                    }))
                  }
                  disabled={pending}
                  className="rounded border-slate-300"
                />
                Case manager assisted
              </label>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={saveWorkflow}
              disabled={pending}
            >
              Save workflow
            </Button>
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Log activity
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Record outreach attempts, appointments, or outcomes.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label className="text-xs text-slate-600">Activity type</Label>
                <select
                  value={logActivityType}
                  onChange={(e) => setLogActivityType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-[2]">
                <Label className="text-xs text-slate-600">Notes</Label>
                <Input
                  value={logActivityNotes}
                  onChange={(e) => setLogActivityNotes(e.target.value)}
                  placeholder="Brief outcome or summary…"
                  className="mt-1"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !logActivityType.trim()}
                onClick={() => {
                  const type = logActivityType.trim();
                  if (!type) return;
                  setError(null);
                  startTransition(async () => {
                    const r = await logPlanStepActivity({
                      stepId: step.id,
                      familyId,
                      action: "activity",
                      activity_type: type,
                      notes: logActivityNotes.trim() || undefined,
                    });
                    if (!r.ok) setError(r.error);
                    else {
                      setLogActivityType("");
                      setLogActivityNotes("");
                      fetchStepActivity(step.id).then(setStepActivity);
                      router.refresh();
                    }
                  });
                }}
              >
                Log
              </Button>
            </div>
          </div>

          {stepActivity.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-800">
                Activity history
              </h3>
              <ul className="mt-3 space-y-2">
                {stepActivity.map((a) => (
                  <li
                    key={a.id}
                    className="flex gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
                  >
                    <span className="shrink-0 text-slate-500">
                      {new Date(a.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="font-medium text-slate-700">
                      {a.activity_type?.replace(/_/g, " ") ??
                        (a.action === "step.refined" ? "Step refined" : a.action)}
                    </span>
                    {a.notes ? (
                      <span className="text-slate-600">— {a.notes}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Refine this step
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Improve a weak AI-generated step without regenerating the whole plan.
            </p>
            {showRefine ? (
              <div className="mt-4 space-y-3">
                <div>
                  <Label className="text-xs text-slate-600">
                    What should change?
                  </Label>
                  <textarea
                    value={refineFeedback}
                    onChange={(e) => setRefineFeedback(e.target.value)}
                    placeholder="E.g. Make this more specific about documents needed, add a phone script, break into smaller tasks…"
                    rows={3}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    disabled={refinePending}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={refinePending || !refineFeedback.trim()}
                    onClick={() => {
                      setError(null);
                      setRefinePending(true);
                      refinePlanStep({
                        stepId: step.id,
                        familyId,
                        feedback: refineFeedback.trim(),
                      }).then((r) => {
                        setRefinePending(false);
                        if (r.ok) {
                          setShowRefine(false);
                          setRefineFeedback("");
                          onClose();
                          router.refresh();
                        } else {
                          setError(r.error);
                        }
                      });
                    }}
                  >
                    {refinePending ? "Regenerating…" : "Regenerate this step"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={refinePending}
                    onClick={() => {
                      setShowRefine(false);
                      setRefineFeedback("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => setShowRefine(true)}
              >
                Give feedback / refine step
              </Button>
            )}
          </div>

          {/* AI help for this step */}
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">
              AI help for this step
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Generate scripts, checklists, and guidance tailored to this family and step.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  { type: "call_script" as const, label: "Generate call script" },
                  { type: "email_draft" as const, label: "Draft email" },
                  { type: "prep_checklist" as const, label: "Prep checklist" },
                  { type: "fallback_options" as const, label: "Fallback options" },
                  { type: "family_explanation" as const, label: "Explain to family" },
                  { type: "break_into_actions" as const, label: "Break into smaller actions" },
                  { type: "what_happens_next" as const, label: "What happens next" },
                  ...(status === "blocked"
                    ? [{ type: "troubleshoot_blocker" as const, label: "Troubleshoot blocker" }]
                    : []),
                ] as { type: Parameters<typeof generateStepHelperAction>[2]; label: string }[]
              ).map(({ type, label }) => (
                <Button
                  key={type}
                  type="button"
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  disabled={helperPending || pending}
                  onClick={async () => {
                    setHelperType(type);
                    setHelperPending(true);
                    setHelperContent(null);
                    setHelperList(null);
                    const r = await generateStepHelperAction(step.id, familyId, type);
                    setHelperPending(false);
                    if (r.ok) {
                      setHelperContent(r.content);
                      setHelperList(r.listContent ?? null);
                    } else setError(r.error);
                  }}
                >
                  {helperPending && helperType === type ? "Generating…" : label}
                </Button>
              ))}
            </div>
            {(helperContent || aiHelper?.call_script || aiHelper?.email_draft || aiHelper?.family_explanation || aiHelper?.next_step_guidance || (aiHelper?.prep_checklist ?? []).length > 0 || (aiHelper?.fallback_options ?? []).length > 0) && (
              <div className="mt-4 space-y-3">
                {helperContent && helperType && (
                  <div className="rounded-lg border border-teal-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">
                      {helperType.replace(/_/g, " ")}
                    </p>
                    {helperList ? (
                      <ul className="mt-2 space-y-1 text-sm text-slate-800">
                        {helperList.map((item, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-teal-600">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                        {helperContent}
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3 px-3 py-1.5 text-sm"
                      disabled={pending}
                      onClick={async () => {
                        const field =
                          helperType === "call_script"
                            ? "call_script"
                            : helperType === "email_draft"
                              ? "email_draft"
                              : helperType === "prep_checklist" || helperType === "break_into_actions"
                                ? "prep_checklist"
                                : helperType === "fallback_options" || helperType === "troubleshoot_blocker"
                                  ? "fallback_options"
                                  : helperType === "family_explanation"
                                    ? "family_explanation"
                                    : helperType === "what_happens_next"
                                      ? "next_step_guidance"
                                      : "fallback_options";
                        const val = helperList ?? (helperContent ?? "");
                        const r = await saveStepHelperAction(
                          step.id,
                          familyId,
                          field as keyof typeof aiHelper,
                          Array.isArray(val) ? val : val,
                        );
                        if (r.ok) router.refresh();
                        else setError(r.error);
                      }}
                    >
                      Save to step
                    </Button>
                  </div>
                )}
                {aiHelper?.call_script && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Saved call script
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                      {aiHelper.call_script}
                    </p>
                  </div>
                )}
                {aiHelper?.email_draft && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Saved email draft
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                      {aiHelper.email_draft}
                    </p>
                  </div>
                )}
                {aiHelper?.prep_checklist && aiHelper.prep_checklist.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Saved prep checklist
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-800">
                      {aiHelper.prep_checklist.map((item, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-teal-600">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiHelper?.fallback_options && aiHelper.fallback_options.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Saved fallback options
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-800">
                      {aiHelper.fallback_options.map((item, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-teal-600">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiHelper?.family_explanation && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Saved family explanation
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                      {aiHelper.family_explanation}
                    </p>
                  </div>
                )}
                {aiHelper?.next_step_guidance && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Saved next-step guidance
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                      {aiHelper.next_step_guidance}
                    </p>
                  </div>
                )}
              </div>
            )}
            {!helperContent && !aiHelper?.call_script && !aiHelper?.email_draft && !aiHelper?.family_explanation && !aiHelper?.next_step_guidance && (aiHelper?.prep_checklist ?? []).length === 0 && (aiHelper?.fallback_options ?? []).length === 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Use a button above to generate help. Save useful content to keep it on this step.
              </p>
            )}
          </div>

          {editing ? (
            <div className="mt-6 space-y-4">
              <div>
                <Label htmlFor="modal-step-title">Title</Label>
                <Input
                  id="modal-step-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="modal-step-desc">Description</Label>
                <textarea
                  id="modal-step-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={8}
                  className={`mt-1.5 ${textareaClass}`}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={saveEdit}
                  disabled={pending || !title.trim()}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setTitle(step.title);
                    setDescription(step.description);
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {(() => {
                const d = step.details as PlanStepDetails | null | undefined;
                const hasRichContent =
                  d &&
                  ((step.action_items?.length ?? 0) > 0 ||
                    d.rationale ||
                    d.detailed_instructions ||
                    (d.checklist && d.checklist.length > 0) ||
                    (d.required_documents &&
                      d.required_documents.length > 0) ||
                    (d.contacts && d.contacts.length > 0) ||
                    (d.blockers && d.blockers.length > 0) ||
                    (d.fallback_options && d.fallback_options.length > 0) ||
                    d.expected_outcome ||
                    d.timing_guidance ||
                    d.stage_goal ||
                    d.why_now);

                if (hasRichContent) {
                  return (
                    <>
                      {(d!.stage_goal || d!.why_now) ? (
                        <div className="rounded-lg bg-slate-50 p-3">
                          {d!.stage_goal ? (
                            <div>
                              <Label className="text-slate-500">
                                Stage focus
                              </Label>
                              <p className="mt-1 text-sm text-slate-800">
                                {d!.stage_goal}
                              </p>
                            </div>
                          ) : null}
                          {d!.why_now ? (
                            <div className="mt-2">
                              <Label className="text-slate-500">Why now</Label>
                              <p className="mt-1 text-sm text-slate-800">
                                {d!.why_now}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {d!.rationale ? (
                        <div>
                          <Label className="text-slate-500">
                            Why this matters
                          </Label>
                          <p className="mt-1 text-sm text-slate-800">
                            {d!.rationale}
                          </p>
                        </div>
                      ) : null}
                      {d!.detailed_instructions ? (
                        <div>
                          <Label className="text-slate-500">What to do</Label>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                            {d!.detailed_instructions}
                          </p>
                        </div>
                      ) : null}
                      {(d as { contact_script?: string })?.contact_script ? (
                        <div>
                          <Label className="text-slate-500">
                            What to say (outreach script)
                          </Label>
                          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-teal-50/80 px-3 py-2 text-sm text-slate-800">
                            {(d as { contact_script: string }).contact_script}
                          </p>
                        </div>
                      ) : null}
                      {step.action_items && step.action_items.length > 0 ? (
                        <div className="rounded-lg border border-teal-100 bg-teal-50/40 p-3">
                          <Label className="text-teal-800">
                            Weekly action items (
                            {step.action_items.filter((a) => a.status === "completed").length} of {step.action_items.length} done)
                          </Label>
                          <ul className="mt-2 space-y-2">
                            {[...step.action_items]
                              .sort((a, b) => a.week_index - b.week_index || a.sort_order - b.sort_order)
                              .map((ai) => {
                                const isDone = ai.status === "completed";
                                const dueStr = ai.target_date
                                  ? new Date(ai.target_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                                  : null;
                                return (
                                  <li key={ai.id} className="flex gap-2 text-sm text-slate-800">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setError(null);
                                        startTransition(async () => {
                                          const r = await updatePlanStepActionItem({
                                            actionItemId: ai.id,
                                            familyId,
                                            status: isDone ? "pending" : "completed",
                                          });
                                          if (!r.ok) setError(r.error);
                                          else router.refresh();
                                        });
                                      }}
                                      disabled={pending}
                                      className={cn(
                                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                                        isDone ? "border-teal-500 bg-teal-500 text-white" : "border-slate-300 bg-white hover:border-teal-400",
                                      )}
                                    >
                                      {isDone ? "✓" : null}
                                    </button>
                                    <div>
                                      <span className={cn(isDone && "line-through text-slate-500")}>
                                        {ai.title}
                                        {dueStr && (
                                          <span className="ml-2 text-xs text-slate-500">Due {dueStr}</span>
                                        )}
                                      </span>
                                      {ai.description && (
                                        <p className="mt-0.5 text-xs text-slate-500">
                                          {ai.description}
                                        </p>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                          </ul>
                        </div>
                      ) : null}
                      {d!.checklist && d!.checklist.length > 0 ? (
                        <div>
                          <Label className="text-slate-500">
                            Checklist (
                            {(step.workflow_data?.checklist_completed ?? []).filter(Boolean).length} of {d!.checklist.length})
                          </Label>
                          <ul className="mt-2 space-y-2">
                            {d!.checklist.map((item, i) => {
                              const completed = (step.workflow_data?.checklist_completed ?? [])[i];
                              return (
                                <li
                                  key={i}
                                  className="flex gap-2 text-sm text-slate-800"
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setError(null);
                                      startTransition(async () => {
                                        const r = await toggleChecklistItem({
                                          stepId: step.id,
                                          familyId,
                                          checklistIndex: i,
                                          completed: !completed,
                                        });
                                        if (!r.ok) setError(r.error);
                                        else router.refresh();
                                      });
                                    }}
                                    disabled={pending}
                                    className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-white transition-colors hover:border-teal-500 disabled:opacity-50"
                                  >
                                    {completed ? (
                                      <span className="text-teal-600">✓</span>
                                    ) : null}
                                  </button>
                                  <span
                                    className={
                                      completed
                                        ? "line-through text-slate-500"
                                        : ""
                                    }
                                  >
                                    {item}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      {d!.required_documents &&
                      d!.required_documents.length > 0 ? (
                        <div>
                          <Label className="text-slate-500">
                            What to prepare
                          </Label>
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {d!.required_documents.map((doc, i) => (
                              <li
                                key={i}
                                className="rounded-md bg-slate-100 px-2 py-1 text-sm text-slate-700"
                              >
                                {doc}
                              </li>
                            ))}
                          </ul>
                          {workflow.documents_received ? (
                            <p className="mt-2 text-xs text-emerald-600">
                              ✓ Documents received
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {d!.contacts && d!.contacts.length > 0 ? (
                        <div>
                          <Label className="text-slate-500">Contacts</Label>
                          <ul className="mt-2 space-y-1.5">
                            {d!.contacts.map((c, i) => (
                              <li
                                key={i}
                                className="text-sm text-slate-800"
                              >
                                {c.name && (
                                  <span className="font-medium">{c.name}</span>
                                )}{" "}
                                {c.phone && (
                                  <a
                                    href={`tel:${c.phone}`}
                                    className="text-teal-700 hover:underline"
                                  >
                                    {c.phone}
                                  </a>
                                )}{" "}
                                {c.email && (
                                  <a
                                    href={`mailto:${c.email}`}
                                    className="text-teal-700 hover:underline"
                                  >
                                    {c.email}
                                  </a>
                                )}
                                {c.notes && (
                                  <span className="text-slate-500">
                                    {" "}
                                    — {c.notes}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {d!.expected_outcome ? (
                        <div>
                          <Label className="text-slate-500">
                            Success looks like
                          </Label>
                          <p className="mt-1 text-sm text-slate-800">
                            {d!.expected_outcome}
                          </p>
                        </div>
                      ) : null}
                      {(d!.blockers?.length ?? 0) > 0 ||
                      (d!.fallback_options?.length ?? 0) > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          {d!.blockers && d!.blockers.length > 0 ? (
                            <div>
                              <Label className="text-slate-500">
                                Common blockers
                              </Label>
                              <ul className="mt-2 space-y-1 text-sm text-slate-800">
                                {d!.blockers.map((b, i) => (
                                  <li key={i}>• {b}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {d!.fallback_options &&
                          d!.fallback_options.length > 0 ? (
                            <div>
                              <Label className="text-slate-500">
                                Fallback options
                              </Label>
                              <ul className="mt-2 space-y-1 text-sm text-slate-800">
                                {d!.fallback_options.map((f, i) => (
                                  <li key={i}>• {f}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {d!.timing_guidance ? (
                        <div>
                          <Label className="text-slate-500">Timing</Label>
                          <p className="mt-1 text-sm text-slate-800">
                            {d!.timing_guidance}
                          </p>
                        </div>
                      ) : null}
                    </>
                  );
                }

                return (
                  <div>
                    <Label className="text-slate-700">Full detail</Label>
                    {description.trim() ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                        {description}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">
                        No description yet. Use Edit to add contacts, intake
                        steps, or follow-up notes.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {planMeta.summary ? (
            <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
              {planMeta.summary}
            </p>
          ) : null}
        </div>

        {!editing ? (
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(true)}
              disabled={pending}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-red-700 hover:text-red-800"
              onClick={handleDelete}
              disabled={pending}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="outline"
              className="ml-auto"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function PlanStepModal({
  step,
  plan,
  familyId,
  onClose,
}: {
  step: PlanStepRow;
  plan: PlanWithSteps;
  familyId: string;
  onClose: () => void;
}) {
  const isClient = useIsClient();

  if (!isClient) {
    return null;
  }

  return (
    <PlanStepModalInner
      step={step}
      plan={plan}
      familyId={familyId}
      onClose={onClose}
    />
  );
}
