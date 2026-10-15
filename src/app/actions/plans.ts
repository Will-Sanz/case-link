"use server";

import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { schoolDate } from "@/lib/dates";
import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { publicSessionError } from "@/lib/auth/session-errors";
import type { AiMode } from "@/lib/ai/ai-mode";
import { parseAiMode } from "@/lib/ai/ai-mode";
import { getEnv } from "@/lib/env";
import { previewRefinePlanStepsWithOpenAI } from "@/lib/plan-generator/openai-plan";
import { sparseDetailsForPersistence, type LeanPlanPhaseStep } from "@/lib/plan-generator/lean-plan-schema";
import { assertResourceCatalogCurrent, planResourceCatalog } from "@/lib/matching/plan-resources";
import { fetchPriorPhasesSummaryForPlanner } from "@/lib/plan-generator/prior-phase-summary";
import { tryGenerateLeanPlanOpenAI, tryGenerateLeanPlanPhaseOpenAI } from "@/lib/plan-generator/openai-plan-lean-phase";
import { buildPlanningSnapshot, parsePlanningSnapshot } from "@/lib/plan-generator/planning-brief";
import { resolveActionTargetDate } from "@/lib/domain/plan/action-target-date";
import { actionUserNotes } from "@/lib/domain/plan/action-state";
import { matchPlanRowsById } from "@/lib/domain/plan/refinement-identity";
import type { DraftStepRefineInput } from "@/lib/plan-generator/plan-refine-lean";
import { pendingPhaseFromPersistedCounts } from "@/lib/domain/plan/generation-progress";
import { getPlanReviewStatus } from "@/lib/domain/plan/review-status";
import {
  publicMessageFromCaughtError,
  publicMessageFromSupabaseError,
} from "@/lib/errors/public-action-error";
import { logServerError } from "@/lib/logger/server-error";
import {
  validateFamilyNoPii,
  planDetailsPrivacyFields,
  planStepPrivacyFields,
  validateNoPii,
  type PrivacyFieldInput,
} from "@/lib/privacy/no-pii";
import { getFamilyDetail } from "@/lib/services/families";
import type {
  PlanGenerationState,
  PlanStepActionItemRow,
  PlanStepDetails,
  PlanStepRow,
} from "@/types/family";
import {
  createManualStepSchema,
  deletePlanStepSchema,
  stagedPlanAdvanceSchema,
  continuePlanManuallySchema,
  stagedPlanStartSchema,
  markPlanReviewedSchema,
  savePlanEditsSchema,
  previewRefineStepSchema,
  previewRefinePlanSchema,
  updatePlanSchema,
  updatePlanStepActionItemSchema,
} from "@/lib/validations/plans";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type PlanEditConflict =
  | {
      kind: "step";
      entityId: string;
      currentUpdatedAt: string;
      current: {
        title: string;
        description: string;
        status: PlanStepRow["status"];
        phase: PlanStepRow["phase"];
        priority: PlanStepRow["priority"];
        details: PlanStepDetails | null;
        workflow_data: PlanStepRow["workflow_data"];
      };
    }
  | {
      kind: "action_item";
      entityId: string;
      currentUpdatedAt: string;
      current: {
        title: string;
        description: string | null;
        week_index: number;
        target_date: string | null;
        status: PlanStepActionItemRow["status"];
        outcome: string | null;
        notes: string | null;
        follow_up_date: string | null;
      };
    };

export type PlanEditActionResult =
  | { ok: true }
  | { ok: false; error: string; conflict?: PlanEditConflict };

function noPiiError(fields: PrivacyFieldInput[]): string | null {
  const result = validateNoPii(fields);
  return result.ok ? null : (result.error ?? "Remove identifying text before continuing.");
}

export type PreviewRefinePlanStepResult =
  | {
      ok: true;
      step: DraftStepRefineInput;
    }
  | { ok: false; error: string };

export type StagedPlanStartResult =
  | { ok: true; planId: string; version: number; stepCount: number }
  | { ok: false; error: string };

export type StagedPlanAdvanceResult =
  | { ok: true; status: "advanced"; done: false; phaseCompleted?: "30" | "60" | "90" }
  | { ok: true; status: "complete" | "superseded"; done: true; phaseCompleted?: "30" | "60" | "90" }
  | { ok: true; status: "busy"; done: false; retryAfter: number }
  | { ok: false; status: "failed" | "retryable"; error: string; retryAfter?: number };

async function updateStagedPlanState(
  supabase: SupabaseClient,
  input: {
    familyId: string;
    planId: string;
    generationState: PlanGenerationState;
    leaseId: string;
    aiModel: string | null;
    event?: "plan.generation_failed" | "plan.generation_finished" | "plan.generation_resumed";
    eventDetails?: Record<string, unknown>;
  },
): Promise<void> {
  const { data, error } = await supabase.rpc("update_staged_plan_state", {
    p_family_id: input.familyId,
    p_plan_id: input.planId,
    p_generation_state: input.generationState,
    p_lease_id: input.leaseId,
    p_ai_model: input.aiModel,
    p_event: input.event ?? null,
    p_event_details: input.eventDetails ?? null,
  });
  if (error || data !== true) {
    throw error ?? new Error("Staged-plan state update returned an invalid result.");
  }
}

function totalGenerationDurationMs(
  timings: PlanGenerationState["stage_timings_ms"],
): number {
  return Object.values(timings).reduce((total, duration) => {
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
      return total;
    }
    return total + duration;
  }, 0);
}

function normAiNullable(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

async function maxPlanStepSortOrder(
  supabase: SupabaseClient,
  planId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("plan_steps")
    .select("sort_order")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.sort_order === "number" ? data.sort_order : -1;
}

async function countStepsInPhase(
  supabase: SupabaseClient,
  planId: string,
  phase: "30" | "60" | "90",
): Promise<number> {
  const { count, error } = await supabase
    .from("plan_steps")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId)
    .eq("phase", phase);
  if (error) throw error;
  return count ?? 0;
}

async function appendLeanPhaseForPlan(
  supabase: SupabaseClient,
  familyId: string,
  planId: string,
  phaseSteps: LeanPlanPhaseStep[],
  sortOrderStart: number,
  planStartDate: string,
  generationState: PlanGenerationState,
  aiModel: string,
  durationMs: number,
  leaseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (phaseSteps.length === 0) {
    return { ok: false, error: "No steps to insert for this phase" };
  }

  try { await assertResourceCatalogCurrent(supabase, familyId, generationState.input_snapshot?.resource_catalog ?? []); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The resource directory could not be verified." }; }

  const rows = phaseSteps.map((lean, i) => ({
    phase: lean.phase,
    title: lean.title.trim(),
    description: lean.summary.trim(),
    sort_order: sortOrderStart + i,
    details: sparseDetailsForPersistence(lean, generationState.input_snapshot?.resource_catalog ?? []),
    priority:
      lean.priority === "urgent" ? "urgent"
      : lean.priority === "high" ? "high"
      : lean.priority === "low" ? "low"
      : "medium",
    action_items: lean.action_items.map((item, sortOrder) => ({
      title: item.title.trim(),
      description: normAiNullable(item.description as string | null | undefined),
      week_index: item.week_index,
      target_date: resolveActionTargetDate({
        planStartDate,
        weekIndex: item.week_index,
        proposedTargetDate: item.target_date,
      }),
      sort_order: sortOrder,
    })),
  }));

  const { data: appended, error } = await supabase.rpc("append_staged_plan_phase", {
    p_family_id: familyId,
    p_plan_id: planId,
    p_phase: phaseSteps[0].phase,
    p_steps: rows,
    p_generation_state: generationState,
    p_ai_model: aiModel,
    p_duration_ms: durationMs,
    p_lease_id: leaseId,
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
  if (!appended) return { ok: false, error: "This plan phase was already saved." };

  return { ok: true };
}

/**
 * Start a durable generation job without waiting for a model response. The client
 * advances the saved job independently, so a dropped response can be recovered
 * without discarding the context or duplicating a completed plan.
 */
export async function startStagedLeanPlanGeneration(input: {
  familyId: string;
  regenerationFeedback?: string;
  aiMode?: AiMode;
}): Promise<StagedPlanStartResult> {
  const parsed = stagedPlanStartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  input = parsed.data;
  let supabase: SupabaseClient;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const env = getEnv();
  if (!env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "Plan generation requires OPENAI_API_KEY" };
  }

  const detail = await getFamilyDetail(supabase, input.familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }
  const privacy = validateFamilyNoPii(detail, [
    {
      field: "regenerationFeedback",
      label: "Plan instructions",
      value: input.regenerationFeedback,
    },
  ]);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }

  let snapshot;
  try {
    snapshot = buildPlanningSnapshot(detail, input.regenerationFeedback);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not prepare the planning context." };
  }
  const snapshotPrivacy = validateNoPii([
    { field: "planningSnapshot", label: "Planning context", value: snapshot.brief },
    { field: "planningResources", label: "Resource context", value: snapshot.resources },
  ]);
  if (!snapshotPrivacy.ok) return { ok: false, error: snapshotPrivacy.error ?? "Remove identifying text before continuing." };
  const stagedMode = parseAiMode(input.aiMode);
  const generationState = {
    v: 1,
    generation_strategy: "single",
    status: "running",
    pending_phase: "30",
    input_snapshot: snapshot,
    phases_complete: { "30": false, "60": false, "90": false },
    models_used: [],
    stage_timings_ms: {},
    ai_mode: stagedMode,
  } satisfies PlanGenerationState;
  const { data: createdRaw, error: createError } = await supabase.rpc(
    "start_staged_plan_generation",
    { p_family_id: input.familyId, p_generation_state: generationState },
  );
  const created = createdRaw as { planId?: unknown; version?: unknown; existing?: unknown } | null;
  if (createError || typeof created?.planId !== "string" || typeof created.version !== "number") {
    return {
      ok: false,
      error: publicMessageFromSupabaseError(createError, "Could not create plan"),
    };
  }

  let stepCount = 0;
  if (created.existing === true) {
    const { count } = await supabase
      .from("plan_steps")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", created.planId);
    stepCount = count ?? 0;
  }

  revalidatePath(`/families/${input.familyId}`, "page");

  return {
    ok: true,
    planId: created.planId,
    version: created.version,
    stepCount,
  };
}

/** Generate one complete plan, or resume a legacy draft at its next unsaved phase. */
async function advanceStagedLeanPlanGenerationCore(input: {
  familyId: string;
  planId: string;
  /** Fallback when `generation_state.ai_mode` is missing (older rows). */
  aiMode?: AiMode;
}, leaseId: string): Promise<StagedPlanAdvanceResult> {
  let supabase: SupabaseClient;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, status: "failed", error: publicSessionError(error) };
  }

  const env = getEnv();
  if (!env.OPENAI_API_KEY?.trim()) {
    return { ok: false, status: "failed", error: "OPENAI_API_KEY required" };
  }

  const { data: planRow, error: planError } = await supabase
    .from("plans")
    .select("id, created_at, generation_state, version, ai_model")
    .eq("family_id", input.familyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError) throw planError;
  if (!planRow?.id) {
    return { ok: false, status: "failed", error: "The saved plan is unavailable. Reload the case before continuing." };
  }

  if (input.planId !== planRow.id) return { ok: true, status: "superseded", done: true };
  const activePlan = planRow;

  const rawState = activePlan.generation_state as PlanGenerationState | null | undefined;
  if (!rawState || rawState.v !== 1) {
    return { ok: true, status: "complete", done: true };
  }
  if (rawState.status === "complete") {
    return { ok: true, status: "complete", done: true };
  }
  const planId = activePlan.id as string;
  let state = { ...rawState };
  const snapshot = parsePlanningSnapshot(state.input_snapshot, input.familyId);
  if (!snapshot) {
    const error = "This draft has no valid saved planning context. Generate a new draft to restart safely.";
    await updateStagedPlanState(supabase, {
      leaseId,
      familyId: input.familyId, planId, generationState: { ...state, status: "failed", error },
      aiModel: activePlan.ai_model as string | null,
      event: "plan.generation_failed", eventDetails: { category: "missing_context" },
    });
    return { ok: false, status: "failed", error };
  }

  const singlePlan = state.generation_strategy === "single";
  const counts = {
    "30": await countStepsInPhase(supabase, planId, "30"),
    "60": singlePlan ? 0 : await countStepsInPhase(supabase, planId, "60"),
    "90": singlePlan ? 0 : await countStepsInPhase(supabase, planId, "90"),
  };
  const pendingPhase = pendingPhaseFromPersistedCounts(counts, state.generation_strategy);
  const phasesComplete = { "30": counts["30"] > 0, "60": counts["60"] > 0, "90": counts["90"] > 0 };

  async function persistState(updates: Partial<PlanGenerationState>) {
    const previousStatus = state.status;
    const next = { ...state, ...updates };
    const event =
      next.status === "failed" && previousStatus !== "failed" ? "plan.generation_failed" as const
      : next.status === "complete" && previousStatus !== "complete" ? "plan.generation_finished" as const
      : next.status === "running" && previousStatus === "failed" ? "plan.generation_resumed" as const
      : undefined;
    await updateStagedPlanState(supabase, {
      leaseId, familyId: input.familyId, planId, generationState: next,
      aiModel: [...new Set(next.models_used)].join(" · ") || (activePlan.ai_model as string | null),
      event,
      eventDetails: event === "plan.generation_finished"
        ? { duration_ms: totalGenerationDurationMs(next.stage_timings_ms) }
        : { pending_stage: next.pending_phase, category: "generation" },
    });
    state = next;
  }

  if (pendingPhase === null) {
    await persistState({ status: "complete", pending_phase: null, phases_complete: phasesComplete, error: undefined });
    revalidatePath(`/families/${input.familyId}`, "page");
    return { ok: true, status: "complete", done: true };
  }
  if (state.status === "failed" || state.pending_phase !== pendingPhase) {
    await persistState({ status: "running", pending_phase: pendingPhase, phases_complete: phasesComplete, error: undefined });
  }

  try { await assertResourceCatalogCurrent(supabase, input.familyId, snapshot.resource_catalog); }
  catch (error) {
    const message = error instanceof Error ? error.message : "The resource directory could not be verified.";
    await persistState({ status: "failed", error: message });
    return { ok: false, status: "failed", error: message };
  }
  const privacy = validateNoPii([
    { field: "planningSnapshot", label: "Planning context", value: snapshot.brief },
    { field: "planningResources", label: "Resource context", value: snapshot.resources },
  ]);
  if (!privacy.ok) {
    const error = privacy.error ?? "Remove identifying text before continuing.";
    await persistState({ status: "failed", error });
    return { ok: false, status: "failed", error };
  }

  const generationMode = parseAiMode(state.ai_mode ?? input.aiMode);
  const priorPhases = pendingPhase === "60" ? ["30"] as const : ["30", "60"] as const;
  const priorSummary = !singlePlan && pendingPhase !== "30"
    ? await fetchPriorPhasesSummaryForPlanner(supabase, planId, [...priorPhases]) : undefined;
  const started = Date.now();
  const options = {
    retries: generationMode === "fast" ? 1 : 2,
    aiMode: generationMode,
    priorPhasesSummary: priorSummary,
    requestMeta: { route: singlePlan ? "generateCompletePlan" : `stagedPlanPhase${pendingPhase}` },
    planStartDate: activePlan.created_at as string,
  };
  const result = singlePlan
    ? await tryGenerateLeanPlanOpenAI(snapshot, options)
    : await tryGenerateLeanPlanPhaseOpenAI(snapshot, pendingPhase, options);
  if (!result.ok) {
    await persistState({ status: "failed", error: result.reason });
    revalidatePath(`/families/${input.familyId}`, "page");
    return { ok: false, status: "failed", error: result.reason };
  }

  const nextPhase = singlePlan || pendingPhase === "90" ? null : pendingPhase === "30" ? "60" : "90";
  const modelsUsed = [...state.models_used, result.model];
  const durationMs = Date.now() - started;
  const nextState: PlanGenerationState = {
    ...state,
    status: nextPhase === null ? "complete" : "running",
    pending_phase: nextPhase,
    phases_complete: { ...phasesComplete, [pendingPhase]: true },
    models_used: modelsUsed,
    stage_timings_ms: { ...state.stage_timings_ms, [pendingPhase]: durationMs },
    error: undefined,
  };
  const startOrder = pendingPhase === "30" ? 0 : (await maxPlanStepSortOrder(supabase, planId)) + 1;
  const inserted = await appendLeanPhaseForPlan(
    supabase, input.familyId, planId, result.steps, startOrder,
    activePlan.created_at as string, nextState, modelsUsed.join(" · "), durationMs, leaseId,
  );
  if (!inserted.ok) {
    await persistState({ status: "failed", error: inserted.error });
    return { ok: false, status: "failed", error: inserted.error };
  }
  revalidatePath(`/families/${input.familyId}`, "page");
  return nextPhase === null
    ? { ok: true, status: "complete", done: true, phaseCompleted: pendingPhase }
    : { ok: true, status: "advanced", done: false, phaseCompleted: pendingPhase };
}

export async function advanceStagedLeanPlanGeneration(input: {
  familyId: string;
  planId: string;
  aiMode?: AiMode;
}): Promise<StagedPlanAdvanceResult> {
  const parsed = stagedPlanAdvanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: "failed", error: "Invalid request" };

  let supabase: SupabaseClient;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, status: "failed", error: publicSessionError(error) };
  }

  const jobKey = "staged-plan-advance";
  const leaseId = randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_ai_job", {
    p_family_id: parsed.data.familyId,
    p_job_key: jobKey,
    p_ttl_seconds: 600,
    p_lease_id: leaseId,
  });
  if (claimError) return { ok: false, status: "failed", error: publicMessageFromSupabaseError(claimError) };
  if (!claimed) return { ok: true, status: "busy", done: false, retryAfter: 5 };

  try {
    return await advanceStagedLeanPlanGenerationCore(parsed.data, leaseId);
  } catch (error) {
    return {
      ok: false, status: "retryable", retryAfter: 5,
      error: publicMessageFromCaughtError(
        "advanceStagedLeanPlanGeneration",
        error,
        "Could not update plan generation. Try again.",
      ),
    };
  } finally {
    const { error } = await supabase.rpc("release_ai_job", {
      p_family_id: parsed.data.familyId,
      p_job_key: jobKey,
      p_lease_id: leaseId,
    });
    if (error) logServerError("advanceStagedLeanPlanGeneration:release", error);
  }
}

/** End a failed AI job only after the case manager explicitly chooses manual preparation. */
export async function continuePlanManually(input: unknown): Promise<ActionResult> {
  const parsed = continuePlanManuallySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Reload the saved plan before continuing manually." };
  let supabase: SupabaseClient;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }
  try {
    const { data, error } = await supabase.rpc("continue_plan_manually", {
      p_family_id: parsed.data.familyId,
      p_plan_id: parsed.data.planId,
      p_expected_revision: parsed.data.expectedRevision,
    });
    if (error || data !== true) return { ok: false, error: publicMessageFromSupabaseError(error, "Could not switch this draft to manual preparation. Reload and try again.") };
    revalidatePath(`/families/${parsed.data.familyId}`, "page");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicMessageFromCaughtError("continuePlanManually", error, "Could not switch this draft to manual preparation. Reload and try again.") };
  }
}

export async function updatePlan(input: unknown): Promise<ActionResult> {
  const parsed = updatePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }
  const planPrivacyError = noPiiError([
    { field: "summary", label: "Plan summary", value: parsed.data.summary },
    {
      field: "clientDisplay.title",
      label: "Plan title",
      value: parsed.data.clientDisplay?.title,
    },
    ...Object.entries(parsed.data.clientDisplay?.phaseSummaries ?? {}).map(
      ([phase, value]) => ({
        field: `clientDisplay.phaseSummaries.${phase}`,
        label: "Plan section summary",
        value,
      }),
    ),
  ]);
  if (planPrivacyError) return { ok: false, error: planPrivacyError };

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { familyId, summary, clientDisplay } = parsed.data;
  if (summary === undefined && clientDisplay === undefined) {
    return { ok: true };
  }

  const { data: planRow } = await supabase
    .from("plans")
    .select("id, client_display")
    .eq("family_id", familyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!planRow) {
    return { ok: false, error: "Plan not found" };
  }

  const existingRaw = planRow.client_display;
  const display =
    existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? { ...(existingRaw as Record<string, unknown>) }
      : {};
  delete display.reviewedAt;
  delete display.reviewedById;

  const payload: Record<string, unknown> = {
    client_display: display,
  };
  if (summary !== undefined) {
    payload.summary = summary;
  }

  if (clientDisplay !== undefined) {
    if (clientDisplay.title !== undefined) {
      display.title = clientDisplay.title;
    }
    if (clientDisplay.phaseSummaries !== undefined) {
      const prev = (display.phaseSummaries as Record<string, unknown> | undefined) ?? {};
      display.phaseSummaries = {
        ...prev,
        ...Object.fromEntries(
          Object.entries(clientDisplay.phaseSummaries).filter(([, v]) => v !== undefined),
        ),
      };
    }
    payload.client_display = display;
  }

  const { error } = await supabase.from("plans").update(payload).eq("id", planRow.id);

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function markPlanReviewed(input: unknown): Promise<ActionResult> {
  const parsed = markPlanReviewedSchema.extend({ datesConfirmed: z.literal(true) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { familyId, planId, expectedRevision } = parsed.data;
  const family = await getFamilyDetail(supabase, familyId);
  if (!family?.plan || family.plan.id !== planId) {
    return { ok: false, error: "Plan not found" };
  }

  if (family.plan.review_revision !== expectedRevision) {
    return { ok: false, error: "The plan changed. Reload it and review the current version before approving." };
  }
  const reviewStatus = getPlanReviewStatus(family.plan);
  if (reviewStatus.state !== "needs_review" && reviewStatus.state !== "reviewed") {
    return { ok: false, error: reviewStatus.issue ?? "This plan is not ready for review." };
  }

  const { data: reviewedAt, error } = await supabase.rpc("mark_plan_reviewed", {
    p_family_id: familyId,
    p_plan_id: planId,
    p_expected_revision: expectedRevision,
    p_dates_confirmed: parsed.data.datesConfirmed,
  });
  if (error?.code === "40001") return { ok: false, error: "The plan changed. Reload it and review the current version before approving." };
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
  if (!reviewedAt) return { ok: false, error: "Plan not found or could not be reviewed." };
  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/families/${familyId}/plan`);
  revalidatePath(`/families/${familyId}/paperwork`);
  return { ok: true };
}

export async function validatePlanExport(input: unknown): Promise<ActionResult> {
  const parsed = markPlanReviewedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Reload the plan before preparing a PDF." };
  try {
    const { supabase } = await requireAppUserWithClient();
    const { data, error } = await supabase.rpc("is_reviewed_plan_revision", {
      p_family_id: parsed.data.familyId,
      p_plan_id: parsed.data.planId,
      p_expected_revision: parsed.data.expectedRevision,
    });
    if (error) return { ok: false, error: "The reviewed plan could not be checked. Please try again." };
    if (data !== true) return { ok: false, error: "The plan changed or needs review. Return to the plan, reload it, and review it before downloading." };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }
}

async function persistPlanEdits(supabase: SupabaseClient, input: import("@/lib/validations/plans").SavePlanEditsInput): Promise<PlanEditActionResult> {
  const fields: PrivacyFieldInput[] = input.steps.flatMap((edit, i) => [
    { field: `steps.${i}.title`, label: "Action title", value: edit.patch.title },
    { field: `steps.${i}.description`, label: "Action description", value: edit.patch.description },
    ...planDetailsPrivacyFields(edit.patch.details, `steps.${i}.details`),
    ...Object.entries(edit.patch.workflow_data ?? {}).flatMap(([key, value]) => typeof value === "string" ? [{ field: `steps.${i}.workflow_data.${key}`, label: "Action progress", value }] : []),
    ...edit.actionItems.flatMap((action, j) => [
      { field: `steps.${i}.actions.${j}.title`, label: "Action title", value: action.patch.title },
      { field: `steps.${i}.actions.${j}.description`, label: "Action description", value: action.patch.description },
      { field: `steps.${i}.actions.${j}.outcome`, label: "Action outcome", value: action.patch.outcome },
      { field: `steps.${i}.actions.${j}.notes`, label: "Action note", value: actionUserNotes(action.patch.notes) },
    ]),
  ]);
  const privacyError = noPiiError(fields);
  if (privacyError) return { ok: false, error: privacyError };
  const { data, error } = await supabase.rpc("save_plan_edits", {
    p_family_id: input.familyId, p_plan_id: input.planId, p_changes: input.steps,
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error, "The save could not be confirmed. Keep your edits and reload the saved plan before retrying.") };
  if (data?.ok === false) return data as PlanEditActionResult;
  if (data?.ok !== true) return { ok: false, error: "The save could not be confirmed. Keep your edits and reload the saved plan before retrying." };
  for (const path of [`/families/${input.familyId}`, `/families/${input.familyId}/plan`, `/families/${input.familyId}/paperwork`, "/families", "/calendar"]) revalidatePath(path);
  return { ok: true };
}

export async function savePlanEdits(input: unknown): Promise<PlanEditActionResult> {
  const parsed = savePlanEditsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the edited fields and reload the saved plan before retrying." };
  try {
    const { supabase } = await requireAppUserWithClient();
    return await persistPlanEdits(supabase, parsed.data);
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }
}

export async function createManualStep(input: unknown): Promise<ActionResult> {
  const parsed = createManualStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const manualStepPrivacyError = noPiiError([
    { field: "goal", label: "Goal", value: parsed.data.goal },
    { field: "title", label: "Action title", value: parsed.data.title },
    { field: "description", label: "Action description", value: parsed.data.description },
    ...planDetailsPrivacyFields(parsed.data.details as PlanStepDetails | undefined, "details"),
  ]);
  if (manualStepPrivacyError) return { ok: false, error: manualStepPrivacyError };

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { familyId, planId, goal, title, description, target_date, details } = parsed.data;

  const daysFromToday = (Date.parse(target_date) - Date.parse(schoolDate())) / 86_400_000;
  const phase: "30" | "60" | "90" =
    daysFromToday <= 30 ? "30" : daysFromToday <= 60 ? "60" : "90";

  const stepDetails = { owner: "case_manager", ...(details ?? {}), stage_goal: goal };
  const { data: newStepId, error } = await supabase.rpc("create_manual_plan_step", {
    p_family_id: familyId,
    p_plan_id: planId,
    p_phase: phase,
    p_title: title,
    p_description: description ?? "",
    p_target_date: target_date,
    p_details: stepDetails,
  });
  if (error || typeof newStepId !== "string") {
    return { ok: false, error: publicMessageFromSupabaseError(error, "The action could not be created.") };
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function deletePlanStep(input: unknown): Promise<ActionResult> {
  const parsed = deletePlanStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { stepId, familyId } = parsed.data;

  const { data: deleted, error } = await supabase.rpc("delete_plan_step", {
    p_family_id: familyId,
    p_step_id: stepId,
  });
  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  if (!deleted) return { ok: false, error: "Step not found" };

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updatePlanStepActionItem(input: unknown): Promise<PlanEditActionResult> {
  const parsed = updatePlanStepActionItemSchema.safeParse(input);
  if (!parsed.success || !parsed.data.expectedUpdatedAt) return { ok: false, error: "Invalid request" };
  try {
    const { supabase } = await requireAppUserWithClient();
    const { data: action, error: actionError } = await supabase.from("plan_step_action_items").select("plan_step_id").eq("id", parsed.data.actionItemId).maybeSingle();
    if (actionError || !action) return { ok: false, error: "The action could not be loaded. Try again." };
    const { data: step, error: stepError } = await supabase.from("plan_steps").select("id, plan_id, updated_at").eq("id", action.plan_step_id).maybeSingle();
    if (stepError || !step) return { ok: false, error: "The action could not be loaded. Try again." };
    const { familyId, actionItemId, expectedUpdatedAt, ...patch } = parsed.data;
    return await persistPlanEdits(supabase, { familyId, planId: step.plan_id, steps: [{ stepId: step.id, expectedUpdatedAt: step.updated_at, patch: {}, actionItems: [{ actionItemId, expectedUpdatedAt, patch }] }] });
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }
}

function assertCurrentRefinementDraft(current: PlanStepRow[], draft: DraftStepRefineInput[]) {
  const requested = matchPlanRowsById(current, draft);
  current.forEach((step, i) => {
    const proposed = requested[i];
    const actions = matchPlanRowsById(step.action_items ?? [], proposed.action_items);
    if (step.updated_at !== proposed.updated_at || (step.action_items ?? []).some((action, j) => action.updated_at !== actions[j].updated_at)) {
      throw new Error("The saved plan changed. Reload the latest version before requesting another preview; your edits are still here.");
    }
  });
}

/** AI revises the selected unsaved draft; applying and saving remain explicit user actions. */
export async function previewRefinePlanStep(input: unknown): Promise<PreviewRefinePlanStepResult> {
  const parsed = previewRefineStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the draft and instructions before requesting a preview." };
  let supabase;
  try { ({ supabase } = await requireAppUserWithClient()); }
  catch (error) { return { ok: false, error: publicSessionError(error) }; }
  const { familyId, stepId, feedback, aiMode } = parsed.data;
  const detail = await getFamilyDetail(supabase, familyId);
  const current = detail?.plan?.steps.find(step => step.id === stepId);
  if (!detail || !current) return { ok: false, error: "The current action could not be found." };
  if (detail.plan?.review_revision !== parsed.data.expectedRevision) return { ok: false, error: "The saved plan changed. Reload the latest version before refining." };
  const draft = { ...parsed.data.draft, details: parsed.data.draft.details ?? {} };
  try { assertCurrentRefinementDraft([current], [draft]); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Reload the current plan before refining." }; }
  const privacy = validateFamilyNoPii(detail, [
    { field: "feedback", label: "AI revision instructions", value: feedback }, ...planStepPrivacyFields(draft, "draft.steps.0"),
  ]);
  if (!privacy.ok) return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  if (!getEnv().OPENAI_API_KEY?.trim()) return { ok: false, error: "AI refinement is not configured." };
  const result = await previewRefinePlanStepsWithOpenAI(detail, [draft], feedback, {
    aiMode: parseAiMode(aiMode), requestMeta: { route: "previewRefinePlanStep" }, taskType: "step_refinement",
  });
  if (result.ok) {
    try { await assertResourceCatalogCurrent(supabase, familyId, planResourceCatalog(detail.resourceMatches, 6)); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The resource directory could not be verified." }; }
  }
  return result.ok ? { ok: true, step: result.steps[0] } : { ok: false, error: result.reason };
}

export type PreviewRefinePlanResult =
  | {
      ok: true;
      steps: DraftStepRefineInput[];
      model: string;
    }
  | { ok: false; error: string };

/** AI refines an existing *draft* plan; returns proposed steps without persisting. */
export async function previewRefinePlan(input: unknown): Promise<PreviewRefinePlanResult> {
  const parsed = previewRefinePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { familyId, feedback, draft, aiMode } = parsed.data;
  const planRefineMode = parseAiMode(aiMode);

  const detail = await getFamilyDetail(supabase, familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }
  if (detail.plan?.review_revision !== parsed.data.expectedRevision) return { ok: false, error: "The saved plan changed. Reload the latest version before refining." };
  try {
    assertCurrentRefinementDraft(detail.plan?.steps ?? [], draft.steps.map(step => ({ ...step, details: step.details ?? {} })));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The current plan changed. Reload before requesting another preview." };
  }
  const draftSteps: DraftStepRefineInput[] = draft.steps.map(step => ({ ...step, details: step.details ?? {} }));
  const privacy = validateFamilyNoPii(detail, [
    { field: "feedback", label: "AI revision instructions", value: feedback }, ...draftSteps.flatMap((step,index)=>planStepPrivacyFields(step, `draft.steps.${index}`)),
  ]);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }

  const env = getEnv();
  if (!env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "AI refinement requires OPENAI_API_KEY" };
  }

  const result = await previewRefinePlanStepsWithOpenAI(
    detail,
    draftSteps,
    feedback,
    {
      aiMode: planRefineMode,
      requestMeta: { route: "previewRefinePlan" },
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  try { await assertResourceCatalogCurrent(supabase, familyId, planResourceCatalog(detail.resourceMatches, 6)); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The resource directory could not be verified." }; }

  return {
    ok: true,
    model: result.model,
    steps: result.steps,
  };
}
