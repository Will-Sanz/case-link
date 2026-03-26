"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewRefinePlanStep,
  previewRefinePlan,
  createManualStep,
  deletePlanStep,
  updatePlanStep,
  updatePlanStepActionItem,
} from "@/app/actions/plans";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { PlanPdfExport } from "@/features/families/plan-pdf-export";
import { PlanStepCaseNote } from "@/features/families/plan-step-case-note";
import type { BarrierWorkflowResult } from "@/types/barrier-workflow";
import type {
  PlanStepActionItemRow,
  PlanStepDetails,
  PlanStepRow,
  PlanWithSteps,
} from "@/types/family";
import { DEFAULT_AI_MODE } from "@/lib/ai/ai-mode";

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

function cloneStep(s: PlanStepRow): PlanStepRow {
  return structuredClone(s) as PlanStepRow;
}

/** Old plans stored `Plan v3 (AI: …)` in `summary`; never use that as the page title. */
const LEGACY_PLAN_VERSION_TITLE = /^plan v\d+\b/i;

function planPageTitle(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = c?.trim();
    if (t && !LEGACY_PLAN_VERSION_TITLE.test(t)) return t;
  }
  return "30 / 60 / 90 day plan";
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
  const stepSaveLockRef = useRef(false);
  const planBulkSaveLockRef = useRef(false);
  const [stepSaveBusy, setStepSaveBusy] = useState(false);
  const [planBulkSaving, setPlanBulkSaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState<PlanStepRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addStepPhase, setAddStepPhase] = useState<"30" | "60" | "90">("30");
  const [addStepTitle, setAddStepTitle] = useState("");
  const [addStepDescription, setAddStepDescription] = useState("");
  const [addStepDocuments, setAddStepDocuments] = useState("");
  const [addStepContact, setAddStepContact] = useState("");
  const [addStepExpectedOutcome, setAddStepExpectedOutcome] = useState("");
  const [addStepPending, setAddStepPending] = useState(false);
  const [deleteStepPendingId, setDeleteStepPendingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmDescription, setConfirmDescription] = useState("");
  const [confirmActionLabel, setConfirmActionLabel] = useState("Confirm");
  const [confirmDanger, setConfirmDanger] = useState(false);
  const confirmActionRef = useRef<null | (() => void)>(null);

  const [planAiDraft, setPlanAiDraft] = useState<PlanWithSteps | null>(null);

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

  const stepDirty = useMemo(() => {
    if (!editingStepId || !stepDraft || !plan) return false;
    const orig = plan.steps.find((s) => s.id === editingStepId);
    return stepNeedsPersist(orig, stepDraft);
  }, [editingStepId, stepDraft, plan]);

  useEffect(() => {
    if (!stepDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [stepDirty]);

  const stepsByPhase = useMemo(() => {
    const src = plan?.steps ?? [];
    const grouped: Record<"30" | "60" | "90", PlanStepRow[]> = {
      "30": [],
      "60": [],
      "90": [],
    };
    for (const s of [...src].sort((a, b) => a.sort_order - b.sort_order)) {
      grouped[s.phase].push(s);
    }
    return grouped;
  }, [plan]);

  function stepRowForDisplay(stepId: string, row: PlanStepRow): PlanStepRow {
    if (editingStepId === stepId && stepDraft && stepDraft.id === stepId) {
      return stepDraft;
    }
    return row;
  }

  function closeConfirmDialog() {
    if (pending || stepSaveBusy || addStepPending || Boolean(deleteStepPendingId)) return;
    setConfirmOpen(false);
    confirmActionRef.current = null;
  }

  function requestConfirmation(opts: {
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  }) {
    setConfirmTitle(opts.title);
    setConfirmDescription(opts.description);
    setConfirmActionLabel(opts.confirmLabel);
    setConfirmDanger(Boolean(opts.danger));
    confirmActionRef.current = opts.onConfirm;
    setConfirmOpen(true);
  }

  function confirmAndRun() {
    const fn = confirmActionRef.current;
    setConfirmOpen(false);
    confirmActionRef.current = null;
    fn?.();
  }

  function switchToStepEdit(stepId: string): boolean {
    if (!plan) return false;
    if (editingStepId === stepId) return true;
    const s = plan.steps.find((x) => x.id === stepId);
    if (!s) return false;
    setEditingStepId(stepId);
    setStepDraft(cloneStep(s));
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
    setError(null);
    setSuccess(null);
    return true;
  }

  function beginStepEdit(stepId: string) {
    if (editingStepId === stepId) return;
    if (editingStepId && stepDirty) {
      requestConfirmation({
        title: "Discard unsaved edits?",
        description: "You have unsaved edits on the current step. Discard them and edit another step?",
        confirmLabel: "Discard and continue",
        onConfirm: () => {
          switchToStepEdit(stepId);
        },
      });
      return;
    }
    switchToStepEdit(stepId);
  }

  function cancelStepEdit() {
    setEditingStepId(null);
    setStepDraft(null);
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
    setError(null);
  }

  function patchEditingStep(patch: Partial<PlanStepRow>) {
    setStepDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function patchEditingStepDetails(patch: Partial<PlanStepDetails>) {
    setStepDraft((prev) => {
      if (!prev) return prev;
      const d = (prev.details ?? {}) as PlanStepDetails;
      return { ...prev, details: { ...d, ...patch } };
    });
  }

  async function persistOneStep(orig: PlanStepRow | undefined, s: PlanStepRow): Promise<boolean> {
    if (!stepNeedsPersist(orig, s)) return true;
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
      return false;
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
        return false;
      }
    }
    return true;
  }

  function saveStepEdit() {
    if (!plan || !editingStepId || !stepDraft) return;
    if (stepSaveLockRef.current) return;
    const orig = plan.steps.find((s) => s.id === editingStepId);
    if (!stepNeedsPersist(orig, stepDraft)) {
      cancelStepEdit();
      return;
    }
    stepSaveLockRef.current = true;
    setStepSaveBusy(true);
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const ok = await persistOneStep(orig, stepDraft);
        if (!ok) return;
        setSuccess("Step saved.");
        setEditingStepId(null);
        setStepDraft(null);
        setAiStepId(null);
        setAiPreview(null);
        setAiInstruction("");
        router.refresh();
      } finally {
        stepSaveLockRef.current = false;
        setStepSaveBusy(false);
      }
    });
  }

  function runDeleteStep(stepId: string) {
    if (!plan) return;
    if (deleteStepPendingId) return;

    setDeleteStepPendingId(stepId);
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await deletePlanStep({ stepId, familyId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (editingStepId === stepId) {
          setEditingStepId(null);
          setStepDraft(null);
          setAiStepId(null);
          setAiPreview(null);
          setAiInstruction("");
        }
        setSuccess("Step deleted.");
        router.refresh();
      } finally {
        setDeleteStepPendingId(null);
      }
    });
  }

  function removeStep(stepId: string) {
    requestConfirmation({
      title: "Delete step?",
      description: "This will permanently remove the step from the plan.",
      confirmLabel: "Delete step",
      danger: true,
      onConfirm: () => runDeleteStep(stepId),
    });
  }

  function createStepAtBottom(forceDiscard = false) {
    if (!plan) return;
    if (addStepPending) return;
    const title = addStepTitle.trim();
    if (!title) {
      setError("Step title is required.");
      return;
    }
    if (editingStepId && stepDirty && !forceDiscard) {
      requestConfirmation({
        title: "Discard unsaved edits?",
        description: "You have unsaved step edits. Discard them and add a new step?",
        confirmLabel: "Discard and add step",
        onConfirm: () => createStepAtBottom(true),
      });
      return;
    }
    if (forceDiscard) {
      cancelStepEdit();
    }
    setAddStepPending(true);
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const requiredDocuments = addStepDocuments
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const contactLines = addStepContact
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const details: PlanStepDetails = {};
        if (requiredDocuments.length > 0) {
          details.required_documents = requiredDocuments;
        }
        if (contactLines.length > 0) {
          details.contacts = contactLines.map((line) => ({ notes: line }));
        }
        const expectedOutcome = addStepExpectedOutcome.trim();
        if (expectedOutcome) {
          details.expected_outcome = expectedOutcome;
        }

        const res = await createManualStep({
          familyId,
          planId: plan.id,
          phase: addStepPhase,
          title,
          description: addStepDescription.trim(),
          details: Object.keys(details).length > 0 ? details : undefined,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setAddStepTitle("");
        setAddStepDescription("");
        setAddStepDocuments("");
        setAddStepContact("");
        setAddStepExpectedOutcome("");
        setSuccess(`Step added to ${addStepPhase}-day plan.`);
        router.refresh();
      } finally {
        setAddStepPending(false);
      }
    });
  }

  function openAiForStep(stepId: string) {
    if (!plan) return;
    if (editingStepId !== stepId && editingStepId && stepDirty) {
      requestConfirmation({
        title: "Discard unsaved edits?",
        description: "You have unsaved step edits on another step. Discard them and continue?",
        confirmLabel: "Discard and continue",
        onConfirm: () => {
          if (!switchToStepEdit(stepId)) return;
          setAiStepId(stepId);
          setAiInstruction("");
          setAiPreview(null);
          setError(null);
        },
      });
      return;
    }
    if (editingStepId !== stepId && !switchToStepEdit(stepId)) return;
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
    previewRefinePlanStep({
      stepId: aiStepId,
      familyId,
      feedback: instr,
      aiMode: DEFAULT_AI_MODE,
    }).then((res) => {
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
    if (!aiPreview || !aiStepId || !stepDraft || stepDraft.id !== aiStepId) return;
    const checklistLen = (aiPreview.details.checklist ?? []).length;
    setStepDraft((prev) => {
      if (!prev || prev.id !== aiStepId) return prev;
      const wd = { ...(prev.workflow_data ?? {}) };
      wd.checklist_completed = Array(checklistLen).fill(false);
      return {
        ...prev,
        title: aiPreview.title,
        description: aiPreview.description,
        details: aiPreview.details,
        priority: aiPreview.stepPriority ?? prev.priority,
        workflow_data: wd,
      };
    });
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
  }

  function openPlanAiRefine(forceDiscard = false) {
    if (!plan) return;
    if (editingStepId && stepDirty && !forceDiscard) {
      requestConfirmation({
        title: "Discard unsaved edits?",
        description: "Discard unsaved step edits to refine the full plan?",
        confirmLabel: "Discard and continue",
        onConfirm: () => openPlanAiRefine(true),
      });
      return;
    }
    if (editingStepId) {
      cancelStepEdit();
    }
    setPlanAiInstruction("");
    setPlanAiPreview(null);
    setPlanAiDraft(clonePlan(plan));
    setPlanAiOpen(true);
    setError(null);
  }

  function runPlanAiPreview() {
    const instr = planAiInstruction.trim();
    if (!instr) {
      setError("Describe what you want to change for the full plan.");
      return;
    }
    if (!planAiDraft) return;

    setPlanAiPending(true);
    setError(null);

    const draftForApi = {
      steps: planAiDraft.steps.map((s) => ({
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

    previewRefinePlan({
      familyId,
      feedback: instr,
      draft: draftForApi,
      aiMode: DEFAULT_AI_MODE,
    }).then((res) => {
      setPlanAiPending(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlanAiPreview({ model: res.model, steps: res.steps });
    });
  }

  function applyPlanAiToDraft() {
    if (!planAiPreview || !planAiDraft) return;

    const previewSteps = planAiPreview.steps;
    const baseSteps = planAiDraft.steps;

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

    setPlanAiDraft((prev) => {
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
            const aiPreviewRow = aiStep.action_items[j];
            if (!aiPreviewRow) return ai;
            return {
              ...ai,
              title: aiPreviewRow.title,
              description: aiPreviewRow.description ?? null,
              week_index: aiPreviewRow.week_index,
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

    setPlanAiPreview(null);
    setPlanAiInstruction("");
  }

  function savePlanAiRefinements() {
    if (!planAiDraft || !plan) return;
    if (planBulkSaveLockRef.current) return;
    planBulkSaveLockRef.current = true;
    setPlanBulkSaving(true);
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        for (const s of planAiDraft.steps) {
          const orig = plan.steps.find((x) => x.id === s.id);
          const ok = await persistOneStep(orig, s);
          if (!ok) return;
        }
        setSuccess("Plan updates saved.");
        setPlanAiOpen(false);
        setPlanAiPreview(null);
        setPlanAiInstruction("");
        setPlanAiDraft(null);
        router.refresh();
      } finally {
        planBulkSaveLockRef.current = false;
        setPlanBulkSaving(false);
      }
    });
  }

  const planAiDirty = useMemo(() => {
    if (!planAiDraft || !plan) return false;
    for (const s of planAiDraft.steps) {
      const o = plan.steps.find((x) => x.id === s.id);
      if (stepNeedsPersist(o, s)) return true;
    }
    return false;
  }, [planAiDraft, plan]);

  if (!workflow) {
    return (
      <p className="text-sm text-slate-600">
        Generate a plan from the Overview tab to see your 30 / 60 / 90 day roadmap here.
      </p>
    );
  }

  const displayTitle = planPageTitle(
    workflow.planDisplayTitle,
    plan?.client_display?.title,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">{displayTitle}</CardTitle>
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
          {plan && workflow ? (
            <PlanPdfExport plan={plan} familyName={familyName} workflow={workflow} />
          ) : null}
          {plan ? (
            <Button
              type="button"
              onClick={() => openPlanAiRefine()}
              variant="secondary"
              className="border-slate-200"
              disabled={planAiPending}
            >
              {planAiPending ? "Refining…" : "Refine plan with AI"}
            </Button>
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

      {plan?.generation_state?.status === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {plan.generation_state.error ??
            "Later phases could not be generated. You can edit the saved steps or regenerate from Overview."}
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
              <p className="text-sm leading-relaxed text-slate-600">{section.summary}</p>
              <div className="mt-4 space-y-8">
                {stepsByPhase[section.phase].map((full) => {
                  const display = stepRowForDisplay(full.id, full);
                  const isEditingThis = editingStepId === full.id;
                  return (
                  <PlanStepCaseNote
                    key={full.id}
                    step={display}
                    editing={isEditingThis}
                    onPatchStep={(patch) => {
                      if (editingStepId === full.id) patchEditingStep(patch);
                    }}
                    onPatchDetails={(patch) => {
                      if (editingStepId === full.id) patchEditingStepDetails(patch);
                    }}
                    onPatchWorkflow={
                      isEditingThis
                        ? (next) =>
                            patchEditingStep({
                              workflow_data: next,
                            })
                        : undefined
                    }
                    onBeginEdit={() => beginStepEdit(full.id)}
                    onSaveEdits={saveStepEdit}
                    onCancelEdits={cancelStepEdit}
                    onDeleteStep={() => removeStep(full.id)}
                    stepSavePending={(stepSaveBusy || pending) && isEditingThis}
                    stepDirty={isEditingThis && stepDirty}
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
                  );
                })}
              </div>
            </section>
          ))}
          {plan ? (
            <section className="max-w-[800px] space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Add step</h3>
              <p className="text-xs text-slate-500">
                Add a manual step to the end of the selected phase.
              </p>
              <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                <label className="space-y-1 text-xs text-slate-600">
                  <span>Phase</span>
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm"
                    value={addStepPhase}
                    onChange={(e) => setAddStepPhase(e.target.value as "30" | "60" | "90")}
                    disabled={addStepPending}
                  >
                    <option value="30">30-day</option>
                    <option value="60">60-day</option>
                    <option value="90">90-day</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-slate-600">
                  <span>Step title</span>
                  <input
                    type="text"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    value={addStepTitle}
                    onChange={(e) => setAddStepTitle(e.target.value)}
                    placeholder="e.g. Confirm documentation with utility provider"
                    disabled={addStepPending}
                  />
                </label>
              </div>
              <label className="space-y-1 text-xs text-slate-600">
                <span>Summary</span>
                <Textarea
                  className="min-h-[90px] border-slate-200"
                  value={addStepDescription}
                  onChange={(e) => setAddStepDescription(e.target.value)}
                  placeholder="Add the step summary for case managers."
                  disabled={addStepPending}
                />
              </label>
              <label className="space-y-1 text-xs text-slate-600">
                <span>Documents</span>
                <Textarea
                  className="min-h-[90px] border-slate-200"
                  value={addStepDocuments}
                  onChange={(e) => setAddStepDocuments(e.target.value)}
                  placeholder="One required document per line."
                  disabled={addStepPending}
                />
              </label>
              <label className="space-y-1 text-xs text-slate-600">
                <span>Contact</span>
                <Textarea
                  className="min-h-[90px] border-slate-200"
                  value={addStepContact}
                  onChange={(e) => setAddStepContact(e.target.value)}
                  placeholder="One contact detail per line."
                  disabled={addStepPending}
                />
              </label>
              <label className="space-y-1 text-xs text-slate-600">
                <span>Expected outcome</span>
                <Textarea
                  className="min-h-[90px] border-slate-200"
                  value={addStepExpectedOutcome}
                  onChange={(e) => setAddStepExpectedOutcome(e.target.value)}
                  placeholder="Describe the desired result for this step."
                  disabled={addStepPending}
                />
              </label>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => createStepAtBottom()}
                  disabled={addStepPending || addStepTitle.trim().length === 0}
                >
                  {addStepPending ? "Adding…" : "Add step"}
                </Button>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:z-0 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:overscroll-y-contain lg:self-start">
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
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {(r.programName || r.name).trim()}
                    </p>
                    {r.name.trim() && r.name.trim() !== (r.programName || r.name).trim() ? (
                      <p className="mt-0.5 text-xs text-slate-500">{r.name}</p>
                    ) : r.description?.trim() &&
                      r.description.trim() !== (r.programName || r.name).trim() ? (
                      <p className="mt-0.5 text-xs text-slate-500">{r.description}</p>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-1">
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
              Preview updates a working copy of this plan. After you apply a preview, use{" "}
              <strong>Save to plan</strong> to write only the steps that changed to the database.
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
                onClick={() => runPlanAiPreview()}
                disabled={planAiPending || !planAiDraft}
              >
                {planAiPending ? "Generating…" : "Generate preview"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (planAiDirty) {
                    requestConfirmation({
                      title: "Discard unsaved plan changes?",
                      description: "You have unsaved changes in the working copy. Close and discard them?",
                      confirmLabel: "Discard changes",
                      onConfirm: () => {
                        setPlanAiOpen(false);
                        setPlanAiPreview(null);
                        setPlanAiInstruction("");
                        setPlanAiDraft(null);
                      },
                    });
                    return;
                  }
                  setPlanAiOpen(false);
                  setPlanAiPreview(null);
                  setPlanAiInstruction("");
                  setPlanAiDraft(null);
                }}
              >
                Close
              </Button>
            </div>

            {planAiPreview ? (
              <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-sm font-semibold text-slate-900">
                  Preview ready ({planAiPreview.steps.length} steps)
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
                    Apply to working copy
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

            {planAiDirty ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200/80 bg-blue-50/40 px-3 py-2.5">
                <p className="text-xs text-slate-700">
                  Working copy differs from the saved plan. Save to persist updated steps.
                </p>
                <Button
                  type="button"
                  onClick={savePlanAiRefinements}
                  disabled={planBulkSaving || pending || planAiPending}
                >
                  {planBulkSaving || pending ? "Saving…" : "Save to plan"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onClose={closeConfirmDialog}
        onConfirm={confirmAndRun}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmActionLabel}
        pending={pending || stepSaveBusy || addStepPending || Boolean(deleteStepPendingId)}
        danger={confirmDanger}
      />
    </div>
  );
}
