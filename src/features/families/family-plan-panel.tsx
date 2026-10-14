"use client";

import { addCalendarDays, schoolDate, formatDateOnly as formatTargetDate } from "@/lib/dates";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspaceUserId } from "@/components/layout/workspace-session-boundary";
import { CheckCircle as CheckCircle2, WarningCircle as CircleAlert } from "iconoir-react";
import {
  markPlanReviewed,
  previewRefinePlanStep,
  previewRefinePlan,
  createManualStep,
  deletePlanStep,
  savePlanEdits,
  type PlanEditConflict,
} from "@/app/actions/plans";
import type { SavePlanEditsInput } from "@/lib/validations/plans";
import { recordCaseWorkflowEvent } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { PlanContactPicker } from "./plan-contact-picker";
import type { PlanContact } from "@/lib/matching/plan-resources";
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
import { actionTargetDate, actionUserNotes } from "@/lib/domain/plan/action-state";
import { applyRefinementChanges, collectRefinementChanges, toRefinementDraft, type RefinementChange } from "@/lib/domain/plan/refinement-review";
import { RefinementChangeReview } from "@/features/families/refinement-change-review";

import { getPlanReviewStatus } from "@/lib/domain/plan/review-status";
import {
  localActionDraftKey,
  parseLocalActionDraft,
  serializeLocalActionDraft,
  pruneLocalActionDrafts,
  DRAFT_LOGOUT_KEY,
  type LocalActionDraft,
} from "@/lib/domain/plan/local-action-draft";

type RefinementPreview = { changes: RefinementChange[]; selected: string[]; base: string; revision: string | null };

function readStoredActionDraft(userId: string, planId: string): LocalActionDraft | null {
  pruneLocalActionDrafts(userId);
  return parseLocalActionDraft(window.sessionStorage.getItem(localActionDraftKey(userId, planId)), userId, planId, Date.now(), Number(window.localStorage.getItem(DRAFT_LOGOUT_KEY)) || 0);
}

function removeStoredActionDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Draft recovery is optional when browser storage is restricted.
  }
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

function workflowValueDisplay(value: unknown): string {
  if (value == null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((done, i) => `${i + 1}. ${done ? "Completed" : "Not completed"}`).join("; ") || "Not set";
  return String(value);
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
      { label: "Plan stage", mine: draft.phase, latest: conflict.current.phase },
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
        mine: listDisplay(mineDetails.required_documents),
        latest: listDisplay(latestDetails.required_documents),
      },
      {
        label: "Contact",
        mine: contactDisplay(mineDetails),
        latest: contactDisplay(latestDetails),
      },
      ...([
        ["rationale", "Reason"], ["detailed_instructions", "Instructions"],
        ["timing_guidance", "Timing guidance"], ["why_now", "Why now"],
        ["depends_on", "Dependencies"], ["milestone_type", "Milestone"],
        ["success_marker", "Success marker"], ["contact_script", "Contact script"],
        ["priority", "Detail priority"],
      ] as const).map(([key, label]) => ({ label, mine: mineDetails[key] || "Not set", latest: latestDetails[key] || "Not set" })),
      ...([
        ["materials_needed", "Other materials"], ["blockers", "Possible barriers"],
        ["fallback_options", "Fallback options"], ["checklist", "Checklist"],
      ] as const).map(([key, label]) => ({ label,
        mine: (mineDetails[key] ?? []).map((value, i) => `${i + 1}. ${value || "(blank)"}`).join("; ") || "Not set",
        latest: (latestDetails[key] ?? []).map((value, i) => `${i + 1}. ${value || "(blank)"}`).join("; ") || "Not set",
      })),
      ...([
        ["contact_attempted_at", "Contact attempted"], ["outreach_result", "Outreach result"],
        ["needs_escalation", "Escalation needed"], ["documents_received", "Documents received"],
        ["family_understood", "Family understood"], ["case_manager_assisted", "Case manager assisted"],
        ["checklist_completed", "Checklist completion"],
      ] as const).map(([key, label]) => ({ label,
        mine: workflowValueDisplay(draft.workflow_data?.[key]),
        latest: workflowValueDisplay(conflict.current.workflow_data?.[key]),
      })),
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
      { label: "Task description", mine: mine.description || "Not set", latest: conflict.current.description || "Not set" },
      { label: "Week", mine: String(mine.week_index), latest: String(conflict.current.week_index) },
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

/** Snapshot of the parent plan-step record (excludes independently saved task rows). */
function normalizeStepRecordForPersistCompare(step: PlanStepRow): string {
  const d = { ...(step.details as PlanStepDetails | null | undefined) } as PlanStepDetails;
  d.owner ??= "case_manager";
  const wd = { ...(step.workflow_data ?? {}) };
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
  const userId = useWorkspaceUserId();
  const aiRequestRef = useRef({ id: 0, pending: false, revision: null as string | null });
  const planAiRequestRef = useRef({ id: 0, pending: false, revision: null as string | null });
  useEffect(() => {
    const stepRequest = aiRequestRef.current;
    const planRequest = planAiRequestRef.current;
    return () => { stepRequest.id += 1; planRequest.id += 1; };
  }, []);
  const stepSaveLockRef = useRef(false);
  const planBulkSaveLockRef = useRef(false);
  const [stepSaveBusy, setStepSaveBusy] = useState(false);
  const [planBulkSaving, setPlanBulkSaving] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [pending, startTransition] = useTransition();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState<PlanStepRow | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<LocalActionDraft | null>(null);
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null);
  const draftRecoveryLoadedPlanIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState<PlanEditConflict | null>(null);
  const [conflictResolution, setConflictResolution] = useState<"keep_draft" | null>(null);
  const [addStepGoal, setAddStepGoal] = useState("");
  const [addStepTitle, setAddStepTitle] = useState("");
  const [addStepTargetDate, setAddStepTargetDate] = useState(() => addCalendarDays(schoolDate(), 7));
  const [addStepDescription, setAddStepDescription] = useState("");
  const [addStepDocuments, setAddStepDocuments] = useState("");
  const [addStepContacts, setAddStepContacts] = useState<PlanContact[]>([]);
  const directoryContacts = workflow?.resources.map(resource => resource.planContact) ?? [];
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
  const [aiPreview, setAiPreview] = useState<RefinementPreview | null>(null);
  const [aiPending, setAiPending] = useState(false);

  const [planAiOpen, setPlanAiOpen] = useState(false);
  const planAiDialogRef = useRef<HTMLDialogElement>(null);
  const [planAiDiscardConfirm, setPlanAiDiscardConfirm] = useState(false);
  const [planAiInstruction, setPlanAiInstruction] = useState("");
  const [planAiPending, setPlanAiPending] = useState(false);
  const [planAiPreview, setPlanAiPreview] = useState<RefinementPreview | null>(null);

  useEffect(() => {
    const revision = plan?.review_revision ?? null;
    if (aiRequestRef.current.revision !== null && aiRequestRef.current.revision !== revision) {
      Object.assign(aiRequestRef.current, { id: aiRequestRef.current.id + 1, pending: false, revision: null });
      setAiPending(false);
      setAiPreview(null);
      setError("The saved plan changed. Your draft is still here; review the latest plan before generating another preview.");
    }
    if (planAiRequestRef.current.revision !== null && planAiRequestRef.current.revision !== revision) {
      Object.assign(planAiRequestRef.current, { id: planAiRequestRef.current.id + 1, pending: false, revision: null });
      setPlanAiPending(false);
      setPlanAiPreview(null);
      setError("The saved plan changed. Your working copy is still here; review the latest plan before generating another preview.");
    }
  }, [plan?.review_revision]);

  const stepDirty = useMemo(() => {
    if (!editingStepId || !stepDraft || !plan) return false;
    const orig = plan.steps.find((s) => s.id === editingStepId);
    return stepNeedsPersist(orig, stepDraft);
  }, [editingStepId, stepDraft, plan]);

  const planAiDirty = useMemo(() => {
    if (!planAiDraft || !plan) return false;
    for (const s of planAiDraft.steps) {
      const o = plan.steps.find((x) => x.id === s.id);
      if (stepNeedsPersist(o, s)) return true;
    }
    return false;
  }, [planAiDraft, plan]);

  const editConflictRows = useMemo(
    () => (editConflict ? conflictComparisonRows(editConflict, stepDraft) : []),
    [editConflict, stepDraft],
  );

  const actionDraftStorageKey = plan && userId ? localActionDraftKey(userId, plan.id) : null;

  useEffect(() => {
    if (!plan) return;
    const events: Array<"plan_viewed" | "first_action_visible"> = ["plan_viewed"];
    if (plan.steps.length > 0) events.push("first_action_visible");
    for (const event of events) {
      const key = `caselink:workflow-event:${event}:${plan.id}:${plan.version}`;
      try {
        if (window.sessionStorage.getItem(key)) continue;
        window.sessionStorage.setItem(key, "1");
      } catch {
        // Recording still works when session storage is restricted; this mount sends once.
      }
      void recordCaseWorkflowEvent({ familyId, planId: plan.id, event });
    }
  }, [familyId, plan]);

  useEffect(() => {
    if (!plan || !userId || !actionDraftStorageKey || draftRecoveryLoadedPlanIdRef.current === plan.id) {
      return;
    }
    draftRecoveryLoadedPlanIdRef.current = plan.id;
    let stored: LocalActionDraft | null;
    try { stored = readStoredActionDraft(userId, plan.id); } catch {
      setRecoveryWarning("Draft recovery is unavailable in this browser. Keep this tab open until your edits are saved.");
      return;
    }
    if (!stored || stored.planId !== plan.id) {
      removeStoredActionDraft(actionDraftStorageKey);
      return;
    }
    if (!plan.steps.some((step) => step.id === stored.step.id)) {
      removeStoredActionDraft(actionDraftStorageKey);
      return;
    }
    setRecoverableDraft(stored);
  }, [actionDraftStorageKey, plan, userId]);

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
    if (!actionDraftStorageKey || !userId || !stepDirty || !stepDraft || !plan) return;
    try {
      pruneLocalActionDrafts(userId);
      const value = serializeLocalActionDraft(userId, plan.id, stepDraft);
      // Remove a previous copy immediately when identifying text or invalid content is entered.
      window.sessionStorage.removeItem(actionDraftStorageKey);
      if (!value) {
        setRecoveryWarning("This edit cannot be kept for recovery. Remove identifying text and check the fields; keep this tab open until saved.");
        return;
      }
      window.sessionStorage.setItem(actionDraftStorageKey, value);
      setRecoveryWarning(null);
    } catch {
      setRecoveryWarning("Draft recovery is unavailable in this browser. Keep this tab open until your edits are saved.");
    }
  }, [actionDraftStorageKey, plan, stepDirty, stepDraft, userId]);

  useEffect(() => {
    if (!stepDirty && !planAiDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [stepDirty, planAiDirty]);

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
    if (actionDraftStorageKey) removeStoredActionDraft(actionDraftStorageKey);
    setRecoverableDraft(null);
    setRecoveryWarning(null);
  }

  function restoreLocalActionDraft() {
    if (!recoverableDraft || !plan || !userId) return;
    let stored: LocalActionDraft | null;
    try { stored = readStoredActionDraft(userId, plan.id); } catch { stored = null; }
    if (!stored || !plan.steps.some((step) => step.id === stored.step.id)) {
      clearLocalActionDraft();
      setRecoveryWarning("This recovery copy expired or is unavailable. Your saved plan is unchanged.");
      return;
    }
    setEditingStepId(stored.step.id);
    setStepDraft(cloneStep(stored.step));
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
    cancelStepPreviewRequest();
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
    cancelStepPreviewRequest();
    setAiStepId(null);
    setAiPreview(null);
    setAiInstruction("");
    setEditConflict(null);
    setConflictResolution(null);
    setError(null);
  }

  function keepConflictDraft() {
    if (!editConflict || conflictResolution) return;
    setStepDraft(previous => {
      if (!previous) return previous;
      return editConflict.kind === "step"
        ? { ...previous, updated_at: editConflict.currentUpdatedAt }
        : { ...previous, action_items: previous.action_items?.map(action => action.id === editConflict.entityId ? { ...action, updated_at: editConflict.currentUpdatedAt } : action) };
    });
    setConflictResolution("keep_draft");
    setError(null);
    router.refresh();
  }

  function useLatestConflictVersion() {
    clearLocalActionDraft();
    setEditingStepId(null);
    setStepDraft(null);
    cancelStepPreviewRequest();
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
    cancelStepPreviewRequest();
    setAiPreview(null);
    setStepDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function patchEditingStepDetails(patch: Partial<PlanStepDetails>) {
    cancelStepPreviewRequest();
    setAiPreview(null);
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
    cancelStepPreviewRequest();
    setAiPreview(null);
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

  async function persistSteps(steps: PlanStepRow[], bulk = false): Promise<boolean> {
    if (!plan) return false;
    const changes: SavePlanEditsInput["steps"] = [];
    for (const s of steps) {
      const orig = plan.steps.find(row => row.id === s.id);
      if (!orig) { setError("This action is no longer in the current plan. Reload the saved plan before continuing."); return false; }
      if (!stepNeedsPersist(orig, s)) continue;
      for (const action of s.action_items ?? []) {
        if (!action.title.trim()) { setError("Every action needs a short title before saving."); return false; }
        if (action.status !== "completed" && !action.target_date) { setError(`Choose a target date for “${action.title}” before saving.`); return false; }
        if (action.status === "blocked" && (!actionUserNotes(action.notes).trim() || !action.follow_up_date)) {
          setError(`Add a waiting reason and next follow-up date for “${action.title}”.`); return false;
        }
      }
      const details = { ...s.details, owner: s.details?.owner ?? "case_manager" };
      const workflow = { ...s.workflow_data };
      const actionItems: SavePlanEditsInput["steps"][number]["actionItems"] = [];
      for (const action of s.action_items ?? []) {
        const original = orig.action_items?.find(row => row.id === action.id);
        const patch = { title: action.title, description: action.description, week_index: action.week_index, target_date: action.target_date,
          status: action.status, outcome: action.outcome, notes: action.notes, follow_up_date: action.follow_up_date };
        if (original && Object.entries(patch).every(([key, value]) => original[key as keyof PlanStepActionItemRow] === value)) continue;
        actionItems.push({ actionItemId: action.id, expectedUpdatedAt: action.updated_at, patch });
      }
      changes.push({
        stepId: s.id,
        expectedUpdatedAt: s.updated_at,
        patch: stepRecordNeedsPersist(orig, s) ? { title: s.title, description: s.description, status: s.status, phase: s.phase,
          priority: s.priority ?? undefined, details, workflow_data: workflow } : {},
        actionItems,
      });
    }
    if (!changes.length) return true;
    const result = await savePlanEdits({ familyId, planId: plan.id, steps: changes });
    if (!result.ok) {
      setEditConflict(result.conflict ?? null);
      setConflictResolution(null);
      setError(result.conflict && !bulk ? null : result.error);
      return false;
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
        const ok = await persistSteps([stepDraft]);
        if (!ok) return;
        setSuccess("Action saved.");
        setEditConflict(null);
        setConflictResolution(null);
        clearLocalActionDraft();
        setEditingStepId(null);
        setStepDraft(null);
        cancelStepPreviewRequest();
        setAiStepId(null);
        setAiPreview(null);
        setAiInstruction("");
        router.refresh();
      } catch {
        setError("The save could not be confirmed. Your edits are still open; reload the saved plan before retrying.");
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
          cancelStepPreviewRequest();
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
        const details: PlanStepDetails = { owner: addStepOwner };
        if (requiredDocuments.length > 0) {
          details.required_documents = requiredDocuments;
        }
        if (addStepContacts.length > 0) details.contacts = addStepContacts;
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
        setAddStepTargetDate(addCalendarDays(schoolDate(), 7));
        setAddStepDocuments("");
        setAddStepContacts([]);
        setAddStepExpectedOutcome("");
        setAddStepOwner("case_manager");
        setSuccess("Action added to the plan.");
        router.refresh();
      } finally {
        setAddStepPending(false);
      }
    });
  }

  function cancelStepPreviewRequest() {
    aiRequestRef.current.id += 1;
    aiRequestRef.current.pending = false;
    aiRequestRef.current.revision = null;
    setAiPending(false);
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
    if (!aiStepId || !stepDraft || stepDraft.id !== aiStepId || aiRequestRef.current.pending) return;
    if (!plan?.review_revision) { setError("Reload the plan before requesting an AI preview."); return; }
    const instr = aiInstruction.trim();
    if (!instr) {
      setError("Describe what you want changed for this action.");
      return;
    }
    const snapshot = cloneStep(stepDraft);
    const revision = plan?.review_revision ?? null;
    const requestId = ++aiRequestRef.current.id;
    aiRequestRef.current.pending = true;
    aiRequestRef.current.revision = revision;
    setAiPending(true);
    setAiPreview(null);
    setError(null);
    previewRefinePlanStep({
      stepId: aiStepId,
      expectedRevision: plan.review_revision,
      draft: toRefinementDraft(snapshot),
      familyId,
      feedback: instr,
      aiMode: DEFAULT_AI_MODE,
    }).then((res) => {
      if (requestId !== aiRequestRef.current.id) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAiPreview({ changes: collectRefinementChanges([snapshot], [res.step]), selected: [], base: JSON.stringify(snapshot), revision });
    }).catch(() => {
      if (requestId === aiRequestRef.current.id) setError("The preview could not be prepared. Your edits are unchanged; try again.");
    }).finally(() => {
      if (requestId === aiRequestRef.current.id) {
        aiRequestRef.current.pending = false;
        setAiPending(false);
      }
    });
  }

  function applyAiToDraft() {
    if (!aiPreview || !stepDraft || !aiPreview.selected.length) return;
    if (aiPreview.base !== JSON.stringify(stepDraft) || aiPreview.revision !== (plan?.review_revision ?? null)) {
      setError("The draft or saved plan changed. Generate a new preview before applying changes.");
      return;
    }
    setStepDraft(applyRefinementChanges([stepDraft], aiPreview.changes, aiPreview.selected)[0]);
    cancelStepPreviewRequest();
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
    if (!plan?.review_revision) { setError("Reload the plan before requesting an AI preview."); return; }
    const instr = planAiInstruction.trim();
    if (!instr) {
      setError("Describe what you want to change for the full plan.");
      return;
    }
    if (!planAiDraft || planAiRequestRef.current.pending) return;

    const snapshot = clonePlan(planAiDraft);
    const revision = plan?.review_revision ?? null;
    const requestId = ++planAiRequestRef.current.id;
    planAiRequestRef.current.pending = true;
    planAiRequestRef.current.revision = revision;
    setPlanAiPending(true);
    setPlanAiPreview(null);
    setError(null);

    const draftForApi = { steps: snapshot.steps.map(toRefinementDraft) };

    previewRefinePlan({
      familyId,
      expectedRevision: plan.review_revision,
      feedback: instr,
      draft: draftForApi,
      aiMode: DEFAULT_AI_MODE,
    }).then((res) => {
      if (requestId !== planAiRequestRef.current.id) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlanAiPreview({ changes: collectRefinementChanges(snapshot.steps, res.steps), selected: [], base: JSON.stringify(snapshot), revision });
    }).catch(() => {
      if (requestId === planAiRequestRef.current.id) setError("The preview could not be prepared. Your edits are unchanged; try again.");
    }).finally(() => {
      if (requestId === planAiRequestRef.current.id) {
        planAiRequestRef.current.pending = false;
        setPlanAiPending(false);
      }
    });
  }

  function applyPlanAiToDraft() {
    if (!planAiPreview || !planAiDraft || !planAiPreview.selected.length) return;
    if (planAiPreview.base !== JSON.stringify(planAiDraft) || planAiPreview.revision !== (plan?.review_revision ?? null)) {
      setError("The working copy or saved plan changed. Generate a new preview before applying changes.");
      return;
    }
    setPlanAiDraft({ ...planAiDraft, steps: applyRefinementChanges(planAiDraft.steps, planAiPreview.changes, planAiPreview.selected) });
    document.getElementById("plan-ai-instruction")?.focus();
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
        const ok = await persistSteps(planAiDraft.steps, true);
        if (!ok) return;
        setSuccess("Plan updates saved.");
        setPlanAiDiscardConfirm(false);
        setPlanAiOpen(false);
        setPlanAiPreview(null);
        setPlanAiInstruction("");
        setPlanAiDraft(null);
        router.refresh();
      } catch {
        setError("The save could not be confirmed. Your working copy is still open; reload the saved plan before retrying.");
      } finally {
        planBulkSaveLockRef.current = false;
        setPlanBulkSaving(false);
      }
    });
  }

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
    if (planBulkSaving) return;
    if (planAiDirty && !force) {
      setPlanAiDiscardConfirm(true);
      return;
    }
    planAiRequestRef.current.id += 1;
    planAiRequestRef.current.pending = false;
    planAiRequestRef.current.revision = null;
    setPlanAiPending(false);
    setPlanAiDiscardConfirm(false);
    setPlanAiOpen(false);
    setPlanAiPreview(null);
    setPlanAiInstruction("");
    setPlanAiDraft(null);
  }


  const reviewStatus = getPlanReviewStatus(plan);

  function confirmDatesAndReview() {
    if (!plan) return;
    const today = schoolDate();
    const past = plan.steps.flatMap(step => step.action_items ?? []).filter(action => {
      const date = actionTargetDate(action);
      return action.status !== "completed" && date && date < today;
    }).length;
    requestConfirmation({
      title: "Confirm dates and review this plan?",
      description: `Confirm that each open action has the date you intend. Waiting dates are the next follow-up date. ${past ? `${past} open ${past === 1 ? "action has a date" : "actions have dates"} before ${formatTargetDate(today)}. Confirm those earlier dates are intentional, or cancel and update them. ` : ""}AI dates are proposals until you approve them here.`,
      confirmLabel: "Confirm dates and mark reviewed",
      onConfirm: reviewPlan,
    });
  }

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
        const result = await markPlanReviewed({ familyId, planId: plan.id, expectedRevision: plan.review_revision, datesConfirmed: true });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSuccess("Plan marked reviewed. Paperwork is ready.");
        router.refresh();
      } catch {
        setError("The review could not be saved. Your edits are unchanged; try again.");
      } finally {
        setReviewPending(false);
      }
    });
  }

  if (!plan) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
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
                  className="rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-2)]"
                >
                  {b}
                </span>
              ))}
              {workflow.selectedBarriers.length > 6 ? (
                <span className="rounded-full border border-[var(--color-rule)] bg-[var(--color-paper)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-muted)]">
                  +{workflow.selectedBarriers.length - 6} more
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pending || stepDirty || planAiDirty}
            onClick={() => router.push(`/families/${familyId}/assistant`)}
          >
            Ask about this plan
          </Button>
          <Button
            type="button"
            onClick={() => openPlanAiRefine()}
            variant="secondary"
            className="border-[var(--color-rule)]"
            disabled={planAiPending}
          >
            {planAiPending ? "Refining…" : "Refine plan with AI"}
          </Button>
        </div>
      </div>

      {error && !planAiOpen ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {editConflict && !planAiOpen ? (
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
                  className="grid gap-2 rounded-lg border border-amber-200 bg-[var(--color-surface)] p-3 sm:grid-cols-2"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 sm:col-span-2">
                    {row.label}
                  </p>
                  <div>
                    <p className="text-[11px] font-medium text-[var(--color-ink-faint)]">Your draft</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">
                      {row.mine}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[var(--color-ink-faint)]">Latest saved</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">
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

      {recoveryWarning ? <p role="status" className="text-sm text-[var(--color-ink-muted)]">{recoveryWarning}</p> : null}
      {stepDirty && !recoveryWarning ? <p className="text-xs text-[var(--color-ink-muted)]">Unsaved edits can be recovered in this tab for 30 minutes. Signing out clears them. Use only non-identifying case information.</p> : null}
      {recoverableDraft && !editingStepId ? (
        <section className="rounded-lg border border-[var(--color-rule-strong)] bg-[var(--color-accent-soft)] px-4 py-3" role="status">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Unsaved action edit found</p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-ink-muted)]">
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

      {plan?.generation_state?.input_snapshot ? (
        <p className="text-xs leading-5 text-[var(--color-ink-muted)]">
          This draft uses the case information saved when drafting began, including the five most recent notes and meetings.
          Later case changes need a new draft or a manual edit. Check the draft against the current case before approving it.
        </p>
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
            ? "border-[var(--color-accent-rule)] bg-[var(--color-accent-soft)]"
            : reviewStatus.state === "needs_attention"
              ? "border-[var(--color-attention-rule)] bg-[var(--color-attention-bg)]"
              : "border-[var(--color-rule)] bg-[var(--color-surface)]"
        }`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${
              reviewStatus.state === "reviewed"
                ? "bg-[var(--color-surface)] text-[var(--color-accent)]"
                : reviewStatus.state === "needs_attention"
                  ? "bg-[var(--color-surface)] text-[var(--color-attention)]"
                  : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
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
              <h2 id="plan-review-heading" className="text-sm font-semibold text-[var(--color-ink)]">
                {reviewStatus.state === "reviewed"
                  ? "Plan ready for PDF review"
                  : reviewStatus.state === "needs_review"
                    ? "Check and approve this plan"
                    : reviewStatus.state === "needs_attention"
                      ? "Resolve plan details"
                      : "Plan is being prepared"}
              </h2>
              <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-ink-muted)]">
                {reviewStatus.label}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-ink-muted)]">
              {reviewStatus.state === "reviewed"
                ? `Reviewed ${formatTargetDate(schoolDate(new Date(plan.client_display!.reviewedAt!)))}. Material edits will return the plan to Needs review.`
                : reviewStatus.state === "needs_review"
                  ? "Dates are proposed until you confirm them. Check each goal and action; Waiting dates mean the next follow-up. Confirm the dates and plan before creating the PDF."
                  : reviewStatus.issue}
            </p>
            {(stepDirty || planAiDirty) && reviewStatus.state === "needs_review" ? (
              <p className="mt-1 text-xs font-medium text-[var(--color-attention)]">
                Save or discard the current edits before approving the plan.
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 shrink-0 sm:mt-0">
          {reviewStatus.state === "reviewed" ? (
            <Link
              href={`/families/${familyId}/paperwork`}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-ink)] [box-shadow:var(--shadow-action)] hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-focus)]/25"
            >
              Review PDF
            </Link>
          ) : reviewStatus.state === "needs_review" ? (
            <Button
              type="button"
              onClick={confirmDatesAndReview}
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
                  <div className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                          Goal {groupIndex + 1}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-ink)]">
                          {group.title}
                        </h3>
                      </div>
                      <div className="text-left text-xs text-[var(--color-ink-muted)] sm:text-right">
                        <p>
                          {group.completedActionCount} of {group.actionCount} actions complete
                        </p>
                        {nextTargetDate ? (
                          <p className="mt-1 font-medium text-[var(--color-accent)]">
                            Next date: <time dateTime={group.earliestOpenTargetDate ?? undefined}>{nextTargetDate}</time>
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
                              directoryContacts={directoryContacts}
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
                              refineChanges={aiPreview?.changes ?? null}
                              refineSelected={aiPreview?.selected ?? []}
                              onRefineSelect={(id, checked) => setAiPreview(previous => previous ? { ...previous, selected: checked ? [...previous.selected, id] : previous.selected.filter(value => value !== id) } : null)}
                              refinePending={aiPending}
                              onRefineInstruction={(value) => { cancelStepPreviewRequest(); setAiPreview(null); setAiInstruction(value); }}
                              onRefineRun={runAiPreview}
                              onRefineApply={applyAiToDraft}
                              onRefineClose={() => {
                                cancelStepPreviewRequest();
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
            <p className="max-w-[800px] rounded-xl border border-dashed border-[var(--color-rule-strong)] bg-[var(--color-paper)] px-4 py-6 text-sm text-[var(--color-ink-muted)]">
              This plan does not have any actions yet. Add the first action below.
            </p>
          )}
          <section className="max-w-[800px] space-y-4 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-[var(--color-ink)]">Add an action</h3>
              <p className="text-xs text-[var(--color-ink-faint)]">
                Put the action under a clear goal and give it one exact target date.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                  <span>Goal</span>
                  <input
                    type="text"
                    list="caselink-plan-goals"
                    className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
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
                <label className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                  <span>Target date</span>
                  <input
                    type="date"
                    className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
                    value={addStepTargetDate}
                    onChange={(e) => setAddStepTargetDate(e.target.value)}
                    disabled={addStepPending}
                  />
                </label>
                <label className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                  <span>Owner</span>
                  <select
                    className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
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
              <label className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                  <span>Action</span>
                  <input
                    type="text"
                    className="w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
                    value={addStepTitle}
                    onChange={(e) => setAddStepTitle(e.target.value)}
                    placeholder="e.g. Confirm documentation with utility provider"
                    disabled={addStepPending}
                  />
              </label>
              <label className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                <span>Notes (optional)</span>
                <Textarea
                  className="min-h-[90px] border-[var(--color-rule)]"
                  value={addStepDescription}
                  onChange={(e) => setAddStepDescription(e.target.value)}
                  placeholder="Add context that will help complete this action."
                  disabled={addStepPending}
                />
              </label>
              <label className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                <span>Expected result</span>
                <Textarea
                  className="min-h-[72px] border-[var(--color-rule)] bg-[var(--color-surface)]"
                  value={addStepExpectedOutcome}
                  onChange={(e) => setAddStepExpectedOutcome(e.target.value)}
                  placeholder="What should be true when this action succeeds?"
                  disabled={addStepPending}
                  required
                />
              </label>
              <details className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink-muted)]">
                  Add documents or contact details
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                    <span>Documents</span>
                    <Textarea
                      className="min-h-[72px] border-[var(--color-rule)] bg-[var(--color-surface)]"
                      value={addStepDocuments}
                      onChange={(e) => setAddStepDocuments(e.target.value)}
                      placeholder="One required document per line."
                      disabled={addStepPending}
                    />
                  </label>
                  <PlanContactPicker value={addStepContacts} choices={directoryContacts} onChange={setAddStepContacts} disabled={addStepPending} />
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
          <div className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Resources</p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Matches from your directory. Confirm current eligibility, availability, and contact details before referring.
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
                <div className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
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
                  className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-ink)]">
                      {(r.programName || r.name).trim()}
                    </p>
                    {r.name.trim() && r.name.trim() !== (r.programName || r.name).trim() ? (
                      <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{r.name}</p>
                    ) : r.description?.trim() &&
                      r.description.trim() !== (r.programName || r.name).trim() ? (
                      <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{r.description}</p>
                    ) : null}
                  </div>

                  <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Directory updated {formatTargetDate(schoolDate(new Date(r.directoryUpdatedAt)))}. Import date is not verification.</p>
                  <div className="mt-3 space-y-1">
                    {r.primaryPhone ? (
                      <a className="block text-xs text-[var(--color-accent)] hover:underline" href={`tel:${r.primaryPhone}`}>
                        {r.primaryPhone}
                      </a>
                    ) : null}
                    {r.primaryEmail ? (
                      <a className="block break-all text-xs text-[var(--color-accent)] hover:underline" href={`mailto:${r.primaryEmail}`}>
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
          className="m-auto max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-0 shadow-xl backdrop:bg-[var(--color-ink)]/45 backdrop:backdrop-blur-[1px]"
          onCancel={(event) => {
            event.preventDefault();
            closePlanAiRefine();
          }}
        >
          <div className="p-5">
            <h2 id="plan-ai-title" className="text-base font-semibold text-[var(--color-ink)]">
              Refine full plan with AI
            </h2>
            {error ? <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">{error}</p> : null}
            {editConflict && planAiDraft ? (
              <section aria-label="Save conflict" className="my-3 space-y-3 rounded-lg border border-[var(--color-rule)] p-3 text-sm">
                <p>Nothing was saved. Compare this action with the latest saved version before keeping your working copy.</p>
                {conflictComparisonRows(editConflict, planAiDraft.steps.find(step => step.id === editConflict.entityId || step.action_items?.some(action => action.id === editConflict.entityId)) ?? null).map(row => (
                  <div key={row.label}><p className="font-semibold">{row.label}</p><p>Your edit: {row.mine}</p><p>Latest saved: {row.latest}</p></div>
                ))}
                <Button type="button" variant="outline" onClick={() => {
                  setPlanAiDraft(previous => previous ? { ...previous, steps: previous.steps.map(step => editConflict.kind === "step"
                    ? step.id === editConflict.entityId ? { ...step, updated_at: editConflict.currentUpdatedAt } : step
                    : { ...step, action_items: step.action_items?.map(action => action.id === editConflict.entityId ? { ...action, updated_at: editConflict.currentUpdatedAt } : action) }) } : previous);
                  setEditConflict(null);
                  setError(null);
                  router.refresh();
                }}>Keep my working copy for this action</Button>
              </section>
            ) : null}
            <p id="plan-ai-description" className="mt-1 text-xs text-[var(--color-ink-faint)]">
              Preview updates a working copy of this plan. After you apply a preview, use{" "}
              <strong>Save to plan</strong> to write only the actions that changed.
            </p>

            <label htmlFor="plan-ai-instruction" className="mt-4 block text-sm font-medium text-[var(--color-ink-strong)]">
              What should change?
            </label>
            <Textarea
              id="plan-ai-instruction"
              className="mt-2 min-h-[120px] border-[var(--color-rule)]"
              value={planAiInstruction}
              onChange={(e) => {
                Object.assign(planAiRequestRef.current, { id: planAiRequestRef.current.id + 1, pending: false, revision: null });
                setPlanAiPending(false);
                setPlanAiPreview(null);
                setPlanAiInstruction(e.target.value);
              }}
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
              <div className="mt-4 space-y-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper)] p-3 text-sm">
                <RefinementChangeReview changes={planAiPreview.changes} selected={planAiPreview.selected} onSelect={(id, checked) => setPlanAiPreview(previous => previous ? { ...previous, selected: checked ? [...previous.selected, id] : previous.selected.filter(value => value !== id) } : null)} />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={applyPlanAiToDraft} disabled={!planAiPreview.selected.length}>
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-rule-strong)] bg-[var(--color-accent-soft)] px-3 py-2.5">
                <p className="text-xs text-[var(--color-ink-2)]">
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
