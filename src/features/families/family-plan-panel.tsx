"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert } from "lucide-react";
import {
  markPlanReviewed,
  previewRefinePlanStep,
  previewRefinePlan,
  createManualStep,
  deletePlanStep,
  updatePlanStep,
  updatePlanStepActionItem,
  type PlanEditConflict,
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
import { groupPlanStepsByGoal } from "@/lib/domain/plan/group-plan-steps";
import { actionUserNotes } from "@/lib/domain/plan/action-state";
import { getPlanReviewStatus } from "@/lib/domain/plan/review-status";
import {
  localActionDraftKey,
  parseLocalActionDraft,
  serializeLocalActionDraft,
  type LocalActionDraft,
} from "@/lib/domain/plan/local-action-draft";

function dateInputValueAfterDays(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() + days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTargetDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(parsed);
}

function workflowStatusLabel(value: string | null | undefined): string {
  if (!value) return "Not set";
  if (value === "in_progress") return "Started";
  if (value === "blocked") return "Waiting";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ownerDisplay(value: PlanStepDetails["owner"]): string {
  if (value === "family") return "Family";
  if (value === "school_program") return "School / program";
  if (value === "shared") return "Shared";
  return "Case manager";
}

type ConflictComparisonRow = { label: string; mine: string; latest: string };

function listDisplay(values: string[] | undefined): string {
  return (values ?? []).map((value) => value.trim()).filter(Boolean).join("; ") || "Not set";
}

function contactDisplay(details: PlanStepDetails): string {
  return (
    (details.contacts ?? [])
      .map((contact) =>
        [contact.name, contact.phone, contact.email, contact.notes]
          .map((value) => value?.trim())
          .filter(Boolean)
          .join(" · "),
      )
      .filter(Boolean)
      .join("; ") || "Not set"
  );
}

function conflictComparisonRows(
  conflict: PlanEditConflict,
  draft: PlanStepRow | null,
): ConflictComparisonRow[] {
  if (!draft) return [];

  let rows: ConflictComparisonRow[];
  if (conflict.kind === "step") {
    const mineDetails = (draft.details ?? {}) as PlanStepDetails;
    const latestDetails = conflict.current.details ?? {};
    rows = [
      { label: "Title", mine: draft.title, latest: conflict.current.title },
      { label: "Summary", mine: draft.description, latest: conflict.current.description },
      {
        label: "Status",
        mine: workflowStatusLabel(draft.status),
        latest: workflowStatusLabel(conflict.current.status),
      },
      {
        label: "Owner",
        mine: ownerDisplay(mineDetails.owner),
        latest: ownerDisplay(latestDetails.owner),
      },
      {
        label: "Priority",
        mine: workflowStatusLabel(draft.priority ?? mineDetails.priority),
        latest: workflowStatusLabel(conflict.current.priority ?? latestDetails.priority),
      },
      {
        label: "Goal",
        mine: mineDetails.stage_goal?.trim() || "Not set",
        latest: latestDetails.stage_goal?.trim() || "Not set",
      },
      {
        label: "Next task",
        mine: mineDetails.action_needed_now?.trim() || "Not set",
        latest: latestDetails.action_needed_now?.trim() || "Not set",
      },
      {
        label: "Expected result",
        mine: mineDetails.expected_outcome?.trim() || "Not set",
        latest: latestDetails.expected_outcome?.trim() || "Not set",
      },
      {
        label: "Documents",
        mine: listDisplay(mineDetails.required_documents ?? mineDetails.materials_needed),
        latest: listDisplay(
          latestDetails.required_documents ?? latestDetails.materials_needed,
        ),
      },
      {
        label: "Contact",
        mine: contactDisplay(mineDetails),
        latest: contactDisplay(latestDetails),
      },
      {
        label: "Case notes",
        mine: draft.workflow_data?.outcome_notes?.trim() || "Not set",
        latest: conflict.current.workflow_data?.outcome_notes?.trim() || "Not set",
      },
      {
        label: "Waiting reason",
        mine: draft.workflow_data?.blocker_reason?.trim() || "Not set",
        latest: conflict.current.workflow_data?.blocker_reason?.trim() || "Not set",
      },
    ];
  } else {
    const mine = (draft.action_items ?? []).find((action) => action.id === conflict.entityId);
    if (!mine) return [];
    rows = [
      { label: "Action", mine: mine.title, latest: conflict.current.title },
      {
        label: "Target date",
        mine: formatTargetDate(mine.target_date) ?? "Not set",
        latest: formatTargetDate(conflict.current.target_date) ?? "Not set",
      },
      {
        label: "Status",
        mine: workflowStatusLabel(mine.status),
        latest: workflowStatusLabel(conflict.current.status),
      },
      {
        label: "Outcome",
        mine: mine.outcome?.trim() || "Not set",
        latest: conflict.current.outcome?.trim() || "Not set",
      },
      {
        label: "Notes",
        mine: actionUserNotes(mine.notes).trim() || "Not set",
        latest: actionUserNotes(conflict.current.notes).trim() || "Not set",
      },
      {
        label: "Follow-up",
        mine: formatTargetDate(mine.follow_up_date) ?? "Not set",
        latest: formatTargetDate(conflict.current.follow_up_date) ?? "Not set",
      },
    ];
  }

  return rows.filter((row) => row.mine !== row.latest);
}

function normalizeChecklistForSave(lines: string[] | undefined): string[] {
  return (lines ?? []).map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Snapshot of the parent plan-step record (excludes independently saved task rows). */
function normalizeStepRecordForPersistCompare(step: PlanStepRow): string {
  const d = { ...(step.details as PlanStepDetails | null | undefined) } as PlanStepDetails;
  d.owner ??= "case_manager";
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

/** Snapshot of everything edited in one action card, for dirty detection only. */
function normalizeStepForPersistCompare(step: PlanStepRow): string {
  return JSON.stringify({
    step: normalizeStepRecordForPersistCompare(step),
    action_items: (step.action_items ?? []).map((action) => ({
      id: action.id,
      title: action.title,
      description: action.description,
      week_index: action.week_index,
      target_date: action.target_date,
      status: action.status,
      outcome: action.outcome,
      notes: action.notes,
      follow_up_date: action.follow_up_date,
    })),
  });
}

function stepNeedsPersist(orig: PlanStepRow | undefined, next: PlanStepRow): boolean {
  if (!orig) return true;
  return normalizeStepForPersistCompare(orig) !== normalizeStepForPersistCompare(next);
}

function stepRecordNeedsPersist(orig: PlanStepRow | undefined, next: PlanStepRow): boolean {
  if (!orig) return true;
  return normalizeStepRecordForPersistCompare(orig) !== normalizeStepRecordForPersistCompare(next);
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
  return "Family support plan";
}

export function FamilyPlanPanel({
  familyId,
  familyName,
  plan,
  workflow,
  onToggleActionItem,
  actionToggleDisabled,
  onRetryResources,
  resourceRetrying,
  onContinueDraft,
  continueDraftPending,
}: {
  familyId: string;
  familyName: string;
  plan: PlanWithSteps | null;
  workflow: BarrierWorkflowResult | null;
  onToggleActionItem?: (actionItemId: string, done: boolean, expectedUpdatedAt: string) => void;
  actionToggleDisabled?: boolean;
  onRetryResources?: () => void;
  resourceRetrying?: boolean;
  onContinueDraft?: () => void;
  continueDraftPending?: boolean;
}) {
  const router = useRouter();
  const stepSaveLockRef = useRef(false);
  const planBulkSaveLockRef = useRef(false);
  const [stepSaveBusy, setStepSaveBusy] = useState(false);
  const [planBulkSaving, setPlanBulkSaving] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [pending, startTransition] = useTransition();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState<PlanStepRow | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<LocalActionDraft | null>(null);
  const draftRecoveryLoadedPlanIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState<PlanEditConflict | null>(null);
  const [conflictResolution, setConflictResolution] = useState<"keep_draft" | null>(null);
  const [addStepGoal, setAddStepGoal] = useState("");
  const [addStepTitle, setAddStepTitle] = useState("");
  const [addStepTargetDate, setAddStepTargetDate] = useState(() => dateInputValueAfterDays(7));
  const [addStepDescription, setAddStepDescription] = useState("");
  const [addStepDocuments, setAddStepDocuments] = useState("");
  const [addStepContact, setAddStepContact] = useState("");
  const [addStepExpectedOutcome, setAddStepExpectedOutcome] = useState("");
  const [addStepOwner, setAddStepOwner] = useState<NonNullable<PlanStepDetails["owner"]>>(
    "case_manager",
  );
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
  const planAiDialogRef = useRef<HTMLDialogElement>(null);
  const [planAiDiscardConfirm, setPlanAiDiscardConfirm] = useState(false);
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

  const editConflictRows = useMemo(
    () => (editConflict ? conflictComparisonRows(editConflict, stepDraft) : []),
    [editConflict, stepDraft],
  );

  const actionDraftStorageKey = plan ? localActionDraftKey(plan.id) : null;

  useEffect(() => {
    if (!plan || !actionDraftStorageKey || draftRecoveryLoadedPlanIdRef.current === plan.id) {
      return;
    }
    draftRecoveryLoadedPlanIdRef.current = plan.id;
    const stored = parseLocalActionDraft(window.localStorage.getItem(actionDraftStorageKey));
    if (!stored || stored.planId !== plan.id) {
      window.localStorage.removeItem(actionDraftStorageKey);
      return;
    }
    if (!plan.steps.some((step) => step.id === stored.step.id)) {
      window.localStorage.removeItem(actionDraftStorageKey);
      return;
    }
    setRecoverableDraft(stored);
  }, [actionDraftStorageKey, plan]);

  useEffect(() => {
    if (conflictResolution !== "keep_draft" || !editConflict || !plan) return;
    const latestTimestamp =
      editConflict.kind === "step"
        ? plan.steps.find((step) => step.id === editConflict.entityId)?.updated_at
        : plan.steps
            .flatMap((step) => step.action_items ?? [])
            .find((action) => action.id === editConflict.entityId)?.updated_at;
    if (latestTimestamp !== editConflict.currentUpdatedAt) return;

    setEditConflict(null);
    setConflictResolution(null);
    setSuccess("The latest version is loaded and your draft is still open. Review it, then save again.");
  }, [conflictResolution, editConflict, plan]);

  useEffect(() => {
    if (!actionDraftStorageKey || !stepDirty || !stepDraft || !plan) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          actionDraftStorageKey,
          serializeLocalActionDraft(plan.id, stepDraft),
        );
      } catch {
        // The in-memory draft remains available when browser storage is unavailable.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [actionDraftStorageKey, plan, stepDirty, stepDraft]);

  useEffect(() => {
    if (!stepDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [stepDirty]);

  const goalGroups = useMemo(() => {
    return groupPlanStepsByGoal(plan?.steps ?? []);
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

  function clearLocalActionDraft() {
    if (actionDraftStorageKey) window.localStorage.removeItem(actionDraftStorageKey);
    setRecoverableDraft(null);
  }

  function restoreLocalActionDraft() {
    if (!recoverableDraft || !plan) return;
    if (!plan.steps.some((step) => step.id === recoverableDraft.step.id)) {
      clearLocalActionDraft();
      return;
    }
    setEditingStepId(recoverableDraft.step.id);
    setStepDraft(cloneStep(recoverableDraft.step));
    setRecoverableDraft(null);
    setError(null);
    setSuccess("Unsaved action edit restored. Review it before saving.");
  }

  function switchToStepEdit(stepId: string): boolean {
    if (!plan) return false;
    if (editingStepId === stepId) return true;
    const s = plan.steps.find((x) => x.id === stepId);
    if (!s) return false;
    clearLocalActionDraft();
    setEditingStepId(stepId);
    setStepDraft(cloneStep(s));
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
    setEditConflict(null);
    setConflictResolution(null);
    setError(null);
    setSuccess(null);
    return true;
  }

  function beginStepEdit(stepId: string) {
    if (editingStepId === stepId) return;
    if (editingStepId && stepDirty) {
      requestConfirmation({
        title: "Discard unsaved edits?",
        description: "You have unsaved edits on the current action. Discard them and edit another action?",
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
    clearLocalActionDraft();
    setEditingStepId(null);
    setStepDraft(null);
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
    setEditConflict(null);
    setConflictResolution(null);
    setError(null);
  }

  function keepConflictDraft() {
    if (!editConflict || conflictResolution) return;
    setConflictResolution("keep_draft");
    setError(null);
    router.refresh();
  }

  function useLatestConflictVersion() {
    clearLocalActionDraft();
    setEditingStepId(null);
    setStepDraft(null);
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
    setEditConflict(null);
    setConflictResolution(null);
    setError(null);
    setSuccess("Latest saved version loaded. Your older draft was not applied.");
    router.refresh();
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

  function patchEditingActionItem(
    actionItemId: string,
    patch: Partial<PlanStepActionItemRow>,
  ) {
    setStepDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        action_items: (prev.action_items ?? []).map((action) =>
          action.id === actionItemId ? { ...action, ...patch } : action,
        ),
      };
    });
  }

  async function persistOneStep(orig: PlanStepRow | undefined, s: PlanStepRow): Promise<boolean> {
    if (!stepNeedsPersist(orig, s)) return true;
    const untitledAction = (s.action_items ?? []).find((action) => !action.title.trim());
    if (untitledAction) {
      setError("Every action needs a short title before saving.");
      return false;
    }
    const unscheduledAction = (s.action_items ?? []).find(
      (action) => action.status !== "completed" && !action.target_date,
    );
    if (unscheduledAction) {
      setError(`Choose a target date for “${unscheduledAction.title}” before saving.`);
      return false;
    }
    const incompleteWaitingAction = (s.action_items ?? []).find(
      (action) =>
        action.status === "blocked" &&
        (!actionUserNotes(action.notes).trim() || !action.follow_up_date),
    );
    if (incompleteWaitingAction) {
      setError(
        `Add a waiting reason and next follow-up date for “${incompleteWaitingAction.title}”.`,
      );
      return false;
    }
    const d = { ...(s.details as PlanStepDetails | null | undefined) } as PlanStepDetails;
    d.owner ??= "case_manager";
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

    if (stepRecordNeedsPersist(orig, s)) {
      const stepRes = await updatePlanStep({
        stepId: s.id,
        familyId,
        expectedUpdatedAt: orig?.updated_at,
        title: s.title,
        description: s.description,
        status: s.status,
        phase: s.phase,
        priority: (s.priority ?? undefined) as "low" | "medium" | "high" | "urgent" | undefined,
        details: Object.keys(d).length > 0 ? d : undefined,
        workflow_data: wd,
      });
      if (!stepRes.ok) {
        if (stepRes.conflict) {
          setEditConflict(stepRes.conflict);
          setConflictResolution(null);
          setError(null);
          return false;
        }
        setError(stepRes.error);
        return false;
      }
    }

    for (const ai of s.action_items ?? []) {
      const oai = orig?.action_items?.find((x) => x.id === ai.id);
      const aiChanged =
        !oai ||
        oai.title !== ai.title ||
        (oai.description ?? "") !== (ai.description ?? "") ||
        oai.week_index !== ai.week_index ||
        oai.target_date !== ai.target_date ||
        oai.status !== ai.status ||
        oai.outcome !== ai.outcome ||
        oai.notes !== ai.notes ||
        oai.follow_up_date !== ai.follow_up_date;
      if (!aiChanged) continue;
      const ar = await updatePlanStepActionItem({
        actionItemId: ai.id,
        familyId,
        expectedUpdatedAt: oai?.updated_at,
        title: ai.title,
        description: ai.description,
        week_index: ai.week_index,
        target_date: ai.target_date,
        status: ai.status,
        outcome: ai.outcome,
        notes: ai.notes,
        follow_up_date: ai.follow_up_date,
      });
      if (!ar.ok) {
        if (ar.conflict) {
          setEditConflict(ar.conflict);
          setConflictResolution(null);
          setError(null);
          return false;
        }
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
    const missingTarget = (stepDraft.action_items ?? []).find(
      (action) => action.status !== "completed" && !action.target_date,
    );
    if (missingTarget) {
      setError(`Choose a target date for “${missingTarget.title}” before saving.`);
      return;
    }
    const incompleteWaitingAction = (stepDraft.action_items ?? []).find(
      (action) =>
        action.status === "blocked" &&
        (!actionUserNotes(action.notes).trim() || !action.follow_up_date),
    );
    if (incompleteWaitingAction) {
      setError(
        `Add a waiting reason and next follow-up date for “${incompleteWaitingAction.title}”.`,
      );
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
        setSuccess("Action saved.");
        setEditConflict(null);
        setConflictResolution(null);
        clearLocalActionDraft();
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
          clearLocalActionDraft();
          setEditingStepId(null);
          setStepDraft(null);
          setAiStepId(null);
          setAiPreview(null);
          setAiInstruction("");
        }
        setSuccess("Action removed from the plan.");
        router.refresh();
      } finally {
        setDeleteStepPendingId(null);
      }
    });
  }

  function removeStep(stepId: string) {
    requestConfirmation({
      title: "Remove this action?",
      description: "This action will be removed from the current plan and the change will be recorded.",
      confirmLabel: "Remove action",
      danger: true,
      onConfirm: () => runDeleteStep(stepId),
    });
  }

  function createStepAtBottom(forceDiscard = false) {
    if (!plan) return;
    if (addStepPending) return;
    const title = addStepTitle.trim();
    const goal = addStepGoal.trim();
    if (!goal) {
      setError("Goal is required.");
      return;
    }
    if (!title) {
      setError("Action title is required.");
      return;
    }
    if (!addStepTargetDate) {
      setError("Target date is required.");
      return;
    }
    const expectedOutcome = addStepExpectedOutcome.trim();
    if (!expectedOutcome) {
      setError("Expected result is required.");
      return;
    }
    if (editingStepId && stepDirty && !forceDiscard) {
      requestConfirmation({
        title: "Discard unsaved edits?",
        description: "You have unsaved action edits. Discard them and add a new action?",
        confirmLabel: "Discard and add action",
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
        const details: PlanStepDetails = { owner: addStepOwner };
        if (requiredDocuments.length > 0) {
          details.required_documents = requiredDocuments;
        }
        if (contactLines.length > 0) {
          details.contacts = contactLines.map((line) => ({ notes: line }));
        }
        details.expected_outcome = expectedOutcome;

        const res = await createManualStep({
          familyId,
          planId: plan.id,
          goal,
          title,
          description: addStepDescription.trim(),
          target_date: addStepTargetDate,
          details: Object.keys(details).length > 0 ? details : undefined,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setAddStepTitle("");
        setAddStepDescription("");
        setAddStepTargetDate(dateInputValueAfterDays(7));
        setAddStepDocuments("");
        setAddStepContact("");
        setAddStepExpectedOutcome("");
        setAddStepOwner("case_manager");
        setSuccess("Action added to the plan.");
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
        description: "You have unsaved edits on another action. Discard them and continue?",
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
      setError("Describe what you want changed for this action.");
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
        details: {
          ...aiPreview.details,
          owner:
            (prev.details as PlanStepDetails | null | undefined)?.owner ?? "case_manager",
        },
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
        description: "Discard unsaved action edits to refine the full plan?",
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
    setPlanAiDiscardConfirm(false);
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
      setError("AI refinement changed the action count. Please try again or adjust your instructions.");
      return;
    }
    for (let i = 0; i < baseSteps.length; i++) {
      if (previewSteps[i].phase !== baseSteps[i].phase) {
        setError("AI refinement changed the plan structure. Please try again.");
        return;
      }
    }

    for (let i = 0; i < baseSteps.length; i++) {
      const baseAisLen = baseSteps[i].action_items?.length ?? 0;
      const previewAisLen = previewSteps[i].action_items?.length ?? 0;
      if (baseAisLen !== previewAisLen) {
        setError(
          "AI refinement changed the task count inside an action. Please try again or request a smaller change.",
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
          const newDetails: PlanStepDetails = {
            ...aiStep.details,
            owner: (s.details as PlanStepDetails | null | undefined)?.owner ?? "case_manager",
          };
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
              target_date: aiPreviewRow.target_date ?? ai.target_date,
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
        setPlanAiDiscardConfirm(false);
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

  useEffect(() => {
    if (!planAiOpen) return;
    const dialog = planAiDialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [planAiOpen]);

  function closePlanAiRefine(force = false) {
    if (planAiPending || planBulkSaving) return;
    if (planAiDirty && !force) {
      setPlanAiDiscardConfirm(true);
      return;
    }
    setPlanAiDiscardConfirm(false);
    setPlanAiOpen(false);
    setPlanAiPreview(null);
    setPlanAiInstruction("");
    setPlanAiDraft(null);
  }

  const planAiPreviewGoals = useMemo(() => {
    const titles = (planAiPreview?.steps ?? []).map(
      (step) => step.details.stage_goal?.trim() || step.title,
    );
    return [...new Set(titles)];
  }, [planAiPreview]);

  const reviewStatus = getPlanReviewStatus(plan);

  function reviewPlan() {
    if (!plan || reviewPending) return;
    if (stepDirty || planAiDirty) {
      setError("Save or discard your current edits before marking the plan reviewed.");
      return;
    }
    setReviewPending(true);
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await markPlanReviewed({ familyId, planId: plan.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess("Plan marked reviewed. Paperwork is ready.");
        router.refresh();
      } finally {
        setReviewPending(false);
      }
    });
  }

  if (!plan) {
    return (
      <p className="text-sm text-slate-600">
        Add at least one barrier on the Barriers page, then draft a plan to see clear goals and dated actions here.
      </p>
    );
  }

  const displayTitle = planPageTitle(
    workflow?.planDisplayTitle,
    plan.client_display?.title,
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
          {workflow && (!plan.generation_state || plan.generation_state.status === "complete") ? (
            <PlanPdfExport plan={plan} familyName={familyName} workflow={workflow} />
          ) : null}
          <Button
            type="button"
            onClick={() => openPlanAiRefine()}
            variant="secondary"
            className="border-slate-200"
            disabled={planAiPending}
          >
            {planAiPending ? "Refining…" : "Refine plan with AI"}
          </Button>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {editConflict ? (
        <section
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 sm:p-5"
          role="alert"
          aria-labelledby="edit-conflict-heading"
        >
          <h2 id="edit-conflict-heading" className="text-base font-semibold text-amber-950">
            Another tab saved this action
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-amber-900">
            Nothing was overwritten. Compare your open draft with the latest saved version, then
            choose which one you want to continue with.
          </p>

          {editConflictRows.length > 0 ? (
            <div className="mt-4 space-y-3">
              {editConflictRows.map((row) => (
                <div
                  key={row.label}
                  className="grid gap-2 rounded-lg border border-amber-200 bg-white p-3 sm:grid-cols-2"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 sm:col-span-2">
                    {row.label}
                  </p>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">Your draft</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
                      {row.mine}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">Latest saved</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
                      {row.latest}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-amber-900">
              The saved record changed outside the fields shown in this card.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={keepConflictDraft}
              disabled={conflictResolution === "keep_draft"}
            >
              {conflictResolution === "keep_draft" ? "Loading latest…" : "Keep my draft"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={useLatestConflictVersion}
              disabled={conflictResolution === "keep_draft"}
            >
              Use latest version
            </Button>
          </div>
          <p className="mt-2 text-xs leading-5 text-amber-800">
            Keeping your draft loads the latest version underneath it. Review once more, then select
            Save edits to apply your choice.
          </p>
        </section>
      ) : null}
      {success ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          role="status"
        >
          {success}
        </p>
      ) : null}

      {recoverableDraft && !editingStepId ? (
        <section className="rounded-lg border border-[#cfe0cc] bg-[#f3f8f1] px-4 py-3" role="status">
          <p className="text-sm font-semibold text-[#173a15]">Unsaved action edit found</p>
          <p className="mt-1 text-xs leading-5 text-[#5d705a]">
            Restore “{recoverableDraft.step.title}” to continue where you left off.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={restoreLocalActionDraft}>
              Restore edit
            </Button>
            <Button type="button" variant="ghost" onClick={clearLocalActionDraft}>
              Discard saved edit
            </Button>
          </div>
        </section>
      ) : null}

      {plan?.generation_state?.status === "failed" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">
            {plan.steps.length > 0 ? "Part of this draft is ready" : "Plan drafting paused"}
          </p>
          <p className="mt-1 leading-relaxed">
            {plan.generation_state.error ??
              "The unfinished part could not be prepared. Any actions already shown below are safely saved."}
          </p>
          {onContinueDraft ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={onContinueDraft}
              disabled={continueDraftPending}
            >
              {continueDraftPending ? "Continuing…" : "Continue draft"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <section
        aria-labelledby="plan-review-heading"
        className={`rounded-xl border p-4 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5 ${
          reviewStatus.state === "reviewed"
            ? "border-[#b8d6b3] bg-[#edf4eb]"
            : reviewStatus.state === "needs_attention"
              ? "border-[#ead69b] bg-[#fff8e5]"
              : "border-[#dce6d9] bg-white"
        }`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${
              reviewStatus.state === "reviewed"
                ? "bg-white text-[#276221]"
                : reviewStatus.state === "needs_attention"
                  ? "bg-white text-[#765a16]"
                  : "bg-[#edf4eb] text-[#276221]"
            }`}
          >
            {reviewStatus.state === "reviewed" ? (
              <CheckCircle2 className="size-5" aria-hidden />
            ) : (
              <CircleAlert className="size-5" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="plan-review-heading" className="text-sm font-semibold text-[#173a15]">
                {reviewStatus.state === "reviewed"
                  ? "Plan approved for paperwork"
                  : reviewStatus.state === "needs_review"
                    ? "Check and approve this plan"
                    : reviewStatus.state === "needs_attention"
                      ? "Resolve plan details"
                      : "Plan is being prepared"}
              </h2>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#50644d]">
                {reviewStatus.label}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[#5d705a]">
              {reviewStatus.state === "reviewed"
                ? `Reviewed ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(plan.client_display!.reviewedAt!))}. Material edits will return the plan to Needs review.`
                : reviewStatus.state === "needs_review"
                  ? "Read each goal, action, and target date. Mark reviewed when the plan reflects your judgment; only then can CaseLink use it for paperwork."
                  : reviewStatus.issue}
            </p>
            {(stepDirty || planAiDirty) && reviewStatus.state === "needs_review" ? (
              <p className="mt-1 text-xs font-medium text-[#765a16]">
                Save or discard the current edits before approving the plan.
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 shrink-0 sm:mt-0">
          {reviewStatus.state === "reviewed" ? (
            <Link
              href={`/families/${familyId}/paperwork`}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white shadow-[0_5px_14px_rgba(39,98,33,0.14)] hover:bg-[#1f531b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#46923c]/25"
            >
              Prepare paperwork
            </Link>
          ) : reviewStatus.state === "needs_review" ? (
            <Button
              type="button"
              onClick={reviewPlan}
              disabled={reviewPending || pending || stepDirty || planAiDirty}
            >
              {reviewPending ? "Marking reviewed…" : "Mark plan reviewed"}
            </Button>
          ) : null}
        </div>
      </section>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {goalGroups.length > 0 ? (
            goalGroups.map((group, groupIndex) => {
              const nextTargetDate = formatTargetDate(group.earliestOpenTargetDate);
              return (
                <section key={group.key} className="max-w-[800px] space-y-4">
                  <div className="rounded-xl border border-[#dce6d9] bg-[#f6f9f5] px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#687b65]">
                          Goal {groupIndex + 1}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold tracking-tight text-[#173a15]">
                          {group.title}
                        </h3>
                      </div>
                      <div className="text-left text-xs text-[#5d705a] sm:text-right">
                        <p>
                          {group.completedActionCount} of {group.actionCount} actions complete
                        </p>
                        {nextTargetDate ? (
                          <p className="mt-1 font-medium text-[#276221]">
                            Next target: <time dateTime={group.earliestOpenTargetDate ?? undefined}>{nextTargetDate}</time>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-5">
                    {group.steps.map((full) => {
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
                              onPatchActionItem={(actionItemId, patch) => {
                                if (editingStepId === full.id) {
                                  patchEditingActionItem(actionItemId, patch);
                                }
                              }}
                              onToggleActionItem={onToggleActionItem}
                              actionToggleDisabled={actionToggleDisabled}
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
              );
            })
          ) : (
            <p className="max-w-[800px] rounded-xl border border-dashed border-[#cfe0cc] bg-[#f8faf7] px-4 py-6 text-sm text-[#5d705a]">
              This plan does not have any actions yet. Add the first action below.
            </p>
          )}
          <section className="max-w-[800px] space-y-4 rounded-xl border border-[#dce6d9] bg-white p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-[#173a15]">Add an action</h3>
              <p className="text-xs text-slate-500">
                Put the action under a clear goal and give it one exact target date.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-xs text-slate-600">
                  <span>Goal</span>
                  <input
                    type="text"
                    list="caselink-plan-goals"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    value={addStepGoal}
                    onChange={(e) => setAddStepGoal(e.target.value)}
                    placeholder="e.g. Stabilize housing"
                    disabled={addStepPending}
                  />
                  <datalist id="caselink-plan-goals">
                    {goalGroups.map((group) => (
                      <option key={group.key} value={group.title} />
                    ))}
                  </datalist>
                </label>
                <label className="space-y-1 text-xs text-slate-600">
                  <span>Target date</span>
                  <input
                    type="date"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    min={dateInputValueAfterDays(0)}
                    value={addStepTargetDate}
                    onChange={(e) => setAddStepTargetDate(e.target.value)}
                    disabled={addStepPending}
                  />
                </label>
                <label className="space-y-1 text-xs text-slate-600">
                  <span>Owner</span>
                  <select
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    value={addStepOwner}
                    onChange={(event) =>
                      setAddStepOwner(event.target.value as NonNullable<PlanStepDetails["owner"]>)
                    }
                    disabled={addStepPending}
                  >
                    <option value="case_manager">Case manager</option>
                    <option value="shared">Shared</option>
                    <option value="school_program">School / program</option>
                    <option value="family">Family</option>
                  </select>
                </label>
              </div>
              <label className="space-y-1 text-xs text-slate-600">
                  <span>Action</span>
                  <input
                    type="text"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    value={addStepTitle}
                    onChange={(e) => setAddStepTitle(e.target.value)}
                    placeholder="e.g. Confirm documentation with utility provider"
                    disabled={addStepPending}
                  />
              </label>
              <label className="space-y-1 text-xs text-slate-600">
                <span>Notes (optional)</span>
                <Textarea
                  className="min-h-[90px] border-slate-200"
                  value={addStepDescription}
                  onChange={(e) => setAddStepDescription(e.target.value)}
                  placeholder="Add context that will help complete this action."
                  disabled={addStepPending}
                />
              </label>
              <label className="space-y-1 text-xs text-slate-600">
                <span>Expected result</span>
                <Textarea
                  className="min-h-[72px] border-slate-200 bg-white"
                  value={addStepExpectedOutcome}
                  onChange={(e) => setAddStepExpectedOutcome(e.target.value)}
                  placeholder="What should be true when this action succeeds?"
                  disabled={addStepPending}
                  required
                />
              </label>
              <details className="rounded-lg border border-slate-200 bg-[#fafcf9] px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-[#5d705a]">
                  Add documents or contact details
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="space-y-1 text-xs text-slate-600">
                    <span>Documents</span>
                    <Textarea
                      className="min-h-[72px] border-slate-200 bg-white"
                      value={addStepDocuments}
                      onChange={(e) => setAddStepDocuments(e.target.value)}
                      placeholder="One required document per line."
                      disabled={addStepPending}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <span>Contact</span>
                    <Textarea
                      className="min-h-[72px] border-slate-200 bg-white"
                      value={addStepContact}
                      onChange={(e) => setAddStepContact(e.target.value)}
                      placeholder="One contact detail per line."
                      disabled={addStepPending}
                    />
                  </label>
                </div>
              </details>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => createStepAtBottom()}
                  disabled={
                    addStepPending ||
                    addStepGoal.trim().length === 0 ||
                    addStepTitle.trim().length === 0 ||
                    addStepExpectedOutcome.trim().length === 0 ||
                    !addStepTargetDate
                  }
                >
                  {addStepPending ? "Adding…" : "Add action"}
                </Button>
              </div>
            </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:z-0 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:overscroll-y-contain lg:self-start">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resources</p>
            <p className="mt-1 text-sm text-slate-600">
              Matches from your organization&apos;s resource directory.
            </p>

            <div className="mt-4 space-y-3">
              {!workflow || workflow.resourceStatus === "unavailable" ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
                  <p>
                    {workflow?.resourceStatusMessage?.trim() ||
                      "Resource matches could not be loaded."} Your plan is still available, and no resource information was added to it.
                  </p>
                  {onRetryResources ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3 h-9"
                      onClick={onRetryResources}
                      disabled={resourceRetrying}
                    >
                      {resourceRetrying ? "Trying again…" : "Retry resources"}
                    </Button>
                  ) : null}
                </div>
              ) : workflow.resourceStatus === "empty" || workflow.resources.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                  <p>No resource matches are available yet. Review the plan without relying on a resource recommendation.</p>
                  {onRetryResources ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3 h-9"
                      onClick={onRetryResources}
                      disabled={resourceRetrying}
                    >
                      {resourceRetrying ? "Checking again…" : "Check again"}
                    </Button>
                  ) : null}
                </div>
              ) : workflow.resources.slice(0, 10).map((r) => (
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
                      <a className="block text-xs text-[#276221] hover:underline" href={`tel:${r.primaryPhone}`}>
                        {r.primaryPhone}
                      </a>
                    ) : null}
                    {r.primaryEmail ? (
                      <a className="block break-all text-xs text-[#276221] hover:underline" href={`mailto:${r.primaryEmail}`}>
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
        <dialog
          ref={planAiDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-ai-title"
          aria-describedby="plan-ai-description"
          className="m-auto max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/45 backdrop:backdrop-blur-[1px]"
          onCancel={(event) => {
            event.preventDefault();
            closePlanAiRefine();
          }}
        >
          <div className="p-5">
            <h2 id="plan-ai-title" className="text-base font-semibold text-slate-900">
              Refine full plan with AI
            </h2>
            <p id="plan-ai-description" className="mt-1 text-xs text-slate-500">
              Preview updates a working copy of this plan. After you apply a preview, use{" "}
              <strong>Save to plan</strong> to write only the actions that changed.
            </p>

            <label htmlFor="plan-ai-instruction" className="mt-4 block text-sm font-medium text-slate-800">
              What should change?
            </label>
            <Textarea
              id="plan-ai-instruction"
              className="mt-2 min-h-[120px] border-slate-200"
              value={planAiInstruction}
              onChange={(e) => setPlanAiInstruction(e.target.value)}
              placeholder="e.g. Make the first actions more realistic for one case manager, keep the target dates, and preserve my manual edits."
              autoFocus
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
                onClick={() => closePlanAiRefine()}
              >
                Close
              </Button>
            </div>

            {planAiDiscardConfirm ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3" role="alert">
                <p className="text-sm font-semibold text-amber-950">Discard unsaved changes?</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900">
                  The working copy differs from the saved plan.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPlanAiDiscardConfirm(false)}
                    autoFocus
                  >
                    Keep editing
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => closePlanAiRefine(true)}>
                    Discard changes
                  </Button>
                </div>
              </div>
            ) : null}

            {planAiPreview ? (
              <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-sm font-semibold text-slate-900">
                  Preview ready ({planAiPreview.steps.length} steps)
                </p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Goals in this preview
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                    {planAiPreviewGoals.map((goal) => (
                      <li key={goal}>{goal}</li>
                    ))}
                  </ul>
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#cfe0cc] bg-[#edf4eb] px-3 py-2.5">
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
        </dialog>
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
