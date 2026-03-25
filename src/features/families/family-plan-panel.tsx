"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewRefinePlanStep,
  previewRefinePlan,
  toggleChecklistItem,
  updatePlan,
  updatePlanStep,
  updatePlanStepActionItem,
} from "@/app/actions/plans";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlanPdfExport } from "@/features/families/plan-pdf-export";
import { checkboxClass } from "@/lib/ui/form-classes";
import { cn } from "@/lib/utils/cn";
import type { BarrierWorkflowResult } from "@/types/barrier-workflow";
import type {
  PlanStepActionItemRow,
  PlanStepDetails,
  PlanStepRow,
  PlanWithSteps,
} from "@/types/family";

const PHASE_STYLE: Record<"30" | "60" | "90", string> = {
  "30": "border-blue-200 bg-blue-50/50",
  "60": "border-indigo-200 bg-indigo-50/40",
  "90": "border-violet-200 bg-violet-50/40",
};

function formatDue(dueDate: string | null): string {
  if (!dueDate) return "No date";
  return new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function checklistToText(lines: string[] | undefined): string {
  return (lines ?? []).join("\n");
}

/** Keeps blank lines so pressing Enter can open a new checklist row while editing. */
function textToChecklist(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim());
}

function normalizeChecklistForSave(lines: string[] | undefined): string[] {
  return (lines ?? []).map((l) => l.trim()).filter((l) => l.length > 0);
}

function textToNonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function normalizeContactsForSave(
  contacts:
    | Array<{
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        notes?: string | null;
      }>
    | undefined
    | null,
): PlanStepDetails["contacts"] {
  const normalized = (contacts ?? []).map((c) => ({
    name: c.name?.trim() ? c.name.trim() : undefined,
    phone: c.phone?.trim() ? c.phone.trim() : undefined,
    email: c.email?.trim() ? c.email.trim() : undefined,
    notes: c.notes?.trim() ? c.notes.trim() : undefined,
  }));

  // Drop completely empty contact rows.
  return normalized.filter((c) => Boolean(c.name || c.phone || c.email || c.notes));
}

type DisplayWeeklyActionItem = {
  id: string;
  title: string;
  description: string | null | undefined;
  dueDate: string | null;
  status: PlanStepActionItemRow["status"];
};

const ACTION_VERB_RE =
  /\b(call|submit|send|confirm|apply|schedule|register|request|book|gather|arrange|complete|enroll|secure|attend|file|prepare|contact)\b/i;

// Heuristic: these strings tend to be "artifacts" (docs/info) rather than an executable action.
const ARTIFACT_DOC_RE =
  /\b(photo\s*id|photo\s*i\.?d|proof|lease|rent\s*statement|past-?due|statement|id\b|income\s*loss|layoff)\b/i;
const ARTIFACT_CONTACT_RE =
  /\b(email|phone|landlord\s*(email|phone)|contact\s*info)\b/i;

function isArtifactLikeActionItemTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  // If it's already phrased like an action, keep it as a standalone action item.
  if (ACTION_VERB_RE.test(t)) return false;
  return ARTIFACT_DOC_RE.test(t) || ARTIFACT_CONTACT_RE.test(t);
}

function groupArtifactActionItems(
  items: DisplayWeeklyActionItem[],
): { groups: Array<{ parent: DisplayWeeklyActionItem; artifacts: DisplayWeeklyActionItem[] }>; orphans: DisplayWeeklyActionItem[] } {
  const groups: Array<{ parent: DisplayWeeklyActionItem; artifacts: DisplayWeeklyActionItem[] }> = [];
  const orphans: DisplayWeeklyActionItem[] = [];

  let currentGroupIndex = -1;

  for (const item of items) {
    if (isArtifactLikeActionItemTitle(item.title)) {
      if (currentGroupIndex >= 0) {
        groups[currentGroupIndex]?.artifacts.push(item);
      } else {
        orphans.push(item);
      }
    } else {
      groups.push({ parent: item, artifacts: [] });
      currentGroupIndex = groups.length - 1;
    }
  }

  return { groups, orphans };
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
  onToggleActionItem,
  actionToggleDisabled,
}: {
  familyId: string;
  familyName: string;
  plan: PlanWithSteps | null;
  workflow: BarrierWorkflowResult | null;
  /** When set, view mode shows completion checkboxes for weekly items (barrier workflow). */
  onToggleActionItem?: (actionItemId: string, done: boolean) => void;
  actionToggleDisabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlanWithSteps | null>(null);
  const [phaseSummaries, setPhaseSummaries] = useState<PhaseSummaries>(() =>
    defaultPhaseSummaries(),
  );
  const [planTitle, setPlanTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiStepId, setAiStepId] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiPreview, setAiPreview] = useState<{
    title: string;
    description: string;
    details: PlanStepDetails;
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

      for (const s of draft.steps) {
        const orig = baseline?.steps.find((x) => x.id === s.id);
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
          due_date: s.due_date,
          details: Object.keys(d).length > 0 ? d : undefined,
          workflow_data: wd,
        });
        if (!stepRes.ok) {
          setError(stepRes.error);
          return;
        }

        for (const ai of s.action_items ?? []) {
          const oai = orig?.action_items?.find((x) => x.id === ai.id);
          const aiChanged =
            !oai ||
            oai.title !== ai.title ||
            (oai.description ?? "") !== (ai.description ?? "") ||
            oai.week_index !== ai.week_index ||
            (oai.target_date ?? "") !== (ai.target_date ?? "") ||
            oai.status !== ai.status;
          if (!aiChanged) continue;
          const ar = await updatePlanStepActionItem({
            actionItemId: ai.id,
            familyId,
            title: ai.title,
            description: ai.description,
            week_index: ai.week_index,
            target_date: ai.target_date,
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

  function onDetailChecklistToggle(stepId: string, index: number, completed: boolean) {
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

  function openAiForStep(stepId: string) {
    setAiStepId(stepId);
    setAiInstruction("");
    setAiPreview(null);
    setAiOpen(true);
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
    previewRefinePlanStep({ stepId: aiStepId, familyId, feedback: instr }).then((res) => {
      setAiPending(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAiPreview({
        title: res.step.title,
        description: res.step.description,
        details: res.step.details as PlanStepDetails,
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
            workflow_data: wd,
          };
        }),
      };
    });
    setAiOpen(false);
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
          : [{ title: s.title, description: null, week_index: 1, target_date: s.due_date }],
      })),
    };

    previewRefinePlan({ familyId, feedback: instr, draft: draftForApi }).then((res) => {
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
              target_date: aiPreview.target_date ?? null,
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
            <section
              key={section.phase}
              className={cn(
                "rounded-xl border bg-white p-4",
                PHASE_STYLE[section.phase],
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{section.phase}-day</h3>
                <p className="text-xs text-slate-500">{section.dueRangeLabel}</p>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {editing ? phaseSummaries[section.phase] : section.summary}
              </p>
              <div className="mt-3 space-y-3">
                {stepsByPhase[section.phase].map((full) => {
                  const d = (full?.details ?? {}) as PlanStepDetails;
                  const barrierActionItems = (full.action_items ?? []).map((ai) => ({
                    id: ai.id,
                    title: ai.title,
                    description: ai.description,
                    dueDate: ai.target_date,
                    status: ai.status,
                  }));
                  return (
                    <article
                      key={full.id}
                      id={`step-${full.id}`}
                      className="rounded-lg border border-slate-200/90 bg-white/90 p-3 shadow-sm"
                    >
                      {editing ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 border-slate-200 text-xs"
                            onClick={() => openAiForStep(full.id)}
                          >
                            Edit with AI
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <Label>Step title</Label>
                            <Input
                              className="mt-1"
                              value={full.title}
                              onChange={(e) => updateStepInDraft(full.id, { title: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label>Phase</Label>
                            <select
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              value={full.phase}
                              onChange={(e) =>
                                updateStepInDraft(full.id, {
                                  phase: e.target.value as PlanStepRow["phase"],
                                })
                              }
                            >
                              <option value="30">30-day</option>
                              <option value="60">60-day</option>
                              <option value="90">90-day</option>
                            </select>
                          </div>
                          <div>
                            <Label>Status</Label>
                            <select
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              value={full.status}
                              onChange={(e) =>
                                updateStepInDraft(full.id, {
                                  status: e.target.value as PlanStepRow["status"],
                                })
                              }
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">In progress</option>
                              <option value="completed">Completed</option>
                              <option value="blocked">Blocked</option>
                            </select>
                          </div>
                          <div>
                            <Label>Priority</Label>
                            <select
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              value={full.priority ?? "medium"}
                              onChange={(e) =>
                                (() => {
                                  const nextPriority = e.target.value as PlanStepRow["priority"];
                                  const detailsPriority =
                                    nextPriority === "urgent" ? "high" : nextPriority ?? "medium";
                                  updateStepInDraft(full.id, { priority: nextPriority });
                                  updateStepDetails(full.id, { priority: detailsPriority });
                                })()
                              }
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                              <option value="urgent">Urgent</option>
                            </select>
                          </div>
                          <div>
                            <Label>Follow-up date</Label>
                            <Input
                              className="mt-1"
                              type="date"
                              value={
                                full.due_date
                                  ? full.due_date.slice(0, 10)
                                  : ""
                              }
                              onChange={(e) =>
                                updateStepInDraft(full.id, {
                                  due_date: e.target.value
                                    ? `${e.target.value}T12:00:00.000Z`
                                    : null,
                                })
                              }
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>Summary</Label>
                            <Textarea
                              className="mt-1 min-h-[72px] border-slate-200"
                              value={full.description}
                              onChange={(e) =>
                                updateStepInDraft(full.id, { description: e.target.value })
                              }
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>Action needed now</Label>
                            <Textarea
                              className="mt-1 min-h-[56px] border-slate-200"
                              value={d.action_needed_now ?? ""}
                              onChange={(e) =>
                                updateStepDetails(full.id, {
                                  action_needed_now: e.target.value || undefined,
                                })
                              }
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>What to do (instructions)</Label>
                            <Textarea
                              className="mt-1 min-h-[80px] border-slate-200"
                              value={d.detailed_instructions ?? ""}
                              onChange={(e) =>
                                updateStepDetails(full.id, {
                                  detailed_instructions: e.target.value || undefined,
                                })
                              }
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>Checklist (one item per line)</Label>
                            <Textarea
                              className="mt-1 min-h-[72px] border-slate-200 font-mono text-xs"
                              value={checklistToText(d.checklist)}
                              onChange={(e) =>
                                updateStepDetails(full.id, {
                                  checklist: textToChecklist(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>Outcome notes</Label>
                            <Textarea
                              className="mt-1 min-h-[56px] border-slate-200"
                              value={
                                (full.workflow_data?.outcome_notes as string | undefined) ?? ""
                              }
                              onChange={(e) =>
                                updateStepInDraft(full.id, {
                                  workflow_data: {
                                    ...full.workflow_data,
                                    outcome_notes: e.target.value || null,
                                  },
                                })
                              }
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>Blocker reason</Label>
                            <Textarea
                              className="mt-1 min-h-[56px] border-slate-200"
                              value={
                                (full.workflow_data?.blocker_reason as string | undefined) ?? ""
                              }
                              onChange={(e) =>
                                updateStepInDraft(full.id, {
                                  workflow_data: {
                                    ...full.workflow_data,
                                    blocker_reason: e.target.value || null,
                                  },
                                })
                              }
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <details className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                                Advanced step content
                              </summary>
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                  <Label>Stage goal</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.stage_goal ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        stage_goal: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Rationale (why this matters)</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.rationale ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        rationale: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Why now</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.why_now ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        why_now: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Timing guidance</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.timing_guidance ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        timing_guidance: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Expected outcome</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.expected_outcome ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        expected_outcome: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Success marker</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.success_marker ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        success_marker: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Required documents (one per line)</Label>
                                  <Textarea
                                    className="mt-1 min-h-[72px] border-slate-200 font-mono text-xs"
                                    value={(d.required_documents ?? []).join("\n")}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        required_documents: textToNonEmptyLines(e.target.value),
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Contacts</Label>
                                  <div className="mt-2 space-y-2">
                                    {(d.contacts ?? []).map((c, idx) => (
                                      <div
                                        key={`${full.id}-contact-${idx}`}
                                        className="rounded-md border border-slate-200 bg-white p-2"
                                      >
                                        <div className="grid gap-2 sm:grid-cols-2">
                                          <div>
                                            <Label className="text-[11px]">Name</Label>
                                            <Input
                                              className="mt-1"
                                              value={c.name ?? ""}
                                              onChange={(e) => {
                                                const next = [...(d.contacts ?? [])];
                                                next[idx] = { ...next[idx], name: e.target.value };
                                                updateStepDetails(full.id, {
                                                  contacts: normalizeContactsForSave(next),
                                                });
                                              }}
                                            />
                                          </div>
                                          <div>
                                            <Label className="text-[11px]">Phone</Label>
                                            <Input
                                              className="mt-1"
                                              value={c.phone ?? ""}
                                              onChange={(e) => {
                                                const next = [...(d.contacts ?? [])];
                                                next[idx] = { ...next[idx], phone: e.target.value };
                                                updateStepDetails(full.id, {
                                                  contacts: normalizeContactsForSave(next),
                                                });
                                              }}
                                            />
                                          </div>
                                        </div>

                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                          <div>
                                            <Label className="text-[11px]">Email</Label>
                                            <Input
                                              className="mt-1"
                                              value={c.email ?? ""}
                                              onChange={(e) => {
                                                const next = [...(d.contacts ?? [])];
                                                next[idx] = { ...next[idx], email: e.target.value };
                                                updateStepDetails(full.id, {
                                                  contacts: normalizeContactsForSave(next),
                                                });
                                              }}
                                            />
                                          </div>
                                          <div>
                                            <Label className="text-[11px]">Notes</Label>
                                            <Input
                                              className="mt-1"
                                              value={c.notes ?? ""}
                                              onChange={(e) => {
                                                const next = [...(d.contacts ?? [])];
                                                next[idx] = { ...next[idx], notes: e.target.value };
                                                updateStepDetails(full.id, {
                                                  contacts: normalizeContactsForSave(next),
                                                });
                                              }}
                                            />
                                          </div>
                                        </div>

                                        <div className="mt-2 flex">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-8 px-2 text-xs text-slate-700"
                                            onClick={() => {
                                              const next = [...(d.contacts ?? [])].filter((_, j) => j !== idx);
                                              updateStepDetails(full.id, {
                                                contacts: normalizeContactsForSave(next),
                                              });
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </div>
                                    ))}

                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="h-8 border-slate-200"
                                      onClick={() => {
                                        const next = [
                                          ...(d.contacts ?? []),
                                          { name: "", phone: "", email: "", notes: "" },
                                        ];
                                        updateStepDetails(full.id, {
                                          contacts: normalizeContactsForSave(next),
                                        });
                                      }}
                                    >
                                      Add contact
                                    </Button>
                                  </div>
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Blockers (one per line)</Label>
                                  <Textarea
                                    className="mt-1 min-h-[72px] border-slate-200 font-mono text-xs"
                                    value={(d.blockers ?? []).join("\n")}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        blockers: textToNonEmptyLines(e.target.value),
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Fallback options (one per line)</Label>
                                  <Textarea
                                    className="mt-1 min-h-[72px] border-slate-200 font-mono text-xs"
                                    value={(d.fallback_options ?? []).join("\n")}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        fallback_options: textToNonEmptyLines(e.target.value),
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <Label>Contact script</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.contact_script ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        contact_script: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div>
                                  <Label>Depends on</Label>
                                  <Textarea
                                    className="mt-1 min-h-[56px] border-slate-200"
                                    value={d.depends_on ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        depends_on: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <Label>Milestone type</Label>
                                  <Input
                                    className="mt-1"
                                    value={d.milestone_type ?? ""}
                                    onChange={(e) =>
                                      updateStepDetails(full.id, {
                                        milestone_type: e.target.value || undefined,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            </details>
                          </div>
                        </div>

                        {(full.action_items ?? []).length > 0 ? (
                          <div className="space-y-2 border-t border-slate-200 pt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Weekly action items
                            </p>
                            {(full.action_items ?? []).map((ai) => (
                              <div
                                key={ai.id}
                                className="rounded-md border border-slate-200 bg-slate-50/80 p-2"
                              >
                                <Label className="text-[11px]">Title</Label>
                                <Input
                                  className="mt-1"
                                  value={ai.title}
                                  onChange={(e) =>
                                    updateActionItemInDraft(full.id, ai.id, {
                                      title: e.target.value,
                                    })
                                  }
                                />
                                <Label className="mt-2 block text-[11px]">Details</Label>
                                <Input
                                  className="mt-1"
                                  value={ai.description ?? ""}
                                  onChange={(e) =>
                                    updateActionItemInDraft(full.id, ai.id, {
                                      description: e.target.value || null,
                                    })
                                  }
                                />
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-[11px]">Week #</Label>
                                    <Input
                                      type="number"
                                      min={1}
                                      className="mt-1"
                                      value={ai.week_index}
                                      onChange={(e) =>
                                        updateActionItemInDraft(full.id, ai.id, {
                                          week_index: Number(e.target.value) || 1,
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-[11px]">Target date</Label>
                                    <Input
                                      type="date"
                                      className="mt-1"
                                      value={ai.target_date ? ai.target_date.slice(0, 10) : ""}
                                      onChange={(e) =>
                                        updateActionItemInDraft(full.id, ai.id, {
                                          target_date: e.target.value
                                            ? `${e.target.value}T12:00:00.000Z`
                                            : null,
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3 text-sm">
                        {(() => {
                          const actionNow =
                            d.action_needed_now?.trim() ||
                            full.ai_helper_data?.action_needed_now?.trim() ||
                            "";
                          return actionNow ? (
                            <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                                Action needed now
                              </p>
                              <p className="mt-1 text-sm font-semibold leading-relaxed text-blue-950">
                                {actionNow}
                              </p>
                            </div>
                          ) : null;
                        })()}

                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="text-sm font-semibold text-slate-900">{full.title}</h4>
                            {d.stage_goal?.trim() ? (
                              <p className="mt-1 text-xs text-slate-600">
                                <span className="font-semibold">Stage goal:</span> {d.stage_goal}
                              </p>
                            ) : null}
                            {d.depends_on?.trim() ? (
                              <p className="mt-1 text-xs text-slate-600">
                                <span className="font-semibold">Depends on:</span> {d.depends_on}
                              </p>
                            ) : null}
                          </div>
                          <div className="shrink-0 space-y-1 text-right">
                            <p className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                              Priority: {(full.priority ?? d.priority ?? "medium").replace("_", " ")}
                            </p>
                            {d.timing_guidance?.trim() ? (
                              <p className="text-[11px] text-slate-500">{d.timing_guidance}</p>
                            ) : null}
                          </div>
                        </div>

                        {full.description?.trim() ? (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Summary
                            </p>
                            <p className="mt-1 text-slate-700 leading-relaxed whitespace-pre-wrap">
                              {full.description}
                            </p>
                          </div>
                        ) : null}

                        {/* Detailed instructions moved into "More context" */}

                        {(barrierActionItems.length > 0 || (d.checklist ?? []).some((line) => line.trim().length > 0)) ? (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              Action items
                            </p>
                            <ul className="mt-2 space-y-2">
                              {(() => {
                                const { groups, orphans } = groupArtifactActionItems(
                                  barrierActionItems as DisplayWeeklyActionItem[],
                                );

                                return (
                                  <>
                                    {groups.map((group) => (
                                      <li
                                        key={group.parent.id}
                                        className="rounded-lg border border-slate-200 bg-white p-2 text-sm"
                                      >
                                        {onToggleActionItem ? (
                                          <label className="flex items-start gap-2">
                                            <input
                                              type="checkbox"
                                              className={`${checkboxClass} mt-0.5`}
                                              checked={group.parent.status === "completed"}
                                              disabled={actionToggleDisabled}
                                              onChange={(e) =>
                                                onToggleActionItem(
                                                  group.parent.id,
                                                  e.target.checked,
                                                )
                                              }
                                            />
                                            <span>
                                              <span className="font-medium text-slate-800">
                                                {group.parent.title}
                                              </span>
                                              {group.parent.dueDate ? (
                                                <span className="ml-2 text-xs text-slate-500">
                                                  Due {formatDue(group.parent.dueDate)}
                                                </span>
                                              ) : null}
                                            </span>
                                          </label>
                                        ) : (
                                          <>
                                            <span className="font-medium text-slate-800">
                                              {group.parent.title}
                                            </span>
                                            {group.parent.dueDate ? (
                                              <span className="ml-2 text-xs text-slate-500">
                                                Due {formatDue(group.parent.dueDate)}
                                              </span>
                                            ) : null}
                                          </>
                                        )}

                                        {group.artifacts.length > 0 ? (
                                          <ul className="mt-2 ml-4 list-disc pl-2 text-sm text-slate-700">
                                            {group.artifacts.map((a) => (
                                            <li key={a.id}>
                                              {a.title}
                                              {a.dueDate ? (
                                                <span className="text-xs text-slate-500">
                                                  {" "}
                                                  (Due {formatDue(a.dueDate)})
                                                </span>
                                              ) : null}
                                            </li>
                                            ))}
                                          </ul>
                                        ) : null}
                                      </li>
                                    ))}

                                    {orphans.length > 0 ? (
                                      <li className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                          Additional items
                                        </p>
                                        <ul className="mt-1 ml-4 list-disc pl-2 text-sm text-slate-700">
                                          {orphans.map((a) => (
                                            <li key={a.id}>{a.title}</li>
                                          ))}
                                        </ul>
                                      </li>
                                    ) : null}
                                  </>
                                );
                              })()}
                              {(d.checklist ?? []).map((line, i) => {
                                if (!line.trim()) return null;
                                const completed =
                                  full.workflow_data?.checklist_completed?.[i] ?? false;
                                return (
                                  <li
                                    key={`${full.id}-ck-${i}`}
                                    className="rounded-lg border border-slate-200 bg-white p-2"
                                  >
                                    <label className="flex items-start gap-2">
                                      <input
                                        type="checkbox"
                                        className={`${checkboxClass} mt-0.5`}
                                        checked={completed}
                                        disabled={pending}
                                        onChange={(e) =>
                                          onDetailChecklistToggle(full.id, i, e.target.checked)
                                        }
                                      />
                                      <span
                                        className={cn(
                                          "text-slate-800",
                                          completed && "text-slate-500 line-through",
                                        )}
                                      >
                                        {line.trim()}
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}

                        {/* Moved into "More context" for low-cognitive-load scanning */}

                        {d.expected_outcome?.trim() ? (
                          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                              Expected outcome
                            </p>
                            <p className="mt-1 text-sm text-emerald-950">{d.expected_outcome}</p>
                          </div>
                        ) : null}

                        <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
                            More context
                          </summary>
                          <div className="mt-2 space-y-2 text-slate-700">
                            {d.rationale?.trim() ? (
                              <p><span className="font-semibold">Rationale:</span> {d.rationale}</p>
                            ) : null}
                            {d.why_now?.trim() ? (
                              <p><span className="font-semibold">Why now:</span> {d.why_now}</p>
                            ) : null}
                            {d.detailed_instructions?.trim() ? (
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Guidance
                                </p>
                                <p className="mt-1 text-slate-700 leading-relaxed whitespace-pre-wrap">
                                  {d.detailed_instructions}
                                </p>
                              </div>
                            ) : null}

                            {(d.required_documents ?? []).length > 0 ? (
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Required documents
                                </p>
                                <ul className="mt-1 list-disc pl-5">
                                  {(d.required_documents ?? []).map((doc, i) =>
                                    doc.trim() ? <li key={`${full.id}-doc-${i}`}>{doc.trim()}</li> : null,
                                  )}
                                </ul>
                              </div>
                            ) : null}

                            {(d.contacts ?? []).length > 0 ? (
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Contacts
                                </p>
                                <ul className="mt-1 space-y-1">
                                  {(d.contacts ?? []).map((c, i) => {
                                    const name = c.name?.trim() || "Contact";
                                    const phone = c.phone?.trim();
                                    const email = c.email?.trim();
                                    const notes = c.notes?.trim();
                                    return (
                                      <li key={`${full.id}-contact-${i}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                                        <p className="font-medium text-slate-800">{name}</p>
                                        <div className="mt-0.5 flex flex-wrap gap-3 text-xs">
                                          {phone ? (
                                            <a className="text-blue-700 hover:underline" href={`tel:${phone}`}>
                                              {phone}
                                            </a>
                                          ) : null}
                                          {email ? (
                                            <a className="text-blue-700 hover:underline" href={`mailto:${email}`}>
                                              {email}
                                            </a>
                                          ) : null}
                                        </div>
                                        {notes ? <p className="mt-1 text-xs text-slate-600">{notes}</p> : null}
                                      </li>
                                    );
                                  })}
                                </ul>

                                {d.contact_script?.trim() ? (
                                  <div className="mt-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                      Contact script
                                    </p>
                                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                      {d.contact_script}
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {(full.workflow_data?.outcome_notes?.trim() ||
                              full.workflow_data?.blocker_reason?.trim()) ? (
                              <div className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2.5">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Case notes
                                </p>
                                {full.workflow_data?.outcome_notes?.trim() ? (
                                  <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                                    {full.workflow_data.outcome_notes}
                                  </p>
                                ) : null}
                                {full.workflow_data?.blocker_reason?.trim() ? (
                                  <p className="mt-1 text-sm text-amber-900">
                                    <span className="font-semibold">Blocked: </span>
                                    {full.workflow_data.blocker_reason}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}

                            {(d.blockers ?? []).some((b) => b.trim()) ? (
                              <div>
                                <p className="font-semibold">Blockers:</p>
                                <ul className="list-disc pl-5">
                                  {(d.blockers ?? []).map((b, i) =>
                                    b.trim() ? <li key={`${full.id}-blocker-${i}`}>{b.trim()}</li> : null,
                                  )}
                                </ul>
                              </div>
                            ) : null}
                            {(d.fallback_options ?? []).some((b) => b.trim()) ? (
                              <div>
                                <p className="font-semibold">Fallback options (if blocked):</p>
                                <ul className="list-disc pl-5">
                                  {(d.fallback_options ?? []).map((b, i) =>
                                    b.trim() ? <li key={`${full.id}-fallback-${i}`}>{b.trim()}</li> : null,
                                  )}
                                </ul>
                              </div>
                            ) : null}
                            {d.success_marker?.trim() ? (
                              <p><span className="font-semibold">Success marker:</span> {d.success_marker}</p>
                            ) : null}
                            {d.milestone_type?.trim() ? (
                              <p><span className="font-semibold">Milestone type:</span> {d.milestone_type}</p>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    )}
                    </article>
                  );
                })}
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

      {aiOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-step-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="ai-step-title" className="text-base font-semibold text-slate-900">
              Edit step with AI
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Describe the change you want for this step only. The assistant keeps facts and structure
              unless you ask otherwise.
            </p>
            <Textarea
              className="mt-3 min-h-[100px] border-slate-200"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="e.g. Make this more concrete for a family with no vehicle; keep the same programs."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={runAiPreview} disabled={aiPending}>
                {aiPending ? "Working…" : "Generate preview"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAiOpen(false);
                  setAiStepId(null);
                  setAiPreview(null);
                }}
              >
                Close
              </Button>
            </div>
            {aiPreview ? (
              <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-900">{aiPreview.title}</p>
                <p className="text-slate-700">{aiPreview.description}</p>
                {aiPreview.details.action_needed_now ? (
                  <p className="text-xs text-blue-900">
                    <span className="font-semibold">Action: </span>
                    {aiPreview.details.action_needed_now}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" onClick={applyAiToDraft}>
                    Apply to draft
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAiPreview(null)}
                  >
                    Discard preview
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
