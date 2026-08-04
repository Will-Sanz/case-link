"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { publicSessionError } from "@/lib/auth/session-errors";
import type { AiMode } from "@/lib/ai/ai-mode";
import { parseAiMode } from "@/lib/ai/ai-mode";
import { getEnv } from "@/lib/env";
import { generatePlanSteps } from "@/lib/plan-generator";
import {
  capStepsPerPhase,
  MAX_PLAN_STEPS_PER_PHASE,
  shouldLogPlanRegenerate,
  tryGeneratePlanStepsWithOpenAI,
  previewRefinePlanStepsWithOpenAI,
} from "@/lib/plan-generator/openai-plan";
import {
  generatedStepsFromMatches,
  mergeResourceAndRulesSteps,
} from "@/lib/plan-generator/resource-context";
import { ensureActionItems } from "@/lib/plan-generator/derive-action-items";
import { sparseDetailsForPersistence, type LeanPlanPhaseStep } from "@/lib/plan-generator/lean-plan-schema";
import { fetchPriorPhasesSummaryForPlanner } from "@/lib/plan-generator/prior-phase-summary";
import { tryGenerateLeanPlanPhaseOpenAI } from "@/lib/plan-generator/openai-plan-lean-phase";
import { buildPlanningBrief } from "@/lib/plan-generator/planning-brief";
import { resolveActionTargetDate } from "@/lib/domain/plan/action-target-date";
import {
  actionUserNotes,
  encodeActionNotes,
  isActionNoLongerNeeded,
} from "@/lib/domain/plan/action-state";
import { pendingPhaseFromPersistedCounts } from "@/lib/domain/plan/generation-progress";
import { getPlanReviewStatus } from "@/lib/domain/plan/review-status";
import {
  publicMessageFromCaughtError,
  publicMessageFromSupabaseError,
} from "@/lib/errors/public-action-error";
import { logServerError } from "@/lib/logger/server-error";
import {
  validateFamilyNoPii,
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
  refineStepWithOpenAI,
  type RefineStepResult,
} from "@/lib/plan-generator/openai-refine-step";
import {
  createManualStepSchema,
  deletePlanStepSchema,
  generatePlanSchema,
  stagedPlanAdvanceSchema,
  stagedPlanStartSchema,
  markPlanReviewedSchema,
  previewRefineStepSchema,
  previewRefinePlanSchema,
  toggleChecklistItemSchema,
  updatePlanSchema,
  updatePlanStepActionItemSchema,
  updatePlanStepSchema,
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
  | { ok: true; updatedAt?: string }
  | { ok: false; error: string; conflict?: PlanEditConflict };

function noPiiError(fields: PrivacyFieldInput[]): string | null {
  const result = validateNoPii(fields);
  return result.ok ? null : (result.error ?? "Remove identifying text before continuing.");
}

function planDetailsPrivacyFields(
  details: PlanStepDetails | null | undefined,
  prefix: string,
): PrivacyFieldInput[] {
  if (!details) return [];
  const singular: Array<[keyof PlanStepDetails, string]> = [
    ["action_needed_now", "Immediate action"],
    ["rationale", "Rationale"],
    ["detailed_instructions", "Instructions"],
    ["expected_outcome", "Expected outcome"],
    ["timing_guidance", "Timing guidance"],
    ["stage_goal", "Goal"],
    ["why_now", "Why now"],
    ["depends_on", "Dependency"],
    ["success_marker", "Success marker"],
  ];
  const fields: PrivacyFieldInput[] = singular.map(([key, label]) => ({
    field: `${prefix}.${key}`,
    label,
    value: typeof details[key] === "string" ? details[key] as string : null,
  }));
  const lists: Array<[keyof PlanStepDetails, string]> = [
    ["checklist", "Checklist item"],
    ["required_documents", "Required document"],
    ["materials_needed", "Required material"],
    ["blockers", "Blocker"],
    ["fallback_options", "Fallback option"],
  ];
  for (const [key, label] of lists) {
    const values = details[key];
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => {
      if (typeof value === "string") {
        fields.push({ field: `${prefix}.${key}.${index}`, label, value });
      }
    });
  }
  return fields;
}

export type PreviewRefinePlanStepResult =
  | {
      ok: true;
      step: NonNullable<Extract<RefineStepResult, { ok: true }>["step"]>;
    }
  | { ok: false; error: string };

/** Result of generatePlan, includes planId on success for client verification. */
export type GeneratePlanResult =
  | { ok: true; planId: string; version: number; stepCount: number }
  | { ok: false; error: string };

export type StagedPlanStartResult =
  | { ok: true; planId: string; version: number; stepCount: number }
  | { ok: false; error: string };

export type StagedPlanAdvanceResult =
  | { ok: true; done: boolean; phaseCompleted?: "30" | "60" | "90" }
  | { ok: false; error: string };

async function logCaseActivity(
  supabase: SupabaseClient,
  familyId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>,
) {
  const { error } = await supabase.rpc("record_activity_event", {
    p_family_id: familyId,
    p_action: action,
    p_entity_type: entityType ?? null,
    p_entity_id: entityId ?? null,
    p_details: details ?? null,
  });
  // These application-source timeline hints are not the authoritative audit stream.
  // Never report a saved edit as failed because a later best-effort hint was unavailable.
  if (error) logServerError("plans:product-timeline", error);
}

async function updateStagedPlanState(
  supabase: SupabaseClient,
  input: {
    familyId: string;
    planId: string;
    generationState: PlanGenerationState;
    aiModel: string | null;
    event?: "plan.generation_failed" | "plan.generation_finished" | "plan.generation_resumed";
    eventDetails?: Record<string, unknown>;
  },
): Promise<void> {
  const { data, error } = await supabase.rpc("update_staged_plan_state", {
    p_family_id: input.familyId,
    p_plan_id: input.planId,
    p_generation_state: input.generationState,
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
  const { data } = await supabase
    .from("plan_steps")
    .select("sort_order")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
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
  if (error) return 0;
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (phaseSteps.length === 0) {
    return { ok: false, error: "No steps to insert for this phase" };
  }

  const rows = phaseSteps.map((lean, i) => ({
    phase: lean.phase,
    title: lean.title.trim(),
    description: lean.summary.trim(),
    sort_order: sortOrderStart + i,
    details: sparseDetailsForPersistence(lean),
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
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
  if (!appended) return { ok: false, error: "This plan phase was already saved." };

  return { ok: true };
}

export async function generatePlan(input: unknown): Promise<GeneratePlanResult> {
  const parsed = generatePlanSchema.safeParse(input);
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

  const { familyId, regenerationFeedback, regenerateExistingPlan, aiMode } = parsed.data;
  const planAiMode = parseAiMode(aiMode);
  const logRegen = shouldLogPlanRegenerate();
  if (logRegen) {
    const fb = regenerationFeedback?.trim();
    console.info("[generatePlan] start", {
      familyId,
      regenerateExistingPlan: Boolean(regenerateExistingPlan),
      hasRegenerationFeedback: Boolean(fb),
      regenerationFeedbackChars: fb?.length ?? 0,
    });
  }

  const detail = await getFamilyDetail(supabase, familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }
  const privacy = validateFamilyNoPii(detail, [
    {
      field: "regenerationFeedback",
      label: "Plan instructions",
      value: regenerationFeedback,
    },
  ]);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }

  const logPrefix = "[generatePlan]";

  const rulesSteps = generatePlanSteps({
    goals: detail.goals.map((g) => ({ preset_key: g.preset_key, label: g.label })),
    barriers: detail.barriers.map((b) => ({
      preset_key: b.preset_key,
      label: b.label,
    })),
  });
  const resourceSteps = generatedStepsFromMatches(detail.resourceMatches);
  const rulesStepsMerged = mergeResourceAndRulesSteps(
    resourceSteps,
    rulesSteps,
  );

  const env = getEnv();
  const apiKey = env.OPENAI_API_KEY?.trim();
  const mustUseAi = Boolean(regenerateExistingPlan);

  if (mustUseAi && !apiKey) {
    return {
      ok: false,
      error:
        "Regenerating a plan requires AI. Add OPENAI_API_KEY to your environment and restart the server.",
    };
  }

  let steps = rulesStepsMerged;
  let generationSource: "openai" | "rules" = "rules";
  let aiModel: string | null = null;

  if (apiKey) {
    const ai = await tryGeneratePlanStepsWithOpenAI(detail, {
      regenerationFeedback: regenerationFeedback?.trim() || undefined,
      fullRegeneration: mustUseAi,
      retries: 1,
      aiMode: planAiMode,
      requestMeta: { route: "generatePlan" },
    });
    if (ai.ok && ai.steps.length > 0) {
      steps = ai.steps;
      generationSource = "openai";
      aiModel = ai.model;
      if (logRegen) {
        console.info("[generatePlan] using OpenAI steps", {
          model: ai.model,
          stepCount: ai.steps.length,
        });
      }
    } else if (mustUseAi) {
      const msg =
        !ai.ok ?
          `Plan regeneration failed: ${ai.reason}`
        : "The AI returned no steps. Try again, or shorten your regeneration notes.";
      logServerError(
        `${logPrefix}:required-ai`,
        new Error(!ai.ok ? ai.reason : "AI returned zero plan steps"),
      );
      return { ok: false, error: msg };
    } else if (logRegen) {
      if (!ai.ok) {
        console.warn(`${logPrefix} OpenAI failed, using rules fallback:`, ai.reason);
      } else if (ai.steps.length === 0) {
        console.warn(`${logPrefix} OpenAI returned zero steps, using rules fallback`);
      }
      console.info("[generatePlan] OpenAI branch not used for final steps", {
        aiOk: ai.ok,
        aiStepCount: ai.ok ? ai.steps.length : 0,
        aiReason: ai.ok ? null : ai.reason,
        rulesMergedStepCount: rulesStepsMerged.length,
      });
    }
  }

  if (logRegen) {
    console.info("[generatePlan] steps after AI/rules (before cap/sort)", {
      generationSource,
      stepCount: steps.length,
    });
  }

  steps = capStepsPerPhase(steps, MAX_PLAN_STEPS_PER_PHASE);
  steps.forEach((s, i) => {
    s.sort_order = i;
  });
  steps = ensureActionItems(steps);
  if (steps.length === 0) return { ok: false, error: "No plan steps were generated." };

  const approximatePlanStart = new Date().toISOString();
  const { data: createdRaw, error: createError } = await supabase.rpc("create_plan_with_steps", {
    p_family_id: familyId,
    p_generation_source: generationSource,
    p_ai_model: aiModel,
    p_steps: steps.map((step) => ({
      phase: step.phase,
      title: step.title,
      description: step.description,
      sort_order: step.sort_order,
      priority: step.details.priority,
      details: step.details,
      action_items: (step.action_items ?? []).map((item, sortOrder) => ({
        title: item.title,
        description: item.description ?? null,
        week_index: item.week_index,
        target_date: resolveActionTargetDate({
          planStartDate: approximatePlanStart,
          weekIndex: item.week_index,
          proposedTargetDate: item.target_date,
        }),
        sort_order: sortOrder,
      })),
    })),
  });
  const created = createdRaw as {
    planId?: unknown;
    version?: unknown;
    stepCount?: unknown;
  } | null;
  if (
    createError ||
    typeof created?.planId !== "string" ||
    typeof created.version !== "number" ||
    typeof created.stepCount !== "number"
  ) {
    logServerError(`${logPrefix}:create-plan`, createError ?? new Error("invalid RPC result"));
    return { ok: false, error: publicMessageFromSupabaseError(createError, "Could not create plan") };
  }

  revalidatePath(`/families/${familyId}`, "page");

  if (logRegen) {
    console.info("[generatePlan] returning to client", {
      ok: true,
      planId: created.planId,
      version: created.version,
      stepCount: created.stepCount,
      generationSource,
    });
  }

  return {
    ok: true,
    planId: created.planId,
    version: created.version,
    stepCount: created.stepCount,
  };
}

/**
 * Start a durable generation job without waiting for a model response. The client
 * advances each stage independently, so navigation or a dropped request never
 * discards already-saved work.
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

  const brief = buildPlanningBrief(detail, input.regenerationFeedback);
  const stagedMode = parseAiMode(input.aiMode);
  const generationState = {
    v: 1,
    status: "running",
    pending_phase: "30",
    planning_brief: brief,
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

/** Run the next pending phase (60 or 90) or finalize state. Idempotent if phases already inserted. */
async function advanceStagedLeanPlanGenerationCore(input: {
  familyId: string;
  /** Fallback when `generation_state.ai_mode` is missing (older rows). */
  aiMode?: AiMode;
}): Promise<StagedPlanAdvanceResult> {
  let supabase: SupabaseClient;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const env = getEnv();
  if (!env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "OPENAI_API_KEY required" };
  }

  const { data: planRow } = await supabase
    .from("plans")
    .select("id, created_at, generation_state, version, ai_model")
    .eq("family_id", input.familyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!planRow?.id) {
    return { ok: true, done: true };
  }

  const activePlan = planRow;

  const rawState = activePlan.generation_state as PlanGenerationState | null | undefined;
  if (!rawState || rawState.v !== 1) {
    return { ok: true, done: true };
  }
  if (rawState.status === "complete") {
    return { ok: true, done: true };
  }
  const planId = activePlan.id as string;
  let state = { ...rawState };

  if (state.status === "failed") {
    const n30 = await countStepsInPhase(supabase, planId, "30");
    const n60 = await countStepsInPhase(supabase, planId, "60");
    const n90 = await countStepsInPhase(supabase, planId, "90");
    const recoveredPendingPhase = pendingPhaseFromPersistedCounts({
      "30": n30,
      "60": n60,
      "90": n90,
    });
    if (recoveredPendingPhase === null) {
      const completedState: PlanGenerationState = {
        ...state,
        status: "complete",
        pending_phase: null,
        phases_complete: { "30": true, "60": true, "90": true },
        error: undefined,
      };
      await updateStagedPlanState(supabase, {
        familyId: input.familyId,
        planId,
        generationState: completedState,
        aiModel: activePlan.ai_model as string | null,
        event: "plan.generation_finished",
        eventDetails: {
          recovered: true,
          duration_ms: totalGenerationDurationMs(state.stage_timings_ms),
        },
      });
      return { ok: true, done: true };
    }
    state = {
      ...state,
      status: "running",
      pending_phase: recoveredPendingPhase,
      phases_complete: {
        "30": n30 > 0,
        "60": n60 > 0,
        "90": n90 > 0,
      },
      error: undefined,
    };
    await updateStagedPlanState(supabase, {
      familyId: input.familyId,
      planId,
      generationState: state as PlanGenerationState,
      aiModel: activePlan.ai_model as string | null,
      event: "plan.generation_resumed",
      eventDetails: { pending_stage: recoveredPendingPhase },
    });
  }
  const generationMode = parseAiMode(state.ai_mode ?? input.aiMode);
  const detail = await getFamilyDetail(supabase, input.familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }
  const privacy = validateFamilyNoPii(detail, [
    {
      field: "planningBrief",
      label: "Plan context",
      value: state.planning_brief,
    },
  ]);
  if (!privacy.ok) {
    const failedState: PlanGenerationState = {
      ...state,
      status: "failed",
      error: "Remove identifying text from the family record before generating the plan.",
    };
    await updateStagedPlanState(supabase, {
      familyId: input.familyId,
      planId,
      generationState: failedState,
      aiModel: activePlan.ai_model as string | null,
      event: "plan.generation_failed",
      eventDetails: { pending_stage: state.pending_phase, category: "privacy_check" },
    });
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }

  async function persistState(updates: Partial<PlanGenerationState>, summaryUpdate?: string | null) {
    const previousStatus = state.status;
    const next = { ...state, ...updates };
    state = next as PlanGenerationState;
    const generationState = {
      ...next,
      ...(summaryUpdate !== undefined ? { summary: summaryUpdate } : {}),
    } as PlanGenerationState;
    const event =
      next.status === "failed" && previousStatus !== "failed" ? "plan.generation_failed" as const
      : next.status === "complete" && previousStatus !== "complete" ? "plan.generation_finished" as const
      : undefined;
    await updateStagedPlanState(supabase, {
      familyId: input.familyId,
      planId,
      generationState,
      aiModel: [...new Set(next.models_used)].join(" · ") || (activePlan.ai_model as string | null),
      event,
      eventDetails:
        event === "plan.generation_failed" ? { pending_stage: next.pending_phase, category: "generation" }
        : event === "plan.generation_finished" ? { duration_ms: totalGenerationDurationMs(next.stage_timings_ms) }
        : undefined,
    });
  }

  if (state.pending_phase === "30") {
    const n30 = await countStepsInPhase(supabase, planId, "30");
    if (n30 > 0) {
      await persistState({
        pending_phase: "60",
        phases_complete: { ...state.phases_complete, "30": true },
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: true, done: false, phaseCompleted: "30" };
    }

    const t = Date.now();
    const res = await tryGenerateLeanPlanPhaseOpenAI(detail, "30", {
      regenerationFeedback: state.planning_brief,
      retries: generationMode === "fast" ? 1 : 2,
      aiMode: generationMode,
      requestMeta: { route: "stagedPlanPhase30" },
      planStartDate: activePlan.created_at as string,
    });
    if (!res.ok) {
      await persistState({ status: "failed", error: res.reason });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: false, error: res.reason };
    }
    const steps = res.steps
      .map((step) => ({ ...step, phase: "30" as const }))
      .slice(0, MAX_PLAN_STEPS_PER_PHASE);
    if (steps.length === 0) {
      const error = "The planning assistant returned no initial actions.";
      await persistState({ status: "failed", error });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: false, error };
    }
    const modelsUsed = [...state.models_used, res.model];
    const durationMs = Date.now() - t;
    const nextState: PlanGenerationState = {
      ...state,
      pending_phase: "60",
      phases_complete: { ...state.phases_complete, "30": true },
      models_used: modelsUsed,
      stage_timings_ms: { ...state.stage_timings_ms, "30": durationMs },
    };
    const ins = await appendLeanPhaseForPlan(
      supabase,
      input.familyId,
      planId,
      steps,
      0,
      activePlan.created_at as string,
      nextState,
      modelsUsed.join(" · "),
      durationMs,
    );
    if (!ins.ok) {
      await persistState({ status: "failed", error: ins.error });
      return { ok: false, error: ins.error };
    }
    state = nextState;
    revalidatePath(`/families/${input.familyId}`, "page");
    return { ok: true, done: false, phaseCompleted: "30" };
  }

  // Heal: if DB already has steps for pending phase, advance state only
  if (state.pending_phase === "60") {
    const n60 = await countStepsInPhase(supabase, planId, "60");
    if (n60 > 0) {
      await persistState({
        pending_phase: "90",
        phases_complete: { ...state.phases_complete, "60": true },
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: true, done: false, phaseCompleted: "60" };
    }

    const priorFor60 = await fetchPriorPhasesSummaryForPlanner(supabase, planId, ["30"]);
    const t = Date.now();
    const res = await tryGenerateLeanPlanPhaseOpenAI(detail, "60", {
      regenerationFeedback: state.planning_brief,
      retries: generationMode === "fast" ? 1 : 2,
      aiMode: generationMode,
      priorPhasesSummary: priorFor60 || undefined,
      requestMeta: { route: "stagedPlanPhase60" },
      planStartDate: activePlan.created_at as string,
    });
    if (!res.ok) {
      await persistState({ status: "failed", error: res.reason });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: false, error: res.reason };
    }
    const steps = res.steps
      .map((s) => ({ ...s, phase: "60" as const }))
      .slice(0, MAX_PLAN_STEPS_PER_PHASE);
    if (steps.length === 0) {
      await persistState({
        status: "failed",
        error: "AI returned no steps for the 60-day phase.",
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: false, error: "AI returned no steps for the 60-day phase." };
    }
    const start = (await maxPlanStepSortOrder(supabase, planId)) + 1;
    const models_used = [...state.models_used, res.model];
    const durationMs = Date.now() - t;
    const nextState: PlanGenerationState = {
      ...state,
      pending_phase: "90",
      phases_complete: { ...state.phases_complete, "60": true },
      models_used,
      stage_timings_ms: { ...state.stage_timings_ms, "60": durationMs },
    };
    const ins = await appendLeanPhaseForPlan(
      supabase,
      input.familyId,
      planId,
      steps,
      start,
      activePlan.created_at as string,
      nextState,
      models_used.join(" · "),
      durationMs,
    );
    if (!ins.ok) {
      await persistState({ status: "failed", error: ins.error });
      return { ok: false, error: ins.error };
    }
    state = nextState;
    revalidatePath(`/families/${input.familyId}`, "page");
    return { ok: true, done: false, phaseCompleted: "60" };
  }

  if (state.pending_phase === "90") {
    const n90 = await countStepsInPhase(supabase, planId, "90");
    if (n90 > 0) {
      await persistState({
        pending_phase: null,
        status: "complete",
        phases_complete: { ...state.phases_complete, "90": true },
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: true, done: true, phaseCompleted: "90" };
    }

    const priorFor90 = await fetchPriorPhasesSummaryForPlanner(supabase, planId, ["30", "60"]);
    const t = Date.now();
    const res = await tryGenerateLeanPlanPhaseOpenAI(detail, "90", {
      regenerationFeedback: state.planning_brief,
      retries: generationMode === "fast" ? 1 : 2,
      aiMode: generationMode,
      priorPhasesSummary: priorFor90 || undefined,
      requestMeta: { route: "stagedPlanPhase90" },
      planStartDate: activePlan.created_at as string,
    });
    if (!res.ok) {
      await persistState({ status: "failed", error: res.reason });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: false, error: res.reason };
    }
    const steps = res.steps
      .map((s) => ({ ...s, phase: "90" as const }))
      .slice(0, MAX_PLAN_STEPS_PER_PHASE);
    if (steps.length === 0) {
      await persistState({
        status: "failed",
        error: "AI returned no steps for the 90-day phase.",
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: false, error: "AI returned no steps for the 90-day phase." };
    }
    const start = (await maxPlanStepSortOrder(supabase, planId)) + 1;
    const models_used = [...state.models_used, res.model];
    const durationMs = Date.now() - t;
    const nextState: PlanGenerationState = {
      ...state,
      pending_phase: null,
      status: "complete",
      phases_complete: { ...state.phases_complete, "90": true },
      models_used,
      stage_timings_ms: { ...state.stage_timings_ms, "90": durationMs },
    };
    const ins = await appendLeanPhaseForPlan(
      supabase,
      input.familyId,
      planId,
      steps,
      start,
      activePlan.created_at as string,
      nextState,
      models_used.join(" · "),
      durationMs,
    );
    if (!ins.ok) {
      await persistState({ status: "failed", error: ins.error });
      return { ok: false, error: ins.error };
    }
    state = nextState;
    revalidatePath(`/families/${input.familyId}`, "page");
    return { ok: true, done: true, phaseCompleted: "90" };
  }

  // Corrupt, raced, or legacy state: recover from the rows already persisted.
  if (state.status === "running") {
    const n30 = await countStepsInPhase(supabase, planId, "30");
    const n60 = await countStepsInPhase(supabase, planId, "60");
    const n90 = await countStepsInPhase(supabase, planId, "90");
    const recoveredPendingPhase = pendingPhaseFromPersistedCounts({
      "30": n30,
      "60": n60,
      "90": n90,
    });

    if (recoveredPendingPhase === null) {
      await persistState({
        pending_phase: null,
        status: "complete",
        phases_complete: { "30": true, "60": true, "90": true },
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: true, done: true };
    }
    if (recoveredPendingPhase === "90") {
      await persistState({
        pending_phase: "90",
        phases_complete: { ...state.phases_complete, "60": true },
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: true, done: false };
    }
    if (recoveredPendingPhase === "60") {
      await persistState({
        pending_phase: "60",
        phases_complete: { ...state.phases_complete, "30": true },
      });
      revalidatePath(`/families/${input.familyId}`, "page");
      return { ok: true, done: false };
    }

    await persistState({
      pending_phase: recoveredPendingPhase,
      phases_complete: { "30": false, "60": false, "90": false },
    });
    revalidatePath(`/families/${input.familyId}`, "page");
    return { ok: true, done: false };
  }

  revalidatePath(`/families/${input.familyId}`, "page");
  return { ok: true, done: true };
}

export async function advanceStagedLeanPlanGeneration(input: {
  familyId: string;
  aiMode?: AiMode;
}): Promise<StagedPlanAdvanceResult> {
  const parsed = stagedPlanAdvanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  let supabase: SupabaseClient;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const jobKey = "staged-plan-advance";
  const { data: claimed, error: claimError } = await supabase.rpc("claim_ai_job", {
    p_family_id: parsed.data.familyId,
    p_job_key: jobKey,
    p_ttl_seconds: 300,
  });
  if (claimError) return { ok: false, error: publicMessageFromSupabaseError(claimError) };
  if (!claimed) return { ok: false, error: "Plan generation is already running." };

  try {
    try {
      return await advanceStagedLeanPlanGenerationCore(parsed.data);
    } catch (error) {
      return {
        ok: false,
        error: publicMessageFromCaughtError(
          "advanceStagedLeanPlanGeneration",
          error,
          "Could not update plan generation. Try again.",
        ),
      };
    }
  } finally {
    const { error } = await supabase.rpc("release_ai_job", {
      p_family_id: parsed.data.familyId,
      p_job_key: jobKey,
    });
    if (error) logServerError("advanceStagedLeanPlanGeneration:release", error);
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
  const parsed = markPlanReviewedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { familyId, planId } = parsed.data;
  const family = await getFamilyDetail(supabase, familyId);
  if (!family?.plan || family.plan.id !== planId) {
    return { ok: false, error: "Plan not found" };
  }

  const reviewStatus = getPlanReviewStatus(family.plan);
  if (reviewStatus.state === "reviewed") return { ok: true };
  if (reviewStatus.state !== "needs_review") {
    return { ok: false, error: reviewStatus.issue ?? "This plan is not ready for review." };
  }

  const { data: reviewedAt, error } = await supabase.rpc("mark_plan_reviewed", {
    p_family_id: familyId,
    p_plan_id: planId,
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
  if (!reviewedAt) return { ok: false, error: "Plan not found or could not be reviewed." };
  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/families/${familyId}/plan`);
  revalidatePath(`/families/${familyId}/paperwork`);
  return { ok: true };
}

export async function updatePlanStep(
  input: unknown,
): Promise<PlanEditActionResult> {
  const parsed = updatePlanStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }
  const stepPrivacyError = noPiiError([
    { field: "title", label: "Action title", value: parsed.data.title },
    { field: "description", label: "Action description", value: parsed.data.description },
    ...planDetailsPrivacyFields(parsed.data.details as PlanStepDetails | undefined, "details"),
    {
      field: "workflow_data.blocker_reason",
      label: "Blocker reason",
      value: parsed.data.workflow_data?.blocker_reason,
    },
    {
      field: "workflow_data.outcome_notes",
      label: "Outcome notes",
      value: parsed.data.workflow_data?.outcome_notes,
    },
  ]);
  if (stepPrivacyError) return { ok: false, error: stepPrivacyError };

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { stepId, familyId, expectedUpdatedAt, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  const { data: planRow } = await supabase
    .from("plans")
    .select("id")
    .eq("family_id", familyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!planRow) {
    return { ok: false, error: "Plan not found" };
  }

  if (expectedUpdatedAt) {
    const { data: currentStep } = await supabase
      .from("plan_steps")
      .select("title, description, status, phase, priority, details, workflow_data, updated_at")
      .eq("id", stepId)
      .eq("plan_id", planRow.id)
      .maybeSingle();
    if (!currentStep) return { ok: false, error: "Action not found" };
    if (currentStep.updated_at !== expectedUpdatedAt) {
      return {
        ok: false,
        error:
          "This action changed in another tab. Compare both versions before choosing which one to keep.",
        conflict: {
          kind: "step",
          entityId: stepId,
          currentUpdatedAt: currentStep.updated_at,
          current: {
            title: currentStep.title,
            description: currentStep.description,
            status: currentStep.status,
            phase: currentStep.phase,
            priority: currentStep.priority,
            details: currentStep.details as PlanStepDetails | null,
            workflow_data: currentStep.workflow_data as PlanStepRow["workflow_data"],
          },
        },
      };
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (patch.title !== undefined) updatePayload.title = patch.title;
  if (patch.description !== undefined)
    updatePayload.description = patch.description;
  if (patch.status !== undefined) updatePayload.status = patch.status;
  if (patch.details !== undefined) updatePayload.details = patch.details;
  if (patch.workflow_data !== undefined)
    updatePayload.workflow_data = patch.workflow_data;
  if (patch.priority !== undefined) updatePayload.priority = patch.priority;
  if (patch.phase !== undefined) updatePayload.phase = patch.phase;
  if (patch.sort_order !== undefined) updatePayload.sort_order = patch.sort_order;

  let updateQuery = supabase
    .from("plan_steps")
    .update(updatePayload)
    .eq("id", stepId)
    .eq("plan_id", planRow.id);
  if (expectedUpdatedAt) updateQuery = updateQuery.eq("updated_at", expectedUpdatedAt);
  const { data: updatedRows, error } = await updateQuery.select("id, updated_at");

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  if (!updatedRows?.length) {
    const { data: latestStep } = await supabase
      .from("plan_steps")
      .select("title, description, status, phase, priority, details, workflow_data, updated_at")
      .eq("id", stepId)
      .eq("plan_id", planRow.id)
      .maybeSingle();
    if (latestStep) {
      return {
        ok: false,
        error:
          "This action changed in another tab. Compare both versions before choosing which one to keep.",
        conflict: {
          kind: "step",
          entityId: stepId,
          currentUpdatedAt: latestStep.updated_at,
          current: {
            title: latestStep.title,
            description: latestStep.description,
            status: latestStep.status,
            phase: latestStep.phase,
            priority: latestStep.priority,
            details: latestStep.details as PlanStepDetails | null,
            workflow_data: latestStep.workflow_data as PlanStepRow["workflow_data"],
          },
        },
      };
    }
    return { ok: false, error: "Action not found or could not be updated." };
  }

  await logCaseActivity(
    supabase,
    familyId,
    "step.updated",
    "plan_step",
    stepId,
    { plan_id: planRow.id, changed_fields: Object.keys(updatePayload) },
  );

  if (patch.status !== undefined) {
    await logCaseActivity(
      supabase,
      familyId,
      "step.status_changed",
      "plan_step",
      stepId,
      { status: patch.status },
    );
  }
  if (patch.workflow_data !== undefined && (patch.workflow_data as { needs_escalation?: boolean })?.needs_escalation) {
    await logCaseActivity(supabase, familyId, "step.escalation_flagged", "plan_step", stepId);
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true, updatedAt: updatedRows[0]?.updated_at as string | undefined };
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

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(`${target_date}T00:00:00.000Z`);
  const [targetYear, targetMonth, targetDay] = target_date.split("-").map(Number);
  if (
    Number.isNaN(target.getTime()) ||
    target.getUTCFullYear() !== targetYear ||
    target.getUTCMonth() !== targetMonth - 1 ||
    target.getUTCDate() !== targetDay
  ) {
    return { ok: false, error: "Choose a valid target date." };
  }
  const daysFromToday = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
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

export async function toggleChecklistItem(input: unknown): Promise<ActionResult> {
  const parsed = toggleChecklistItemSchema.safeParse(input);
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

  const { stepId, familyId, checklistIndex, completed } = parsed.data;

  const { data: step } = await supabase
    .from("plan_steps")
    .select("plan_id, details, workflow_data")
    .eq("id", stepId)
    .maybeSingle();

  if (!step) {
    return { ok: false, error: "Step not found" };
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("family_id")
    .eq("id", step.plan_id)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!plan) {
    return { ok: false, error: "Step not found" };
  }

  const details = (step.details as { checklist?: string[] }) ?? {};
  const checklist = details.checklist ?? [];
  const wd = (step.workflow_data as { checklist_completed?: boolean[] }) ?? {};
  const completedArr = wd.checklist_completed ?? Array(checklist.length).fill(false);

  if (checklistIndex >= checklist.length) {
    return { ok: false, error: "Invalid checklist index" };
  }

  const next = [...completedArr];
  while (next.length <= checklistIndex) {
    next.push(false);
  }
  next[checklistIndex] = completed;

  // Auto-update step status from checklist progress
  const completedCount = next.filter(Boolean).length;
  const totalRequired = checklist.length;
  const allComplete = totalRequired > 0 && completedCount >= totalRequired;
  const someComplete = completedCount > 0;

  const { data: stepForStatus } = await supabase
    .from("plan_steps")
    .select("status")
    .eq("id", stepId)
    .single();

  const currentStatus = (stepForStatus?.status as string) ?? "pending";
  let statusUpdate: string | undefined;

  if (allComplete && currentStatus !== "completed" && currentStatus !== "blocked") {
    statusUpdate = "completed";
  } else if (someComplete && currentStatus === "pending" && !allComplete) {
    statusUpdate = "in_progress";
  }

  const updatePayload: Record<string, unknown> = {
    workflow_data: { ...wd, checklist_completed: next },
  };
  if (statusUpdate) updatePayload.status = statusUpdate;

  const { error } = await supabase
    .from("plan_steps")
    .update(updatePayload)
    .eq("id", stepId);

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  if (statusUpdate && plan) {
    await logCaseActivity(
      supabase,
      familyId,
      "step.status_changed",
      "plan_step",
      stepId,
      { status: statusUpdate, source: "checklist_auto" },
    );
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updatePlanStepActionItem(input: unknown): Promise<PlanEditActionResult> {
  const parsed = updatePlanStepActionItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }
  const actionPrivacyError = noPiiError([
    { field: "title", label: "Action title", value: parsed.data.title },
    {
      field: "description",
      label: "Action description",
      value: parsed.data.description,
    },
    { field: "outcome", label: "Action outcome", value: parsed.data.outcome },
    { field: "notes", label: "Action note", value: actionUserNotes(parsed.data.notes) },
  ]);
  if (actionPrivacyError) return { ok: false, error: actionPrivacyError };

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { actionItemId, familyId, status, expectedUpdatedAt } = parsed.data;

  const { data: ai } = await supabase
    .from("plan_step_action_items")
    .select(
      "plan_step_id, title, description, week_index, target_date, status, outcome, notes, follow_up_date, updated_at",
    )
    .eq("id", actionItemId)
    .maybeSingle();

  if (!ai) {
    return { ok: false, error: "Action item not found" };
  }
  const { data: step } = await supabase
    .from("plan_steps")
    .select("plan_id")
    .eq("id", ai.plan_step_id)
    .maybeSingle();

  if (!step) {
    return { ok: false, error: "Step not found" };
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("family_id")
    .eq("id", step.plan_id)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!plan) {
    return { ok: false, error: "Action item not found" };
  }

  if (expectedUpdatedAt && ai.updated_at !== expectedUpdatedAt) {
    return {
      ok: false,
      error:
        "This action changed in another tab. Compare both versions before choosing which one to keep.",
      conflict: {
        kind: "action_item",
        entityId: actionItemId,
        currentUpdatedAt: ai.updated_at,
        current: {
          title: ai.title,
          description: ai.description,
          week_index: ai.week_index,
          target_date: ai.target_date,
          status: ai.status,
          outcome: ai.outcome,
          notes: ai.notes,
          follow_up_date: ai.follow_up_date,
        },
      },
    };
  }

  const nextStatus = status ?? ai.status;
  let nextNotes = parsed.data.notes !== undefined ? parsed.data.notes : ai.notes;
  const nextFollowUpDate =
    parsed.data.follow_up_date !== undefined
      ? parsed.data.follow_up_date
      : ai.follow_up_date;

  if (status !== undefined && status !== "completed" && isActionNoLongerNeeded(ai)) {
    nextNotes = encodeActionNotes(ai.notes, false);
  }

  if (nextStatus === "blocked") {
    if (!actionUserNotes(nextNotes).trim()) {
      return { ok: false, error: "Add a short waiting reason before saving." };
    }
    if (!nextFollowUpDate) {
      return { ok: false, error: "Choose the next follow-up date before saving." };
    }
  }

  const patch: Record<string, unknown> = {};
  if (status !== undefined) patch.status = status;
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.week_index !== undefined) patch.week_index = parsed.data.week_index;
  if (parsed.data.target_date !== undefined) patch.target_date = parsed.data.target_date;
  if (parsed.data.outcome !== undefined) patch.outcome = parsed.data.outcome;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.follow_up_date !== undefined) patch.follow_up_date = parsed.data.follow_up_date;
  if (nextNotes !== ai.notes && parsed.data.notes === undefined) patch.notes = nextNotes;

  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  let actionUpdateQuery = supabase
    .from("plan_step_action_items")
    .update(patch)
    .eq("id", actionItemId);
  if (expectedUpdatedAt) {
    actionUpdateQuery = actionUpdateQuery.eq("updated_at", expectedUpdatedAt);
  }
  const { data: updatedActionItems, error } = await actionUpdateQuery.select("id, updated_at");

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  if (!updatedActionItems?.length) {
    const { data: latestAction } = await supabase
      .from("plan_step_action_items")
      .select(
        "title, description, week_index, target_date, status, outcome, notes, follow_up_date, updated_at",
      )
      .eq("id", actionItemId)
      .eq("plan_step_id", ai.plan_step_id)
      .maybeSingle();
    if (latestAction) {
      return {
        ok: false,
        error:
          "This action changed in another tab. Compare both versions before choosing which one to keep.",
        conflict: {
          kind: "action_item",
          entityId: actionItemId,
          currentUpdatedAt: latestAction.updated_at,
          current: {
            title: latestAction.title,
            description: latestAction.description,
            week_index: latestAction.week_index,
            target_date: latestAction.target_date,
            status: latestAction.status,
            outcome: latestAction.outcome,
            notes: latestAction.notes,
            follow_up_date: latestAction.follow_up_date,
          },
        },
      };
    }
    return { ok: false, error: "Action item not found or could not be updated." };
  }

  await logCaseActivity(
    supabase,
    familyId,
    "step.action_item_updated",
    "plan_step_action_item",
    actionItemId,
    {
      plan_id: step.plan_id,
      changed_fields: Object.keys(patch),
      status: nextStatus,
    },
  );

  if (status === "completed") {
    const noLongerNeeded = isActionNoLongerNeeded({ status: nextStatus, notes: nextNotes });
    await logCaseActivity(
      supabase,
      familyId,
      noLongerNeeded ? "step.action_item_no_longer_needed" : "step.action_item_completed",
      "plan_step_action_item",
      actionItemId,
      {},
    );

    // Auto-complete step if all action items are now completed
    const { data: stepActionItems } = await supabase
      .from("plan_step_action_items")
      .select("id, status")
      .eq("plan_step_id", ai.plan_step_id);
    const allDone =
      (stepActionItems ?? []).length > 0 &&
      (stepActionItems ?? []).every((x) => x.status === "completed");
    if (allDone) {
      const { data: curStep } = await supabase
        .from("plan_steps")
        .select("status")
        .eq("id", ai.plan_step_id)
        .single();
      if (curStep && curStep.status !== "completed" && curStep.status !== "blocked") {
        const { error: stepCompletionError } = await supabase
          .from("plan_steps")
          .update({ status: "completed" })
          .eq("id", ai.plan_step_id);
        if (stepCompletionError) {
          logServerError("plans:auto-complete-step", stepCompletionError);
        } else {
          await logCaseActivity(
            supabase,
            familyId,
            "step.status_changed",
            "plan_step",
            ai.plan_step_id,
            { status: "completed", source: "action_items_auto" },
          );
        }
      }
    }
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true, updatedAt: updatedActionItems[0]?.updated_at as string | undefined };
}

/** AI revises a single step; returns proposed content without persisting. */
export async function previewRefinePlanStep(
  input: unknown,
): Promise<PreviewRefinePlanStepResult> {
  const parsed = previewRefineStepSchema.safeParse(input);
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

  const { stepId, familyId, feedback, aiMode } = parsed.data;
  const stepMode = parseAiMode(aiMode);

  const detail = await getFamilyDetail(supabase, familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }
  const privacy = validateFamilyNoPii(detail, [
    { field: "feedback", label: "AI revision instructions", value: feedback },
  ]);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }

  const { data: step } = await supabase
    .from("plan_steps")
    .select("id, plan_id, phase, title, description, details, workflow_data")
    .eq("id", stepId)
    .maybeSingle();

  if (!step) {
    return { ok: false, error: "Step not found" };
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("family_id")
    .eq("id", step.plan_id)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!plan) {
    return { ok: false, error: "Step not found" };
  }

  const env = getEnv();
  if (!env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "AI refinement requires OPENAI_API_KEY" };
  }

  const allSteps = detail.plan?.steps ?? [];
  const stepIndex = allSteps.findIndex((s) => s.id === stepId);
  const surroundingTitles = [
    ...allSteps.slice(Math.max(0, stepIndex - 1), stepIndex),
    ...allSteps.slice(stepIndex + 1, stepIndex + 2),
  ].map((s) => s.title);

  const result = await refineStepWithOpenAI(
    detail,
    {
      phase: step.phase,
      title: step.title,
      description: step.description,
      details: step.details,
      workflow_data: step.workflow_data,
    },
    feedback,
    {
      surroundingStepTitles: surroundingTitles,
      aiMode: stepMode,
      requestMeta: { route: "previewRefinePlanStep" },
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  return { ok: true, step: result.step };
}

export type PreviewRefinePlanResult =
  | {
      ok: true;
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
  const privacy = validateFamilyNoPii(detail, [
    { field: "feedback", label: "AI revision instructions", value: feedback },
    ...draft.steps.flatMap((step, stepIndex) => [
      {
        field: `draft.steps.${stepIndex}.title`,
        label: "Action title",
        value: step.title,
      },
      {
        field: `draft.steps.${stepIndex}.description`,
        label: "Action description",
        value: step.description,
      },
      ...planDetailsPrivacyFields(
        (step.details ?? {}) as PlanStepDetails,
        `draft.steps.${stepIndex}.details`,
      ),
      ...step.action_items.flatMap((action, actionIndex) => [
        {
          field: `draft.steps.${stepIndex}.action_items.${actionIndex}.title`,
          label: "Action title",
          value: action.title,
        },
        {
          field: `draft.steps.${stepIndex}.action_items.${actionIndex}.description`,
          label: "Action description",
          value: action.description,
        },
      ]),
    ]),
  ]);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }

  const env = getEnv();
  if (!env.OPENAI_API_KEY?.trim()) {
    return { ok: false, error: "AI refinement requires OPENAI_API_KEY" };
  }

  const draftSteps = draft.steps.map((s) => ({
    phase: s.phase,
    title: s.title,
    description: s.description,
    details: (s.details ?? {}) as PlanStepDetails,
    action_items: s.action_items.map((ai) => ({
      title: ai.title,
      description: ai.description ?? undefined,
      week_index: ai.week_index,
      target_date: ai.target_date ?? undefined,
    })),
  }));

  const result = await previewRefinePlanStepsWithOpenAI(
    detail,
    draftSteps as Parameters<typeof previewRefinePlanStepsWithOpenAI>[1],
    feedback,
    {
      aiMode: planRefineMode,
      requestMeta: { route: "previewRefinePlan" },
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  return {
    ok: true,
    model: result.model,
    steps: result.steps.map((s) => ({
      phase: s.phase,
      title: s.title,
      description: s.description,
      details: s.details as PlanStepDetails,
      action_items: (s.action_items ?? []).map((ai) => ({
        title: ai.title,
        description: ai.description ?? null,
        week_index: ai.week_index,
        target_date: ai.target_date ?? null,
      })),
    })),
  };
}
