"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
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
import { publicMessageFromSupabaseError } from "@/lib/errors/public-action-error";
import {
  validateFamilyNoPii,
  validateNoPii,
  type PrivacyFieldInput,
} from "@/lib/privacy/no-pii";
import { getFamilyDetail } from "@/lib/services/families";
import type { PlanGenerationState, PlanStepDetails } from "@/types/family";
import {
  refineStepWithOpenAI,
  type RefineStepResult,
} from "@/lib/plan-generator/openai-refine-step";
import {
  createManualStepSchema,
  deletePlanStepSchema,
  generatePlanSchema,
  logPlanStepActivitySchema,
  markPlanReviewedSchema,
  previewRefineStepSchema,
  previewRefinePlanSchema,
  refineStepSchema,
  toggleChecklistItemSchema,
  updatePlanSchema,
  updatePlanStepActionItemSchema,
  updatePlanStepSchema,
} from "@/lib/validations/plans";

export type ActionResult = { ok: true } | { ok: false; error: string };

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

/** Serialize staged advance per family so overlapping polls do not run the same phase twice. */
const advanceStagedChainByFamilyId = new Map<string, Promise<unknown>>();

async function logCaseActivity(
  supabase: SupabaseClient,
  familyId: string,
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>,
) {
  const { error } = await supabase.from("activity_log").insert({
    family_id: familyId,
    actor_user_id: userId,
    action,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
    details: details ?? null,
  });
  void error;
}

async function clearPlanReview(supabase: SupabaseClient, planId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("plans")
    .select("client_display")
    .eq("id", planId)
    .maybeSingle();
  if (error) return publicMessageFromSupabaseError(error);
  if (!data) return "Plan not found";

  const raw = data.client_display;
  const display =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  if (!("reviewedAt" in display) && !("reviewedById" in display)) return null;
  delete display.reviewedAt;
  delete display.reviewedById;

  const { error: updateError } = await supabase
    .from("plans")
    .update({ client_display: Object.keys(display).length > 0 ? display : null })
    .eq("id", planId);
  return updateError ? publicMessageFromSupabaseError(updateError) : null;
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

async function insertLeanPhaseStepsForPlan(
  supabase: SupabaseClient,
  planId: string,
  phaseSteps: LeanPlanPhaseStep[],
  sortOrderStart: number,
  planStartDate: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (phaseSteps.length === 0) {
    return { ok: false, error: "No steps to insert for this phase" };
  }

  const rows = phaseSteps.map((lean, i) => ({
    plan_id: planId,
    phase: lean.phase,
    title: lean.title.trim(),
    description: lean.summary.trim(),
    sort_order: sortOrderStart + i,
    status: "pending" as const,
    details: sparseDetailsForPersistence(lean),
    priority:
      lean.priority === "urgent" ? "urgent"
      : lean.priority === "high" ? "high"
      : lean.priority === "low" ? "low"
      : "medium",
  }));

  const { data: insertedSteps, error: stepsErr } = await supabase
    .from("plan_steps")
    .insert(rows)
    .select("id, sort_order")
    .order("sort_order", { ascending: true });

  if (stepsErr || !insertedSteps?.length) {
    return {
      ok: false,
      error: publicMessageFromSupabaseError(stepsErr, "Could not insert plan steps"),
    };
  }

  const actionItemRows: Array<{
    plan_step_id: string;
    title: string;
    description: string | null;
    week_index: number;
    target_date: string | null;
    status: string;
    sort_order: number;
  }> = [];

  for (let i = 0; i < phaseSteps.length; i++) {
    const lean = phaseSteps[i];
    const stepId = insertedSteps[i]?.id;
    if (!stepId) continue;
    for (let j = 0; j < lean.action_items.length; j++) {
      const ai = lean.action_items[j];
      actionItemRows.push({
        plan_step_id: stepId,
        title: ai.title.trim(),
        description: normAiNullable(ai.description as string | null | undefined),
        week_index: ai.week_index,
        target_date: resolveActionTargetDate({
          planStartDate,
          weekIndex: ai.week_index,
          proposedTargetDate: ai.target_date,
        }),
        status: "pending",
        sort_order: j,
      });
    }
  }

  if (actionItemRows.length > 0) {
    const { error: itemsErr } = await supabase.from("plan_step_action_items").insert(actionItemRows);
    if (itemsErr) {
      return { ok: false, error: publicMessageFromSupabaseError(itemsErr) };
    }
  }

  return { ok: true };
}

export async function generatePlan(input: unknown): Promise<GeneratePlanResult> {
  const parsed = generatePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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

  const { data: existingPlan } = await supabase
    .from("plans")
    .select("id, version")
    .eq("family_id", familyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = existingPlan ? ((existingPlan.version as number) + 1) : 1;

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
      requestMeta:
        userId ? { userId, route: "generatePlan" }
        : undefined,
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
      console.error(`${logPrefix} regenerate requires AI; not using rules fallback`, {
        aiOk: ai.ok,
        reason: !ai.ok ? ai.reason : "zero steps",
      });
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

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .insert({
      family_id: familyId,
      version: nextVersion,
      summary: null,
      generation_source: generationSource,
      ai_model: aiModel,
    })
    .select("id, created_at")
    .single();

  if (planErr || !plan) {
    console.error(`${logPrefix} plans insert failed:`, planErr?.message ?? "no row");
    return {
      ok: false,
      error: publicMessageFromSupabaseError(planErr, "Could not create plan"),
    };
  }

  if (steps.length > 0) {
    const { data: insertedSteps, error: stepsErr } = await supabase
      .from("plan_steps")
      .insert(
        steps.map((s) => ({
          plan_id: plan.id,
          phase: s.phase,
          title: s.title,
          description: s.description,
          sort_order: s.sort_order,
          status: "pending",
          details: s.details ?? null,
        })),
      )
      .select("id, sort_order")
      .order("sort_order", { ascending: true });

    if (stepsErr || !insertedSteps?.length) {
      console.error(`${logPrefix} plan_steps insert failed:`, stepsErr?.message ?? "empty result");
      if (!stepsErr) await supabase.from("plans").delete().eq("id", plan.id);
      return {
        ok: false,
        error: publicMessageFromSupabaseError(stepsErr, "Could not create steps"),
      };
    }

    const actionItemRows: Array<{
      plan_step_id: string;
      title: string;
      description: string | null;
      week_index: number;
      target_date: string | null;
      status: string;
      sort_order: number;
    }> = [];

    const stepIdByIndex = new Map<number, string>();
    for (const row of insertedSteps) {
      stepIdByIndex.set(row.sort_order, row.id);
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepId = stepIdByIndex.get(step.sort_order) ?? insertedSteps[i]?.id;
      if (!stepId) continue;
      const actionItems = step.action_items ?? [];
      for (let j = 0; j < actionItems.length; j++) {
        const ai = actionItems[j];
        actionItemRows.push({
          plan_step_id: stepId,
          title: ai.title,
          description: ai.description ?? null,
          week_index: ai.week_index,
          target_date: resolveActionTargetDate({
            planStartDate: plan.created_at,
            weekIndex: ai.week_index,
            proposedTargetDate: ai.target_date,
          }),
          status: "pending",
          sort_order: j,
        });
      }
    }

    if (actionItemRows.length > 0) {
      const { error: itemsErr } = await supabase
        .from("plan_step_action_items")
        .insert(actionItemRows);
      if (itemsErr) {
        console.error(`${logPrefix} plan_step_action_items insert failed:`, itemsErr.message);
        await supabase.from("plans").delete().eq("id", plan.id);
        return { ok: false, error: publicMessageFromSupabaseError(itemsErr) };
      }
    }
  } else if (logRegen) {
    console.warn(`${logPrefix} zero steps after generation; plan row created with no steps`);
  }

  await logCaseActivity(
    supabase,
    familyId,
    userId,
    "plan.generated",
    "plan",
    plan.id,
    { version: nextVersion, steps: steps.length, generation_source: generationSource },
  );

  revalidatePath(`/families/${familyId}`, "page");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");

  if (logRegen) {
    console.info("[generatePlan] returning to client", {
      ok: true,
      planId: plan.id,
      version: nextVersion,
      stepCount: steps.length,
      generationSource,
    });
  }

  return {
    ok: true,
    planId: plan.id,
    version: nextVersion,
    stepCount: steps.length,
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
  let supabase: SupabaseClient;
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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

  const { data: existingPlan } = await supabase
    .from("plans")
    .select("id, version, generation_state")
    .eq("family_id", input.familyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestGen = existingPlan?.generation_state as PlanGenerationState | null | undefined;
  if (latestGen?.v === 1 && latestGen.status === "running") {
    return {
      ok: false,
      error:
        "A plan is already generating for this family. Wait for it to finish or refresh the page.",
    };
  }

  const nextVersion = existingPlan ? ((existingPlan.version as number) + 1) : 1;
  const brief = buildPlanningBrief(detail, input.regenerationFeedback);
  const stagedMode = parseAiMode(input.aiMode);

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .insert({
      family_id: input.familyId,
      version: nextVersion,
      summary: null,
      generation_source: "openai",
      ai_model: null,
      generation_state: {
        v: 1,
        status: "running",
        pending_phase: "30",
        planning_brief: brief,
        phases_complete: { "30": false, "60": false, "90": false },
        models_used: [],
        stage_timings_ms: {},
        ai_mode: stagedMode,
      } satisfies PlanGenerationState,
    })
    .select("id, created_at")
    .single();

  if (planErr || !plan) {
    return {
      ok: false,
      error: publicMessageFromSupabaseError(planErr, "Could not create plan"),
    };
  }

  await logCaseActivity(supabase, input.familyId, userId, "plan.generation_started", "plan", plan.id, {
    version: nextVersion,
    staged: true,
  });

  revalidatePath(`/families/${input.familyId}`, "page");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");

  return {
    ok: true,
    planId: plan.id,
    version: nextVersion,
    stepCount: 0,
  };
}

/** Run the next pending phase (60 or 90) or finalize state. Idempotent if phases already inserted. */
async function advanceStagedLeanPlanGenerationCore(input: {
  familyId: string;
  /** Fallback when `generation_state.ai_mode` is missing (older rows). */
  aiMode?: AiMode;
}): Promise<StagedPlanAdvanceResult> {
  let supabase: SupabaseClient;
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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
  if (rawState.status === "failed") {
    return { ok: false, error: rawState.error ?? "Generation failed" };
  }

  const planId = activePlan.id as string;
  let state = { ...rawState };
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
    await supabase
      .from("plans")
      .update({
        generation_state: {
          ...state,
          status: "failed",
          error: "Remove identifying text from the family record before generating the plan.",
        },
      })
      .eq("id", planId);
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }

  async function persistState(updates: Partial<PlanGenerationState>, summaryUpdate?: string | null) {
    const next = { ...state, ...updates };
    state = next as PlanGenerationState;
    await supabase
      .from("plans")
      .update({
        generation_state: { ...next, ...(summaryUpdate !== undefined ? { summary: summaryUpdate } : {}) },
        ai_model: [...new Set(next.models_used)].join(" · ") || (activePlan.ai_model as string | null),
      })
      .eq("id", planId);
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
      requestMeta: userId ? { userId, route: "stagedPlanPhase30" } : undefined,
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
    const ins = await insertLeanPhaseStepsForPlan(
      supabase,
      planId,
      steps,
      0,
      activePlan.created_at as string,
    );
    if (!ins.ok) {
      await persistState({ status: "failed", error: ins.error });
      return { ok: false, error: ins.error };
    }
    const modelsUsed = [...state.models_used, res.model];
    await persistState({
      pending_phase: "60",
      phases_complete: { ...state.phases_complete, "30": true },
      models_used: modelsUsed,
      stage_timings_ms: { ...state.stage_timings_ms, "30": Date.now() - t },
    });
    await logCaseActivity(
      supabase,
      input.familyId,
      userId,
      "plan.stage_generated",
      "plan",
      planId,
      { stage: "initial", steps: steps.length },
    );
    revalidatePath(`/families/${input.familyId}`, "page");
    revalidatePath("/calendar");
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
      requestMeta: userId ? { userId, route: "stagedPlanPhase60" } : undefined,
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
    const ins = await insertLeanPhaseStepsForPlan(
      supabase,
      planId,
      steps,
      start,
      activePlan.created_at as string,
    );
    if (!ins.ok) {
      await persistState({ status: "failed", error: ins.error });
      return { ok: false, error: ins.error };
    }
    const models_used = [...state.models_used, res.model];
    await persistState({
      pending_phase: "90",
      phases_complete: { ...state.phases_complete, "60": true },
      models_used,
      stage_timings_ms: { ...state.stage_timings_ms, "60": Date.now() - t },
    });
    revalidatePath(`/families/${input.familyId}`, "page");
    revalidatePath("/calendar");
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
      requestMeta: userId ? { userId, route: "stagedPlanPhase90" } : undefined,
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
    const ins = await insertLeanPhaseStepsForPlan(
      supabase,
      planId,
      steps,
      start,
      activePlan.created_at as string,
    );
    if (!ins.ok) {
      await persistState({ status: "failed", error: ins.error });
      return { ok: false, error: ins.error };
    }
    const models_used = [...state.models_used, res.model];
    await persistState({
      pending_phase: null,
      status: "complete",
      phases_complete: { ...state.phases_complete, "90": true },
      models_used,
      stage_timings_ms: { ...state.stage_timings_ms, "90": Date.now() - t },
    });
    revalidatePath(`/families/${input.familyId}`, "page");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
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
  const familyId = input.familyId;
  const prev = advanceStagedChainByFamilyId.get(familyId);
  const base = prev ? prev.catch(() => {}) : Promise.resolve();
  const next = base.then(() => advanceStagedLeanPlanGenerationCore(input)) as Promise<StagedPlanAdvanceResult>;
  advanceStagedChainByFamilyId.set(familyId, next);
  void next.finally(() => {
    if (advanceStagedChainByFamilyId.get(familyId) === next) {
      advanceStagedChainByFamilyId.delete(familyId);
    }
  });
  return next;
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
  } catch {
    return { ok: false, error: "Unauthorized" };
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
    client_display: Object.keys(display).length > 0 ? display : null,
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
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function markPlanReviewed(input: unknown): Promise<ActionResult> {
  const parsed = markPlanReviewedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  let supabase;
  let userId: string;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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

  const reviewedAt = new Date().toISOString();
  const clientDisplay = {
    ...(family.plan.client_display ?? {}),
    reviewedAt,
    reviewedById: userId,
  };
  const { data: updated, error } = await supabase
    .from("plans")
    .update({ client_display: clientDisplay })
    .eq("id", planId)
    .eq("family_id", familyId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
  if (!updated) return { ok: false, error: "Plan not found or could not be reviewed." };

  await logCaseActivity(supabase, familyId, userId, "plan.reviewed", "plan", planId, {
    reviewed_at: reviewedAt,
  });
  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/families/${familyId}/plan`);
  revalidatePath(`/families/${familyId}/paperwork`);
  return { ok: true };
}

export async function updatePlanStep(
  input: unknown,
): Promise<ActionResult> {
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
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { stepId, familyId, ...patch } = parsed.data;
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

  const changesReviewedContent =
    patch.title !== undefined ||
    patch.description !== undefined ||
    patch.details !== undefined ||
    patch.priority !== undefined ||
    patch.phase !== undefined ||
    patch.sort_order !== undefined;
  if (changesReviewedContent) {
    const reviewError = await clearPlanReview(supabase, planRow.id);
    if (reviewError) return { ok: false, error: reviewError };
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

  const { data: updatedRows, error } = await supabase
    .from("plan_steps")
    .update(updatePayload)
    .eq("id", stepId)
    .eq("plan_id", planRow.id)
    .select("id");

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  if (!updatedRows?.length) {
    return { ok: false, error: "Step not found or could not be updated." };
  }

  await logCaseActivity(
    supabase,
    familyId,
    userId,
    "step.updated",
    "plan_step",
    stepId,
    { plan_id: planRow.id, changed_fields: Object.keys(updatePayload) },
  );

  if (patch.status !== undefined) {
    await logCaseActivity(
      supabase,
      familyId,
      userId,
      "step.status_changed",
      "plan_step",
      stepId,
      { status: patch.status },
    );
  }
  if (patch.workflow_data !== undefined && (patch.workflow_data as { needs_escalation?: boolean })?.needs_escalation) {
    await logCaseActivity(supabase, familyId, userId, "step.escalation_flagged", "plan_step", stepId);
  }

  revalidatePath(`/families/${familyId}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
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
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { familyId, planId, goal, title, description, target_date, details } = parsed.data;

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("id", planId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!plan) {
    return { ok: false, error: "Plan not found" };
  }

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
  const reviewError = await clearPlanReview(supabase, planId);
  if (reviewError) return { ok: false, error: reviewError };
  const daysFromToday = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  const phase: "30" | "60" | "90" =
    daysFromToday <= 30 ? "30" : daysFromToday <= 60 ? "60" : "90";

  const { data: maxOrder } = await supabase
    .from("plan_steps")
    .select("sort_order")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = (maxOrder?.sort_order ?? -1) + 1;

  const stepDetails = { owner: "case_manager", ...(details ?? {}), stage_goal: goal };
  const { data: newStep, error } = await supabase.from("plan_steps").insert({
    plan_id: planId,
    phase,
    title,
    description: description ?? "",
    status: "pending",
    sort_order: sortOrder,
    details: stepDetails,
  }).select("id").single();

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  if (!newStep) {
    return { ok: false, error: "The action could not be created." };
  }

  const { error: actionError } = await supabase.from("plan_step_action_items").insert({
    plan_step_id: newStep.id,
    title,
    description: description?.trim() || null,
    week_index: 1,
    target_date,
    status: "pending",
    sort_order: 0,
  });

  if (actionError) {
    await supabase.from("plan_steps").delete().eq("id", newStep.id);
    return { ok: false, error: publicMessageFromSupabaseError(actionError) };
  }

  await logCaseActivity(supabase, familyId, userId, "step.added", "plan_step", newStep.id, {
    title,
    goal,
    target_date,
  });

  revalidatePath(`/families/${familyId}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deletePlanStep(input: unknown): Promise<ActionResult> {
  const parsed = deletePlanStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { stepId, familyId } = parsed.data;

  const { data: step } = await supabase
    .from("plan_steps")
    .select("plan_id")
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

  const reviewError = await clearPlanReview(supabase, step.plan_id);
  if (reviewError) return { ok: false, error: reviewError };

  const { error } = await supabase
    .from("plan_steps")
    .delete()
    .eq("id", stepId);

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  await logCaseActivity(supabase, familyId, userId, "step.deleted", "plan_step", stepId);

  revalidatePath(`/families/${familyId}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function logPlanStepActivity(input: unknown): Promise<ActionResult> {
  const parsed = logPlanStepActivitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }
  const activityPrivacyError = noPiiError([
    { field: "notes", label: "Activity note", value: parsed.data.notes },
  ]);
  if (activityPrivacyError) return { ok: false, error: activityPrivacyError };

  let supabase;
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { stepId, familyId, action, activity_type, notes, details } = parsed.data;

  const { data: step } = await supabase
    .from("plan_steps")
    .select("plan_id")
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

  const { error } = await supabase.from("plan_step_activity").insert({
    plan_step_id: stepId,
    family_id: familyId,
    actor_user_id: userId,
    action,
    activity_type: activity_type ?? null,
    notes: notes ?? null,
    details: details ?? {},
  });

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  await logCaseActivity(supabase, familyId, userId, "step.activity_logged", "plan_step", stepId, {
    action,
    activity_type: activity_type ?? null,
  });

  revalidatePath(`/families/${familyId}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleChecklistItem(input: unknown): Promise<ActionResult> {
  const parsed = toggleChecklistItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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
      userId,
      "step.status_changed",
      "plan_step",
      stepId,
      { status: statusUpdate, source: "checklist_auto" },
    );
  }

  revalidatePath(`/families/${familyId}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updatePlanStepActionItem(input: unknown): Promise<ActionResult> {
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
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { actionItemId, familyId, status } = parsed.data;

  const { data: ai } = await supabase
    .from("plan_step_action_items")
    .select("plan_step_id, status, notes, follow_up_date")
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

  const changesReviewedContent =
    parsed.data.title !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.week_index !== undefined ||
    parsed.data.target_date !== undefined;
  if (changesReviewedContent) {
    const reviewError = await clearPlanReview(supabase, step.plan_id);
    if (reviewError) return { ok: false, error: reviewError };
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

  const { error } = await supabase
    .from("plan_step_action_items")
    .update(patch)
    .eq("id", actionItemId);

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  await logCaseActivity(
    supabase,
    familyId,
    userId,
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
      userId,
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
        await supabase
          .from("plan_steps")
          .update({ status: "completed" })
          .eq("id", ai.plan_step_id);
        await logCaseActivity(
          supabase,
          familyId,
          userId,
          "step.status_changed",
          "plan_step",
          ai.plan_step_id,
          { status: "completed", source: "action_items_auto" },
        );
      }
    }
  }

  revalidatePath(`/families/${familyId}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
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
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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
      requestMeta: userId ? { userId, route: "previewRefinePlanStep" } : undefined,
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
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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
      requestMeta: userId ? { userId, route: "previewRefinePlan" } : undefined,
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

export async function refinePlanStep(input: unknown): Promise<ActionResult> {
  const parsed = refineStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  let supabase;
  let userId: string | null = null;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
    userId = session.user.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
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
      requestMeta: userId ? { userId, route: "refinePlanStep" } : undefined,
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  const { title, description, details, stepPriority } = result.step;

  const { data: curStep } = await supabase
    .from("plan_steps")
    .select("workflow_data")
    .eq("id", stepId)
    .single();

  const curWd = (curStep?.workflow_data as Record<string, unknown>) ?? {};
  const checklistLen = (details?.checklist ?? []).length;
  const nextWd = {
    ...curWd,
    checklist_completed: Array(checklistLen).fill(false),
  };

  const updatePayload: Record<string, unknown> = {
    title,
    description,
    details: details ?? null,
    workflow_data: nextWd,
  };
  if (stepPriority) {
    updatePayload.priority = stepPriority;
  }

  const reviewError = await clearPlanReview(supabase, step.plan_id);
  if (reviewError) return { ok: false, error: reviewError };

  const { error } = await supabase.from("plan_steps").update(updatePayload).eq("id", stepId);

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  const session = await requireAppUserWithClient();
  await supabase.from("plan_step_activity").insert({
    plan_step_id: stepId,
    family_id: familyId,
    actor_user_id: session.user.id,
    action: "step.refined",
    notes: null,
    details: { instruction_chars: feedback.length },
  });

  await logCaseActivity(
    supabase,
    familyId,
    session.user.id,
    "step.refined",
    "plan_step",
    stepId,
    { instruction_chars: feedback.length },
  );

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}
