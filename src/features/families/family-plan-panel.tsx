"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewRefinePlanStep,
  previewRefinePlan,
  updatePlan,
  updatePlanStep,
  updatePlanStepActionItem,
} from "@/app/actions/plans";
import { useAIMode } from "@/components/providers/ai-mode-provider";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlanPdfExport } from "@/features/families/plan-pdf-export";
import { PlanStepCaseNote } from "@/features/families/plan-step-case-note";
import { cn } from "@/lib/utils/cn";
import type { BarrierWorkflowResult } from "@/types/barrier-workflow";
import type {
  PlanStepActionItemRow,
  PlanStepDetails,
  PlanStepRow,
  PlanWithSteps,
} from "@/types/family";

function normalizeChecklistForSave(lines: string[] | undefined): string[] {
  return (lines ?? []).map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Snapshot of what we persist in `updatePlanStep`, for dirty detection only. */
function normalizeStepForPersistCompare(step: PlanStepRow): string {
  const d = { ...(step.details as PlanStepDetails | null | undefined) } as PlanStepDetails;
  const normalizedChecklist = normalizeChecklistForSave(d.checklist);
  if (normalizedChecklist.length > 0) {
    d.checklist = normalizedChecklist;
  } else {
    delete d.checklist;
  }
  const checklistLen = normalizedChecklist.length;
  const wd = { ...(step.workflow_data ?? {}) };
  if (wd.checklist_completed && wd.checklist_completed.length !== checklistLen) {
    wd.checklist_completed = Array(checklistLen).fill(false);
  }
  return JSON.stringify({
    title: step.title,
    description: step.description,
    status: step.status,
    phase: step.phase,
    priority: step.priority ?? undefined,
    details: Object.keys(d).length > 0 ? d : undefined,
    workflow_data: wd,
  });
}

function stepNeedsPersist(orig: PlanStepRow | undefined, next: PlanStepRow): boolean {
  if (!orig) return true;
  return normalizeStepForPersistCompare(orig) !== normalizeStepForPersistCompare(next);
}

function clonePlan(p: PlanWithSteps): PlanWithSteps {
  return structuredClone(p) as PlanWithSteps;
}

function plansEqual(a: PlanWithSteps, b: PlanWithSteps): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type PhaseSummaries = { "30": string; "60": string; "90": string };

function defaultPhaseSummaries(): PhaseSummaries {
  return {
    "30": "Immediate stabilization and first outreach actions.",
    "60": "Follow-through on submissions, appointments, and follow-ups.",
    "90": "Sustain progress, handle renewals, and close remaining blockers.",
  };
}

export function FamilyPlanPanel({
  familyId,
  familyName,
  plan,
  workflow,
  onToggleActionItem: _onToggleActionItem,
  actionToggleDisabled: _actionToggleDisabled,
}: {
  familyId: string;
  familyName: string;
  plan: PlanWithSteps | null;
  workflow: BarrierWorkflowResult | null;
  /** @deprecated Plan UI no longer shows action-item checkboxes; kept for API compatibility. */
  onToggleActionItem?: (actionItemId: string, done: boolean) => void;
  actionToggleDisabled?: boolean;
}) {
  const router = useRouter();
  const { mode: aiMode } = useAIMode();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlanWithSteps | null>(null);
  const [phaseSummaries, setPhaseSummaries] = useState<PhaseSummaries>(() =>
    defaultPhaseSummaries(),
  );
  const [planTitle, setPlanTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [aiStepId, setAiStepId] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiPreview, setAiPreview] = useState<{
    title: string;
    description: string;
    details: PlanStepDetails;
    stepPriority?: "low" | "medium" | "high" | "urgent";
  } | null>(null);
  const [aiPending, setAiPending] = useState(false);

  const [planAiOpen, setPlanAiOpen] = useState(false);
  const [planAiInstruction, setPlanAiInstruction] = useState("");
  const [planAiPending, setPlanAiPending] = useState(false);
  const [planAiPreview, setPlanAiPreview] = useState<
    | null
    | {
        model: string;
        steps: Array<{
          phase: "30" | "60" | "90";
          title: string;
          description: string;
          details: PlanStepDetails;
          action_items: Array<{
            title: string;
            description: string | null | undefined;
            week_index: number;
            target_date: string | null | undefined;
          }>;
        }>;
      }
  >(null);

  const baseline = useMemo(() => (plan ? clonePlan(plan) : null), [plan]);

  const dirty = useMemo(() => {
    if (!editing || !draft || !baseline) return false;
    if (planTitle.trim() !== (baseline.client_display?.title ?? "").trim()) return true;
    for (const ph of ["30", "60", "90"] as const) {
      const def = workflow?.sections.find((s) => s.phase === ph)?.summary ?? "";
      const baseSummary =
        baseline.client_display?.phaseSummaries?.[ph] ?? def ?? defaultPhaseSummaries()[ph];
      if (phaseSummaries[ph].trim() !== baseSummary.trim()) return true;
    }
    return !plansEqual(draft, baseline);
  }, [editing, draft, baseline, planTitle, phaseSummaries, workflow]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const stepsByPhase = useMemo(() => {
    const src = editing && draft ? draft.steps : plan?.steps ?? [];
    const grouped: Record<"30" | "60" | "90", PlanStepRow[]> = {
      "30": [],
      "60": [],
      "90": [],
    };
    for (const s of [...src].sort((a, b) => a.sort_order - b.sort_order)) {
      grouped[s.phase].push(s);
    }
    return grouped;
  }, [editing, draft, plan]);

  const beginEdit = useCallback(() => {
    if (!plan) return;
    setDraft(clonePlan(plan));
    setPlanTitle(plan.client_display?.title ?? "");
    const ps = plan.client_display?.phaseSummaries;
    setPhaseSummaries({
      "30": ps?.["30"] ?? workflow?.sections.find((s) => s.phase === "30")?.summary ?? defaultPhaseSummaries()["30"],
      "60": ps?.["60"] ?? workflow?.sections.find((s) => s.phase === "60")?.summary ?? defaultPhaseSummaries()["60"],
      "90": ps?.["90"] ?? workflow?.sections.find((s) => s.phase === "90")?.summary ?? defaultPhaseSummaries()["90"],
    });
    setEditing(true);
    setError(null);
    setSuccess(null);
  }, [plan, workflow]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(null);
    setError(null);
    setSuccess(null);
    if (plan) {
      setPlanTitle(plan.client_display?.title ?? "");
      const ps = plan.client_display?.phaseSummaries;
      setPhaseSummaries({
        "30": ps?.["30"] ?? workflow?.sections.find((s) => s.phase === "30")?.summary ?? defaultPhaseSummaries()["30"],
        "60": ps?.["60"] ?? workflow?.sections.find((s) => s.phase === "60")?.summary ?? defaultPhaseSummaries()["60"],
        "90": ps?.["90"] ?? workflow?.sections.find((s) => s.phase === "90")?.summary ?? defaultPhaseSummaries()["90"],
      });
    }
  }, [plan, workflow]);

  function updateStepInDraft(stepId: string, patch: Partial<PlanStepRow>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
      };
    });
  }

  function updateStepDetails(stepId: string, patch: Partial<PlanStepDetails>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s) => {
          if (s.id !== stepId) return s;
          const d = (s.details ?? {}) as PlanStepDetails;
          return { ...s, details: { ...d, ...patch } };
        }),
      };
    });
  }

  function updateActionItemInDraft(
    stepId: string,
    actionItemId: string,
    patch: Partial<PlanStepActionItemRow>,
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s) => {
          if (s.id !== stepId) return s;
          const items = (s.action_items ?? []).map((ai) =>
            ai.id === actionItemId ? { ...ai, ...patch } : ai,
          );
          return { ...s, action_items: items };
        }),
      };
    });
  }

  function saveAll() {
    if (!draft || !plan) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      let clientDisplayNeedsUpdate = !baseline;
      if (baseline) {
        if (planTitle.trim() !== (baseline.client_display?.title ?? "").trim()) {
          clientDisplayNeedsUpdate = true;
        } else {
          for (const ph of ["30", "60", "90"] as const) {
            const def = workflow?.sections.find((s) => s.phase === ph)?.summary ?? "";
            const baseSummary =
              baseline.client_display?.phaseSummaries?.[ph] ??
              def ??
              defaultPhaseSummaries()[ph];
            if (phaseSummaries[ph].trim() !== baseSummary.trim()) {
              clientDisplayNeedsUpdate = true;
              break;
            }
          }
        }
      }

      if (clientDisplayNeedsUpdate) {
        const rPlan = await updatePlan({
          familyId,
          clientDisplay: {
            title: planTitle.trim() || undefined,
            phaseSummaries: {
              "30": phaseSummaries["30"].trim() || undefined,
              "60": phaseSummaries["60"].trim() || undefined,
              "90": phaseSummaries["90"].trim() || undefined,
            },
          },
        });
        if (!rPlan.ok) {
          setError(rPlan.error);
          return;
        }
      }

      for (const s of draft.steps) {
        const orig = baseline?.steps.find((x) => x.id === s.id);
        if (stepNeedsPersist(orig, s)) {
          const d = { ...(s.details as PlanStepDetails | null | undefined) } as PlanStepDetails;
          const normalizedChecklist = normalizeChecklistForSave(d.checklist);
          if (normalizedChecklist.length > 0) {
            d.checklist = normalizedChecklist;
          } else {
            delete d.checklist;
          }
          const checklistLen = normalizedChecklist.length;
          const wd = { ...(s.workflow_data ?? {}) };
          if (wd.checklist_completed && wd.checklist_completed.length !== checklistLen) {
            wd.checklist_completed = Array(checklistLen).fill(false);
          }

          const stepRes = await updatePlanStep({
            stepId: s.id,
            familyId,
            title: s.title,
            description: s.description,
            status: s.status,
            phase: s.phase,
            priority: (s.priority ?? undefined) as "low" | "medium" | "high" | "urgent" | undefined,
            details: Object.keys(d).length > 0 ? d : undefined,
            workflow_data: wd,
          });
          if (!stepRes.ok) {
            setError(stepRes.error);
            return;
          }
        }

        for (const ai of s.action_items ?? []) {
          const oai = orig?.action_items?.find((x) => x.id === ai.id);
          const aiChanged =
            !oai ||
            oai.title !== ai.title ||
            (oai.description ?? "") !== (ai.description ?? "") ||
            oai.week_index !== ai.week_index ||
            oai.status !== ai.status;
          if (!aiChanged) continue;
          const ar = await updatePlanStepActionItem({
            actionItemId: ai.id,
            familyId,
            title: ai.title,
            description: ai.description,
            week_index: ai.week_index,
            status: ai.status,
          });
          if (!ar.ok) {
            setError(ar.error);
            return;
          }
        }
      }

      setSuccess("Plan saved.");
      setEditing(false);
      setDraft(null);
      router.refresh();
    });
  }

  function openAiForStep(stepId: string) {
    if (!plan) return;
    if (!editing) beginEdit();
    setAiStepId(stepId);
    setAiInstruction("");
    setAiPreview(null);
    setError(null);
  }

  function runAiPreview() {
    if (!aiStepId) return;
    const instr = aiInstruction.trim();
    if (!instr) {
      setError("Describe what you want changed for this step.");
      return;
    }
    setAiPending(true);
    setError(null);
    previewRefinePlanStep({ stepId: aiStepId, familyId, feedback: instr, aiMode }).then((res) => {
      setAiPending(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAiPreview({
        title: res.step.title,
        description: res.step.description,
        details: res.step.details as PlanStepDetails,
        stepPriority: res.step.stepPriority,
      });
    });
  }

  function applyAiToDraft() {
    if (!aiPreview || !aiStepId || !draft) return;
    const checklistLen = (aiPreview.details.checklist ?? []).length;
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s) => {
          if (s.id !== aiStepId) return s;
          const wd = { ...(s.workflow_data ?? {}) };
          wd.checklist_completed = Array(checklistLen).fill(false);
          return {
            ...s,
            title: aiPreview.title,
            description: aiPreview.description,
            details: aiPreview.details,
            priority: aiPreview.stepPriority ?? s.priority,
            workflow_data: wd,
          };
        }),
      };
    });
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
  }

  function ensureDraftForPlanRefine(): PlanWithSteps | null {
    if (!plan) return null;
    if (editing && draft) return draft;

    const nextDraft = clonePlan(plan);
    setDraft(nextDraft);
    setPlanTitle(plan.client_display?.title ?? "");
    const ps = plan.client_display?.phaseSummaries;
    setPhaseSummaries({
      "30": ps?.["30"] ?? workflow?.sections.find((s) => s.phase === "30")?.summary ?? defaultPhaseSummaries()["30"],
      "60": ps?.["60"] ?? workflow?.sections.find((s) => s.phase === "60")?.summary ?? defaultPhaseSummaries()["60"],
      "90": ps?.["90"] ?? workflow?.sections.find((s) => s.phase === "90")?.summary ?? defaultPhaseSummaries()["90"],
    });
    setEditing(true);
    setError(null);
    setSuccess(null);
    return nextDraft;
  }

  function openPlanAiRefine() {
    setPlanAiInstruction("");
    setPlanAiPreview(null);
    setError(null);
    setPlanAiOpen(true);
    ensureDraftForPlanRefine();
  }

  function runPlanAiPreview(nextDraft: PlanWithSteps) {
    const instr = planAiInstruction.trim();
    if (!instr) {
      setError("Describe what you want to change for the full plan.");
      return;
    }

    setPlanAiPending(true);
    setError(null);

    const draftForApi = {
      steps: nextDraft.steps.map((s) => ({
        phase: s.phase,
        title: s.title,
        description: s.description,
        details: s.details ?? {},
        action_items:
          (s.action_items ?? []).length > 0 ?
            (s.action_items ?? []).map((ai) => ({
              title: ai.title,
              description: ai.description ?? null,
              week_index: ai.week_index,
              target_date: ai.target_date,
            }))
          : [{ title: s.title, description: null, week_index: 1, target_date: null }],
      })),
    };

    previewRefinePlan({ familyId, feedback: instr, draft: draftForApi, aiMode }).then((res) => {
      setPlanAiPending(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlanAiPreview({ model: res.model, steps: res.steps });
    });
  }

  function applyPlanAiToDraft() {
    if (!planAiPreview || !draft) return;

    const previewSteps = planAiPreview.steps;
    const baseSteps = draft.steps;

    if (previewSteps.length !== baseSteps.length) {
      setError("AI refinement changed step count. Please try again or adjust your instructions.");
      return;
    }
    for (let i = 0; i < baseSteps.length; i++) {
      if (previewSteps[i].phase !== baseSteps[i].phase) {
        setError("AI refinement changed step phase assignment. Please try again.");
        return;
      }
    }

    for (let i = 0; i < baseSteps.length; i++) {
      const baseAisLen = baseSteps[i].action_items?.length ?? 0;
      const previewAisLen = previewSteps[i].action_items?.length ?? 0;
      if (baseAisLen !== previewAisLen) {
        setError(
          "AI refinement changed the weekly action item count per step. Please try again or specify smaller changes.",
        );
        return;
      }
    }

    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s, i) => {
          const aiStep = previewSteps[i];
          const newDetails = aiStep.details;
          const checklistLen = (newDetails.checklist ?? []).length;

          const existingWd = { ...(s.workflow_data ?? {}) };
          const prevChecklistCompleted = existingWd.checklist_completed ?? [];
          const nextChecklistCompleted = Array(checklistLen)
            .fill(false)
            .map((_, idx) => prevChecklistCompleted[idx] ?? false);
          existingWd.checklist_completed = nextChecklistCompleted;

          const prevAis = s.action_items ?? [];
          const nextAis = prevAis.map((ai, j) => {
            const aiPreview = aiStep.action_items[j];
            if (!aiPreview) return ai;
            return {
              ...ai,
              title: aiPreview.title,
              description: aiPreview.description ?? null,
              week_index: aiPreview.week_index,
              target_date: null,
            };
          });

          return {
            ...s,
            title: aiStep.title,
            description: aiStep.description,
            details: newDetails,
            priority: newDetails.priority ?? s.priority,
            workflow_data: existingWd,
            action_items: nextAis,
          };
        }),
      };
    });

    setPlanAiOpen(false);
    setPlanAiPreview(null);
    setPlanAiInstruction("");
  }

  if (!workflow) {
    return (
      <p className="text-sm text-slate-600">
        Generate a plan from the Overview tab to see your 30 / 60 / 90 day roadmap here.
      </p>
    );
  }

  const displayTitle =
    workflow.planDisplayTitle?.trim() ||
    plan?.client_display?.title?.trim() ||
    plan?.summary?.trim() ||
    "30 / 60 / 90 day plan";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">{displayTitle}</CardTitle>
          {plan ? (
            <p className="mt-1 text-xs text-slate-500">
              Version {plan.version}
              {plan.presentation?.sourceKind === "ai" ? " · AI-assisted" : ""}
            </p>
          ) : null}
          {workflow?.selectedBarriers?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {workflow.selectedBarriers.slice(0, 6).map((b) => (
                <span
                  key={b}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700"
                >
                  {b}
                </span>
              ))}
              {workflow.selectedBarriers.length > 6 ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  +{workflow.selectedBarriers.length - 6} more
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plan ? (
            <PlanPdfExport plan={plan} familyName={familyName} documentTitle={displayTitle} />
          ) : null}
          {plan && !editing ? (
            <Button
              type="button"
              onClick={openPlanAiRefine}
              variant="secondary"
              className="border-slate-200"
              disabled={planAiPending}
            >
              {planAiPending ? "Refining…" : "Refine with AI"}
            </Button>
          ) : null}
          {plan && !editing ? (
            <Button type="button" onClick={beginEdit} variant="secondary" className="border-slate-200">
              Edit plan
            </Button>
          ) : null}
          {editing ? (
            <>
              <Button
                type="button"
                onClick={openPlanAiRefine}
                variant="secondary"
                className="border-slate-200"
                disabled={planAiPending}
              >
                {planAiPending ? "Refining…" : "Refine with AI"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={cancelEdit}
                disabled={pending}
                className="text-slate-600"
              >
                Cancel
              </Button>
              <Button type="button" onClick={saveAll} disabled={pending || !dirty}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {success}
        </p>
      ) : null}

      {plan?.generation_state?.status === "running" ? (
        <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-950">
          <p className="font-medium">Building your draft plan</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
            {plan.generation_state.phases_complete["30"] ? "30-day section saved. " : null}
            {plan.generation_state.phases_complete["60"] ? "60-day section saved. " : null}
            {!plan.generation_state.phases_complete["60"]
              ? "Drafting 60-day section in the background…"
              : !plan.generation_state.phases_complete["90"]
                ? "Drafting 90-day section…"
                : "Almost done…"}
          </p>
        </div>
      ) : null}
      {plan?.generation_state?.status === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {plan.generation_state.error ??
            "Later phases could not be generated. You can edit the saved steps or regenerate from Overview."}
        </div>
      ) : null}

      {!plan ? (
        <p className="text-sm text-slate-600">
          No saved case plan yet. Use Overview to generate a plan; it will appear here for editing and export.
        </p>
      ) : null}

      {editing && draft ? (
        <div className="space-y-4 rounded-xl border border-blue-200/80 bg-blue-50/30 p-4">
          <div>
            <Label htmlFor="plan-title">Plan title</Label>
            <Input
              id="plan-title"
              className="mt-1.5"
              value={planTitle}
              onChange={(e) => setPlanTitle(e.target.value)}
              placeholder="e.g. Housing stabilization roadmap"
            />
          </div>
          {(["30", "60", "90"] as const).map((ph) => (
            <div key={ph}>
              <Label htmlFor={`phase-${ph}`}>{ph}-day section intro</Label>
              <Textarea
                id={`phase-${ph}`}
                className="mt-1.5 min-h-[72px] border-slate-200/90"
                value={phaseSummaries[ph]}
                onChange={(e) =>
                  setPhaseSummaries((prev) => ({ ...prev, [ph]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {workflow.sections.map((section) => (
            <section key={section.phase} className="max-w-[800px] space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200/80 pb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {section.phase}-day horizon
                </h3>
                <p className="text-xs text-slate-400">{section.dueRangeLabel}</p>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                {editing ? phaseSummaries[section.phase] : section.summary}
              </p>
              <div className="mt-4 space-y-8">
                {stepsByPhase[section.phase].map((full) => (
                  <PlanStepCaseNote
                    key={full.id}
                    step={full}
                    editing={Boolean(editing)}
                    onPatchStep={(patch) => updateStepInDraft(full.id, patch)}
                    onPatchDetails={(patch) => updateStepDetails(full.id, patch)}
                    onPatchWorkflow={
                      editing
                        ? (next) =>
                            updateStepInDraft(full.id, {
                              workflow_data: next,
                            })
                        : undefined
                    }
                    refineOpen={aiStepId === full.id}
                    refineInstruction={aiInstruction}
                    refinePreview={aiPreview}
                    refinePending={aiPending}
                    onRefineInstruction={setAiInstruction}
                    onRefineRun={runAiPreview}
                    onRefineApply={applyAiToDraft}
                    onRefineClose={() => {
                      setAiStepId(null);
                      setAiPreview(null);
                      setAiInstruction("");
                    }}
                    onRefineDiscardPreview={() => setAiPreview(null)}
                    onOpenRefine={() => openAiForStep(full.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resources</p>
            <p className="mt-1 text-sm text-slate-600">
              Curated Philadelphia nonprofit options matched to this plan.
            </p>

            <div className="mt-4 space-y-3">
              {(workflow.resources ?? []).slice(0, 10).map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {r.programName || r.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{r.category ?? r.name}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      {Math.round(r.similarityScore)}%
                    </span>
                  </div>

                  {r.description ? (
                    <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                      {r.description}
                    </p>
                  ) : null}

                  <div className="mt-2 space-y-1">
                    {r.primaryPhone ? (
                      <a className="block text-xs text-blue-700 hover:underline" href={`tel:${r.primaryPhone}`}>
                        {r.primaryPhone}
                      </a>
                    ) : null}
                    {r.primaryEmail ? (
                      <a className="block text-xs text-blue-700 hover:underline break-all" href={`mailto:${r.primaryEmail}`}>
                        {r.primaryEmail}
                      </a>
                    ) : null}
                  </div>

                  {r.whyMatched ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                        Why this matches
                      </summary>
                      <p className="mt-1 text-xs text-slate-700 leading-relaxed">
                        {r.whyMatched}
                      </p>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {planAiOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-ai-title"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="plan-ai-title" className="text-base font-semibold text-slate-900">
              Refine full plan with AI
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              This generates a revised version of your current draft (preview only). Review it and apply
              changes to your draft; nothing is saved until you click <strong>Save changes</strong>.
            </p>

            <Textarea
              className="mt-3 min-h-[120px] border-slate-200"
              value={planAiInstruction}
              onChange={(e) => setPlanAiInstruction(e.target.value)}
              placeholder="e.g. Make the 30-day steps more realistic for a single parent; improve chronological flow; keep all manual edits unless necessary."
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const nd = ensureDraftForPlanRefine();
                  if (!nd) return;
                  runPlanAiPreview(nd);
                }}
                disabled={planAiPending}
              >
                {planAiPending ? "Generating…" : "Generate preview"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPlanAiOpen(false);
                  setPlanAiPreview(null);
                  setPlanAiInstruction("");
                }}
              >
                Close
              </Button>
            </div>

            {planAiPreview ? (
              <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-sm font-semibold text-slate-900">
                  Preview ready ({planAiPreview.steps.length} steps · {planAiPreview.model})
                </p>
                <div className="grid gap-2 md:grid-cols-3">
                  {(["30", "60", "90"] as const).map((ph) => {
                    const titles = planAiPreview.steps
                      .filter((s) => s.phase === ph)
                      .map((s) => s.title)
                      .slice(0, 3);
                    return (
                      <div key={ph}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {ph}-day
                        </p>
                        <ul className="mt-1 list-disc pl-5 text-slate-700">
                          {titles.map((t, i) => (
                            <li key={`${ph}-${i}`}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={applyPlanAiToDraft}>
                    Apply to draft
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPlanAiPreview(null)}
                  >
                    Discard preview
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
