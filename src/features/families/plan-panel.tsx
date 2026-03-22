"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createManualStep,
  deletePlanStep,
  generatePlan,
  toggleChecklistItem,
  updatePlanStep,
  updatePlanStepActionItem,
} from "@/app/actions/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  StepStatusBadge,
  ChecklistProgressBadge,
} from "@/features/families/step-status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectInputClass, textareaClass } from "@/lib/ui/form-classes";
import { InlineStepAiHelp } from "@/features/families/inline-step-ai-help";
import { PlanStepModal } from "@/features/families/plan-step-modal";
import { PlanPdfExport } from "@/features/families/plan-pdf-export";
import type {
  PlanStepActionItemRow,
  PlanStepRow,
  PlanStepDetails,
  PlanWithSteps,
} from "@/types/family";
import { cn } from "@/lib/utils/cn";

const PHASE_LABELS: Record<string, string> = {
  "30": "30-day",
  "60": "60-day",
  "90": "90-day",
};

const PHASE_COLORS: Record<string, string> = {
  "30": "bg-blue-400/90/90",
  "60": "bg-blue-400/90",
  "90": "bg-blue-400/80",
};

/** Linked resources for a step */
function LinkedResources({
  stepId,
  matches,
}: {
  stepId: string;
  matches: Array<{
    id: string;
    resource_id: string;
    plan_step_id?: string | null;
    resource?: { program_name: string } | null;
  }>;
}) {
  const linked = matches.filter(
    (m) => m.plan_step_id === stepId && m.resource,
  );
  if (linked.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-blue-50/40 px-3 py-2">
      <p className="text-xs font-medium text-blue-700">
        Linked resource{linked.length !== 1 ? "s" : ""}
      </p>
      <ul className="mt-1 space-y-1">
        {linked.map((m) => (
          <li key={m.id}>
            <Link
              href={`/resources/${m.resource_id}`}
              className="text-sm text-blue-700 hover:underline"
            >
              {m.resource?.program_name ?? "Resource"}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Action items grouped by week with completion toggle */
function ActionItemsSection({
  step,
  familyName,
  onToggleActionItem,
  pending,
}: {
  step: PlanStepRow;
  familyName?: string;
  onToggleActionItem?: (actionItemId: string, completed: boolean) => void;
  pending?: boolean;
}) {
  const items = step.action_items ?? [];
  if (items.length === 0) return null;

  const byWeek = new Map<number, PlanStepActionItemRow[]>();
  for (const ai of items) {
    const list = byWeek.get(ai.week_index) ?? [];
    list.push(ai);
    byWeek.set(ai.week_index, list);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  const completedCount = items.filter((a) => a.status === "completed").length;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-700">
        Weekly action items ({completedCount} of {items.length} done)
      </p>
      <div className="mt-3 space-y-4">
        {weeks.map((weekIdx) => (
          <div key={weekIdx}>
            <p className="text-xs font-medium text-slate-600">Week {weekIdx}</p>
            <ul className="mt-1.5 space-y-1.5">
              {(byWeek.get(weekIdx) ?? []).map((ai) => {
                const isDone = ai.status === "completed";
                const dueStr = ai.target_date
                  ? new Date(ai.target_date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : null;
                return (
                  <li key={ai.id} className="flex items-start gap-2">
                    {onToggleActionItem ? (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleActionItem(ai.id, !isDone)
                        }
                        disabled={pending}
                        className={cn(
                          "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          isDone
                            ? "border-blue-400 bg-blue-400/90 text-white"
                            : "border-slate-300 bg-white hover:border-blue-300",
                        )}
                      >
                        {isDone ? "✓" : null}
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "mt-1 size-1.5 shrink-0 rounded-full",
                          isDone ? "bg-blue-400/90" : "bg-slate-300",
                        )}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "text-sm text-slate-700",
                          isDone && "line-through text-slate-500",
                        )}
                      >
                        {ai.title}
                      </span>
                      {ai.description && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {ai.description}
                        </p>
                      )}
                      {dueStr && (
                        <span
                          className={cn(
                            "ml-2 text-xs",
                            isDone ? "text-slate-400" : "text-slate-500",
                          )}
                        >
                          Due {dueStr}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Preview of step content for list view — uses details when available, else description */
function StepPreview({
  step,
  expanded,
  resourceMatches,
  onToggleChecklist,
  checklistPending,
  onToggleActionItem,
  familyName,
  familyId,
}: {
  step: PlanStepRow;
  expanded: boolean;
  resourceMatches?: Array<{
    id: string;
    resource_id: string;
    plan_step_id?: string | null;
    resource?: { program_name: string } | null;
  }>;
  onToggleChecklist?: (stepId: string, index: number, completed: boolean) => void;
  checklistPending?: boolean;
  onToggleActionItem?: (actionItemId: string, completed: boolean) => void;
  familyName?: string;
  familyId?: string;
}) {
  const d = step.details as PlanStepDetails | null | undefined;
  const w = step.workflow_data;
  const hasDetails = d && (d.detailed_instructions || d.checklist?.length);

  const checklist = d?.checklist ?? [];
  const completed = (w?.checklist_completed ?? []) as boolean[];
  const completedCount = checklist.filter((_, i) => completed[i]).length;

  const actionItems = step.action_items ?? [];
  const actionItemsDone = actionItems.filter((a) => a.status === "completed").length;

  if (!expanded) {
    const preview = d?.detailed_instructions ?? step.description;
    const actionNow =
      (d?.action_needed_now as string | undefined) ??
      (step.ai_helper_data?.action_needed_now as string | undefined);
    return (
      <div className="mt-2 space-y-2">
        {actionNow ? (
          <p className="font-medium text-slate-800">{actionNow}</p>
        ) : null}
        <p className="line-clamp-2 text-sm text-slate-600">
          {preview?.trim() || "No description — open to add context"}
        </p>
        {actionItems.length > 0 ? (
          <p className="text-xs font-medium text-slate-500">
            Action items: {actionItemsDone} of {actionItems.length} done
          </p>
        ) : checklist.length > 0 ? (
          <p className="text-xs font-medium text-slate-500">
            Checklist: {completedCount} of {checklist.length} done
          </p>
        ) : null}
        {w?.blocker_reason && step.status === "blocked" ? (
          <p className="text-xs text-red-700">
            Blocker: {w.blocker_reason}
          </p>
        ) : null}
        {w?.outcome_notes && step.status === "completed" ? (
          <p className="text-xs text-emerald-700">
            Outcome: {w.outcome_notes}
          </p>
        ) : null}
      </div>
    );
  }

  const actionNow =
    (d?.action_needed_now as string | undefined) ??
    (step.ai_helper_data?.action_needed_now as string | undefined);

  return (
    <div className="mt-4 space-y-4 text-sm">
      {actionNow ? (
        <div className="rounded-lg border border-blue-200/70 bg-blue-50/40/40 px-3 py-2">
          <p className="text-xs font-medium text-blue-700">
            Action needed now
          </p>
          <p className="mt-1.5 font-medium text-slate-900">{actionNow}</p>
        </div>
      ) : null}
      {(d?.stage_goal || d?.why_now) ? (
        <div className="rounded-lg bg-slate-50 p-3">
          {d?.stage_goal ? (
            <>
              <p className="text-xs font-medium text-slate-500">
                Stage focus
              </p>
              <p className="mt-1 text-slate-700">{String(d?.stage_goal ?? "")}</p>
            </>
          ) : null}
          {d?.why_now ? (
            <>
              <p className="mt-2 text-xs font-medium text-slate-500">
                Why now
              </p>
              <p className="mt-1 text-slate-700">{String(d?.why_now ?? "")}</p>
            </>
          ) : null}
        </div>
      ) : null}
      {d?.rationale ? (
        <div>
          <p className="text-xs font-medium text-slate-500">
            Why this matters
          </p>
          <p className="mt-1 text-slate-700">{d.rationale}</p>
        </div>
      ) : null}
      {d?.detailed_instructions ? (
        <div>
          <p className="text-xs font-medium text-slate-500">
            What to do
          </p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-700">
            {d.detailed_instructions}
          </p>
        </div>
      ) : null}
      {(d as { contact_script?: string })?.contact_script ? (
        <div>
          <p className="text-xs font-medium text-slate-500">
            What to say (outreach script)
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {(d as { contact_script: string }).contact_script}
          </p>
        </div>
      ) : null}
      {step.description && !d?.detailed_instructions ? (
        <p className="whitespace-pre-wrap text-slate-700">{step.description}</p>
      ) : null}
      {d?.checklist && d.checklist.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-slate-500">
            Checklist ({completedCount} of {checklist.length})
          </p>
          <ul className="mt-2 space-y-1.5">
            {checklist.map((item, i) => {
              const isDone = completed[i];
              return (
                <li key={i} className="flex gap-2">
                  {onToggleChecklist ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleChecklist(step.id, i, !isDone);
                      }}
                      disabled={checklistPending}
                      className="mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-white transition-colors hover:border-blue-500 disabled:opacity-50"
                    >
                      {isDone ? (
                        <span className="text-blue-600">✓</span>
                      ) : null}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        isDone ? "bg-blue-400/90" : "bg-slate-300",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "text-slate-700",
                      isDone && "line-through text-slate-500",
                    )}
                  >
                    {item}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {d?.required_documents && d.required_documents.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-slate-500">
            What to prepare
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {d.required_documents.map((doc, i) => (
              <li
                key={i}
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
              >
                {doc}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d?.contacts && d.contacts.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-slate-500">
            Contacts
          </p>
          <ul className="mt-2 space-y-1.5">
            {d.contacts.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-slate-700">
                {c.name && <span className="font-medium">{c.name}</span>}
                {c.phone && (
                  <a
                    href={`tel:${c.phone}`}
                    className="text-blue-600 hover:underline"
                  >
                    {c.phone}
                  </a>
                )}
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="text-blue-600 hover:underline"
                  >
                    {c.email}
                  </a>
                )}
                {c.notes && (
                  <span className="text-slate-500">— {c.notes}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d?.expected_outcome ? (
        <div>
          <p className="text-xs font-medium text-slate-500">
            Success looks like
          </p>
          <p className="mt-1 text-slate-700">{d.expected_outcome}</p>
        </div>
      ) : null}
      {(d?.blockers?.length ?? 0) > 0 || (d?.fallback_options?.length ?? 0) > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {d?.blockers && d.blockers.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-slate-500">
                Common blockers
              </p>
              <ul className="mt-2 space-y-1 text-slate-700">
                {d.blockers.map((b, i) => (
                  <li key={i}>• {b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {d?.fallback_options && d.fallback_options.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-slate-500">
                Fallback options
              </p>
              <ul className="mt-2 space-y-1 text-slate-700">
                {d.fallback_options.map((f, i) => (
                  <li key={i}>• {f}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {actionItems.length > 0 ? (
        <ActionItemsSection
          step={step}
          familyName={familyName}
          onToggleActionItem={onToggleActionItem}
          pending={checklistPending}
        />
      ) : null}
      {expanded && familyId ? (
        <InlineStepAiHelp
          step={step}
          familyId={familyId}
          isBlocked={step.status === "blocked"}
        />
      ) : null}
      {resourceMatches && resourceMatches.length > 0 ? (
        <LinkedResources stepId={step.id} matches={resourceMatches} />
      ) : null}
    </div>
  );
}

export function PlanPanel({
  familyId,
  plan,
  familyName,
  resourceMatches = [],
}: {
  familyId: string;
  plan: PlanWithSteps | null;
  familyName?: string;
  resourceMatches?: Array<{
    id: string;
    resource_id: string;
    plan_step_id?: string | null;
    resource?: { program_name: string; slug: string } | null;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [showAddStep, setShowAddStep] = useState(false);
  const [addPhase, setAddPhase] = useState<"30" | "60" | "90">("30");
  const [addTitle, setAddTitle] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [modalStepId, setModalStepId] = useState<string | null>(null);
  const hashScrolledRef = useRef(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState("");

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const match = hash.match(/^#step-(.+)$/);
    if (match) {
      const stepId = match[1];
      setModalStepId(stepId);
    }
  }, []);

  useEffect(() => {
    if (hashScrolledRef.current) return;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const match = hash.match(/^#step-(.+)$/);
    if (!match || modalStepId !== match[1]) return;
    const el = document.getElementById(`step-${match[1]}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      hashScrolledRef.current = true;
    }
  }, [modalStepId]);

  function handleGenerateFirst() {
    setError(null);
    startTransition(async () => {
      const r = await generatePlan({ familyId });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleRegenerateConfirm() {
    setError(null);
    setShowRegenerateDialog(false);
    const feedback = regenerateFeedback.trim() || undefined;
    setRegenerateFeedback("");
    startTransition(async () => {
      const r = await generatePlan({
        familyId,
        regenerationFeedback: feedback,
      });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleStatusChange(stepId: string, status: PlanStepRow["status"]) {
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStep({ stepId, familyId, status });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function startEdit(step: PlanStepRow) {
    setEditingStepId(step.id);
    setEditTitle(step.title);
    setEditDesc(step.description);
  }

  function cancelEdit() {
    setEditingStepId(null);
  }

  function saveEdit() {
    if (!editingStepId) return;
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStep({
        stepId: editingStepId,
        familyId,
        title: editTitle,
        description: editDesc,
      });
      if (!r.ok) setError(r.error);
      else {
        setEditingStepId(null);
        router.refresh();
      }
    });
  }

  function handleDelete(stepId: string) {
    if (!confirm("Delete this step?")) return;
    setError(null);
    startTransition(async () => {
      const r = await deletePlanStep({ stepId, familyId });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleToggleChecklist(stepId: string, index: number, completed: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await toggleChecklistItem({
        stepId,
        familyId,
        checklistIndex: index,
        completed,
      });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleToggleActionItem(actionItemId: string, completed: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStepActionItem({
        actionItemId,
        familyId,
        status: completed ? "completed" : "pending",
      });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    if (!plan || !addTitle.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await createManualStep({
        familyId,
        planId: plan.id,
        phase: addPhase,
        title: addTitle.trim(),
        description: addDesc.trim(),
      });
      if (!r.ok) setError(r.error);
      else {
        setShowAddStep(false);
        setAddTitle("");
        setAddDesc("");
        router.refresh();
      }
    });
  }

  const allSteps = plan?.steps ?? [];
  const PHASE_ORDER: Record<string, number> = { "30": 0, "60": 1, "90": 2 };
  const sortedSteps = [...allSteps].sort(
    (a, b) => (PHASE_ORDER[a.phase] ?? 99) - (PHASE_ORDER[b.phase] ?? 99),
  );
  const currentStep =
    sortedSteps.find((s) => s.status === "in_progress" || s.status === "blocked") ??
    sortedSteps.find((s) => s.status === "pending") ??
    sortedSteps[0];

  const stepsByPhase = {
    "30": allSteps.filter((s) => s.phase === "30"),
    "60": allSteps.filter((s) => s.phase === "60"),
    "90": allSteps.filter((s) => s.phase === "90"),
  };

  const focusSteps = stepsByPhase;
  const displayPhases = ["30", "60", "90"] as const;

  const modalStep = useMemo(() => {
    if (!plan || !modalStepId) return null;
    return plan.steps.find((s) => s.id === modalStepId) ?? null;
  }, [plan, modalStepId]);

  const completedCount = plan?.steps.filter((s) => s.status === "completed").length ?? 0;
  const totalCount = plan?.steps.length ?? 0;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <>
      <section
        className="rounded-lg border border-slate-200 bg-white"
        id="plan-section"
      >
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6 sm:py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">
                Active work
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                30 / 60 / 90 day plan
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                View all steps. Open any step to update progress, check items, and mark complete.
              </p>
              {plan && totalCount > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-blue-500/80 transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-slate-700">
                    {completedCount} of {totalCount} completed
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {plan ? (
                <>
                  <PlanPdfExport
                    plan={plan}
                    familyName={familyName ?? undefined}
                  />
                  <Button
                    type="button"
                    onClick={() => setShowRegenerateDialog(true)}
                    disabled={pending}
                    variant="secondary"
                    className="border-slate-200"
                  >
                    {pending ? "Generating…" : "Regenerate"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setShowAddStep(true)}
                    disabled={pending}
                    variant="secondary"
                    className="border-slate-200"
                  >
                    Add step
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={handleGenerateFirst}
                  disabled={pending}
                  className="bg-blue-400/90/90 hover:bg-blue-400/90"
                >
                  {pending ? "Generating…" : "Generate plan"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-5 sm:px-8 sm:py-6">
          {error ? (
            <p
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {!plan ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
              <p className="text-base text-slate-600">
                No plan yet. Click <strong>Generate plan</strong> to create one from this family&apos;s goals and barriers.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">Source:</span>
                {plan.generation_source === "openai" ? (
                  <Badge className="border-blue-200/70 bg-blue-50/40 text-blue-700">
                    AI{plan.ai_model ? ` (${plan.ai_model})` : ""}
                  </Badge>
                ) : plan.generation_source === "manual" ? (
                  <Badge className="bg-slate-100 text-slate-700">Manual</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-700">
                    Rules + resources
                  </Badge>
                )}
                {plan.summary ? (
                  <span className="text-slate-400">· {plan.summary}</span>
                ) : null}
              </div>

              <div className="relative">
                <div
                  className="absolute left-4 top-0 bottom-0 w-px bg-slate-200 sm:left-6"
                  aria-hidden
                />
                {displayPhases.map((phase) => (
                  <div key={phase} className="relative pl-12 sm:pl-14">
                    <div className="mb-4 flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white",
                          PHASE_COLORS[phase],
                        )}
                      >
                        {phase}
                      </span>
                      <h3 className="text-lg font-semibold text-slate-900">
                        {PHASE_LABELS[phase]} focus
                      </h3>
                      <span className="text-sm text-slate-500">
                        {focusSteps[phase].length} step
                        {focusSteps[phase].length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {focusSteps[phase].length === 0 ? (
                      <p className="mb-6 rounded-lg bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
                        No steps in this phase. Add one below.
                      </p>
                    ) : (
                      <ul className="mb-8 space-y-4">
                        {focusSteps[phase].map((step) => {
                          const hasRichContent =
                            (step.action_items?.length ?? 0) > 0 ||
                            (step.details as PlanStepDetails | null)?.checklist
                              ?.length ||
                            (step.details as PlanStepDetails | null)
                              ?.detailed_instructions;

                          const w = step.workflow_data;
                          const isBlocked = step.status === "blocked";
                          const isEscalated = w?.needs_escalation;
                          const dueDate = step.due_date
                            ? new Date(step.due_date).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })
                            : null;

                          return (
                            <li
                              key={step.id}
                              id={`step-${step.id}`}
                              className={cn(
                                "relative rounded-lg border bg-white transition-colors duration-150 hover:bg-blue-50/40",
                                isBlocked && "border-red-200",
                                isEscalated && "border-amber-200",
                                !isBlocked && !isEscalated && "border-slate-200",
                              )}
                            >
                              {editingStepId === step.id ? (
                                <div className="p-5 space-y-3">
                                  <Input
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    placeholder="Title"
                                    className="font-medium"
                                  />
                                  <textarea
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    placeholder="Description"
                                    rows={3}
                                    className={textareaClass}
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      className="px-3 py-1.5 text-sm"
                                      onClick={saveEdit}
                                      disabled={pending || !editTitle.trim()}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="px-3 py-1.5 text-sm"
                                      onClick={cancelEdit}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="rounded-lg p-1 -m-1">
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => setModalStepId(step.id)}
                                              className="text-left outline-offset-2 rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-300"
                                            >
                                              <p className="font-semibold text-slate-900">
                                                {step.title}
                                              </p>
                                            </button>
                                            {(step.details as PlanStepDetails | null)?.priority ? (
                                              <Badge className="border-slate-200 bg-white text-slate-600">
                                                {(step.details as PlanStepDetails).priority}
                                              </Badge>
                                            ) : null}
                                            {hasRichContent && (
                                              <button
                                                type="button"
                                                onClick={() => setModalStepId(step.id)}
                                                className="shrink-0 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                                                aria-label="Open step"
                                                title="Open step"
                                              >
                                                <span className="block text-sm font-medium">
                                                  ▼
                                                </span>
                                              </button>
                                            )}
                                          </div>
                                          <div className="mt-2">
                                            <StepPreview
                                              step={step}
                                              expanded={false}
                                              resourceMatches={resourceMatches}
                                              onToggleChecklist={handleToggleChecklist}
                                              checklistPending={pending}
                                              onToggleActionItem={handleToggleActionItem}
                                              familyName={familyName}
                                              familyId={familyId}
                                            />
                                          </div>
                                          {hasRichContent ? (
                                            <button
                                              type="button"
                                              onClick={() => setModalStepId(step.id)}
                                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600/90 hover:text-blue-600 hover:underline"
                                            >
                                              Expand for details
                                              <span aria-hidden>↓</span>
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => setModalStepId(step.id)}
                                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600/90 hover:text-blue-600 hover:underline"
                                            >
                                              Open to update status and progress
                                              <span aria-hidden>→</span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 flex-col items-end gap-2">
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                          {isEscalated ? (
                                            <Badge className="border-amber-200 bg-amber-50 text-amber-800">
                                              Needs escalation
                                            </Badge>
                                          ) : null}
                                          {dueDate ? (
                                            <span
                                              className="text-xs text-slate-500"
                                              title="Follow-up date"
                                            >
                                              Due {dueDate}
                                            </span>
                                          ) : null}
                                          <StepStatusBadge
                                            status={
                                              step.status as
                                                | "pending"
                                                | "in_progress"
                                                | "completed"
                                                | "blocked"
                                            }
                                            onChange={(s) =>
                                              handleStatusChange(step.id, s)
                                            }
                                            disabled={pending}
                                          />
                                          {(step.details as PlanStepDetails | null)?.checklist && (
                                            <ChecklistProgressBadge
                                              completed={
                                                (
                                                  (step.workflow_data as {
                                                    checklist_completed?: boolean[];
                                                  })?.checklist_completed ?? []
                                                ).filter(Boolean).length
                                              }
                                              total={
                                                (
                                                  step.details as PlanStepDetails
                                                )?.checklist?.length ?? 0
                                              }
                                              showBar
                                            />
                                          )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          {step.status !== "completed" && (
                                            <Button
                                              type="button"
                                              className="h-8 bg-blue-400/90/90 px-3 text-xs font-medium text-white hover:bg-blue-400/90"
                                              onClick={() =>
                                                handleStatusChange(
                                                  step.id,
                                                  "completed",
                                                )
                                              }
                                              disabled={pending}
                                            >
                                              Mark complete
                                            </Button>
                                          )}
                                          <Button
                                            type="button"
                                            variant="secondary"
                                            className="h-8 px-2.5 text-xs"
                                            onClick={() => setModalStepId(step.id)}
                                            title="Open step to work on it"
                                          >
                                            Open step
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            className="h-8 px-2.5 text-xs"
                                            onClick={() => startEdit(step)}
                                            title="Update status, notes, and checklist"
                                          >
                                            Edit step
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-8 px-2 text-red-600 hover:text-red-800"
                                            onClick={() => handleDelete(step.id)}
                                          >
                                            Delete
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {showAddStep ? (
                <form
                  onSubmit={handleAddStep}
                  className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5"
                >
                  <h4 className="mb-4 text-sm font-semibold text-slate-800">
                    Add step
                  </h4>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="add-phase">Phase</Label>
                      <select
                        id="add-phase"
                        value={addPhase}
                        onChange={(e) =>
                          setAddPhase(e.target.value as "30" | "60" | "90")
                        }
                        className={`mt-1 ${selectInputClass}`}
                      >
                        <option value="30">30-day</option>
                        <option value="60">60-day</option>
                        <option value="90">90-day</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="add-title">Title</Label>
                      <Input
                        id="add-title"
                        value={addTitle}
                        onChange={(e) => setAddTitle(e.target.value)}
                        placeholder="Step title"
                        className="mt-1"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="add-desc">Description (optional)</Label>
                      <textarea
                        id="add-desc"
                        value={addDesc}
                        onChange={(e) => setAddDesc(e.target.value)}
                        placeholder="Details…"
                        rows={3}
                        className={`mt-1 ${textareaClass}`}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={pending || !addTitle.trim()}
                      >
                        Add step
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setShowAddStep(false);
                          setAddTitle("");
                          setAddDesc("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {showRegenerateDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            aria-label="Close"
            onClick={() => {
              setShowRegenerateDialog(false);
              setRegenerateFeedback("");
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="regenerate-plan-title"
            className="relative z-10 w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5"
          >
            <h3
              id="regenerate-plan-title"
              className="text-lg font-semibold text-slate-900"
            >
              Regenerate plan
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              A new plan version will be created from your family data and
              resources. Optional: tell the AI what to change or emphasize.
            </p>
            <div className="mt-4">
              <Label htmlFor="regenerate-feedback">
                Feedback for the AI (optional)
              </Label>
              <textarea
                id="regenerate-feedback"
                value={regenerateFeedback}
                onChange={(e) => setRegenerateFeedback(e.target.value)}
                placeholder="e.g. Fewer steps, focus on housing first, family has no car, include more document prep…"
                rows={4}
                maxLength={4000}
                className={`mt-1.5 ${textareaClass}`}
              />
              <p className="mt-1 text-xs text-slate-500">
                {regenerateFeedback.length}/4000
              </p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowRegenerateDialog(false);
                  setRegenerateFeedback("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleRegenerateConfirm}
                disabled={pending}
              >
                {pending ? "Generating…" : "Regenerate plan"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {plan && modalStep ? (
        <PlanStepModal
          key={`${modalStep.id}-${modalStep.updated_at}`}
          step={modalStep}
          plan={plan}
          familyId={familyId}
          onClose={() => setModalStepId(null)}
        />
      ) : null}
    </>
  );
}
