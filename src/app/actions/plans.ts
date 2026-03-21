"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { generatePlanSteps } from "@/lib/plan-generator";
import { tryGeneratePlanStepsWithOpenAI } from "@/lib/plan-generator/openai-plan";
import {
  generatedStepsFromMatches,
  mergeResourceAndRulesSteps,
} from "@/lib/plan-generator/resource-context";
import { ensureActionItems } from "@/lib/plan-generator/derive-action-items";
import { getFamilyDetail } from "@/lib/services/families";
import { refineStepWithOpenAI } from "@/lib/plan-generator/openai-refine-step";
import {
  createManualStepSchema,
  deletePlanStepSchema,
  generatePlanSchema,
  logPlanStepActivitySchema,
  refineStepSchema,
  toggleChecklistItemSchema,
  updatePlanStepActionItemSchema,
  updatePlanStepSchema,
} from "@/lib/validations/plans";

export type ActionResult = { ok: true } | { ok: false; error: string };

function computeTargetDate(
  planStart: Date,
  weekIndex: number,
  itemIndexInStep: number,
): string {
  const d = new Date(planStart);
  const daysOffset = (weekIndex - 1) * 7 + Math.min(itemIndexInStep % 5, 4);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

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

export async function generatePlan(input: unknown): Promise<ActionResult> {
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

  const { familyId } = parsed.data;
  const detail = await getFamilyDetail(supabase, familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }

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

  let steps = rulesStepsMerged;
  let generationSource: "openai" | "rules" = "rules";
  let aiModel: string | null = null;

  const debugPlan = process.env.OPENAI_DEBUG === "1";

  if (apiKey) {
    const ai = await tryGeneratePlanStepsWithOpenAI(detail);
    if (ai.ok && ai.steps.length > 0) {
      steps = ai.steps;
      generationSource = "openai";
      aiModel = ai.model;
    } else if (debugPlan && !ai.ok) {
      console.info("[generatePlan] OpenAI failed, rules fallback:", ai.reason);
    }
  }

  steps = ensureActionItems(steps);

  const summary =
    generationSource === "openai" && aiModel
      ? `Plan v${nextVersion} (AI: ${aiModel})`
      : `Plan v${nextVersion} (rules + matched resources)`;

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .insert({
      family_id: familyId,
      version: nextVersion,
      summary,
      generation_source: generationSource,
      ai_model: aiModel,
    })
    .select("id, created_at")
    .single();

  if (planErr || !plan) {
    return { ok: false, error: planErr?.message ?? "Could not create plan" };
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
      if (!stepsErr) await supabase.from("plans").delete().eq("id", plan.id);
      return { ok: false, error: stepsErr?.message ?? "Could not create steps" };
    }

    const planCreatedAt = new Date((plan as { created_at?: string }).created_at ?? Date.now());
    const planStart = new Date(planCreatedAt);
    planStart.setHours(0, 0, 0, 0);

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
        const targetDate = computeTargetDate(planStart, ai.week_index, j);
        actionItemRows.push({
          plan_step_id: stepId,
          title: ai.title,
          description: ai.description ?? null,
          week_index: ai.week_index,
          target_date: targetDate,
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
        await supabase.from("plans").delete().eq("id", plan.id);
        return { ok: false, error: itemsErr.message };
      }
    }
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

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updatePlanStep(
  input: unknown,
): Promise<ActionResult> {
  const parsed = updatePlanStepSchema.safeParse(input);
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

  const { stepId, familyId, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  const { data: planRow } = await supabase
    .from("plans")
    .select("id")
    .eq("family_id", familyId)
    .maybeSingle();

  if (!planRow) {
    return { ok: false, error: "Plan not found" };
  }

  const updatePayload: Record<string, unknown> = {};
  if (patch.title !== undefined) updatePayload.title = patch.title;
  if (patch.description !== undefined)
    updatePayload.description = patch.description;
  if (patch.status !== undefined) updatePayload.status = patch.status;
  if (patch.details !== undefined) updatePayload.details = patch.details;
  if (patch.workflow_data !== undefined)
    updatePayload.workflow_data = patch.workflow_data;
  if (patch.due_date !== undefined) updatePayload.due_date = patch.due_date;

  const { error } = await supabase
    .from("plan_steps")
    .update(updatePayload)
    .eq("id", stepId)
    .eq("plan_id", planRow.id);

  if (error) {
    return { ok: false, error: error.message };
  }

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
  return { ok: true };
}

export async function createManualStep(input: unknown): Promise<ActionResult> {
  const parsed = createManualStepSchema.safeParse(input);
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

  const { familyId, planId, phase, title, description } = parsed.data;

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("id", planId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!plan) {
    return { ok: false, error: "Plan not found" };
  }

  const { data: maxOrder } = await supabase
    .from("plan_steps")
    .select("sort_order")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = (maxOrder?.sort_order ?? -1) + 1;

  const { data: newStep, error } = await supabase.from("plan_steps").insert({
    plan_id: planId,
    phase,
    title,
    description: description ?? "",
    status: "pending",
    sort_order: sortOrder,
  }).select("id").single();

  if (error) {
    return { ok: false, error: error.message };
  }

  if (newStep) {
    await logCaseActivity(supabase, familyId, userId, "step.added", "plan_step", newStep.id, { title });
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

  const { error } = await supabase
    .from("plan_steps")
    .delete()
    .eq("id", stepId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await logCaseActivity(supabase, familyId, userId, "step.deleted", "plan_step", stepId);

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function logPlanStepActivity(input: unknown): Promise<ActionResult> {
  const parsed = logPlanStepActivitySchema.safeParse(input);
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
    return { ok: false, error: error.message };
  }

  await logCaseActivity(supabase, familyId, userId, "step.activity_logged", "plan_step", stepId, {
    action,
    activity_type: activity_type ?? null,
  });

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

  const { error } = await supabase
    .from("plan_steps")
    .update({
      workflow_data: { ...wd, checklist_completed: next },
    })
    .eq("id", stepId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updatePlanStepActionItem(input: unknown): Promise<ActionResult> {
  const parsed = updatePlanStepActionItemSchema.safeParse(input);
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

  const { actionItemId, familyId, status, target_date } = parsed.data;

  const { data: ai } = await supabase
    .from("plan_step_action_items")
    .select("plan_step_id")
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

  const patch: Record<string, unknown> = {};
  if (status !== undefined) patch.status = status;
  if (target_date !== undefined) patch.target_date = target_date;

  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  const { error } = await supabase
    .from("plan_step_action_items")
    .update(patch)
    .eq("id", actionItemId);

  if (error) {
    return { ok: false, error: error.message };
  }

  if (status === "completed") {
    await logCaseActivity(
      supabase,
      familyId,
      userId,
      "step.action_item_completed",
      "plan_step_action_item",
      actionItemId,
      {},
    );
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function refinePlanStep(input: unknown): Promise<ActionResult> {
  const parsed = refineStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  let supabase;
  try {
    const session = await requireAppUserWithClient();
    supabase = session.supabase;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { stepId, familyId, feedback } = parsed.data;

  const detail = await getFamilyDetail(supabase, familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
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
    { surroundingStepTitles: surroundingTitles },
  );

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  const { title, description, details } = result.step;

  const { data: curStep } = await supabase
    .from("plan_steps")
    .select("workflow_data")
    .eq("id", stepId)
    .single();

  const curWd = (curStep?.workflow_data as Record<string, unknown>) ?? {};
  const nextWd = { ...curWd, checklist_completed: [] };

  const { error } = await supabase
    .from("plan_steps")
    .update({
      title,
      description,
      details: details ?? null,
      workflow_data: nextWd,
    })
    .eq("id", stepId);

  if (error) {
    return { ok: false, error: error.message };
  }

  const session = await requireAppUserWithClient();
  await supabase.from("plan_step_activity").insert({
    plan_step_id: stepId,
    family_id: familyId,
    actor_user_id: session.user.id,
    action: "step.refined",
    notes: feedback,
  });

  await logCaseActivity(
    supabase,
    familyId,
    session.user.id,
    "step.refined",
    "plan_step",
    stepId,
    { feedback: feedback.slice(0, 200) },
  );

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}
