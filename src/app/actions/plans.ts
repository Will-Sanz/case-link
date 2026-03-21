"use server";

import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { generatePlanSteps } from "@/lib/plan-generator";
import { tryGeneratePlanStepsWithOpenAI } from "@/lib/plan-generator/openai-plan";
import { getFamilyDetail } from "@/lib/services/families";
import {
  createManualStepSchema,
  deletePlanStepSchema,
  generatePlanSchema,
  updatePlanStepSchema,
} from "@/lib/validations/plans";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function generatePlan(input: unknown): Promise<ActionResult> {
  const parsed = generatePlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
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

  const env = getEnv();
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_PLAN_MODEL?.trim() || "gpt-4o-mini";

  let steps = rulesSteps;
  let generationSource: "openai" | "rules" = "rules";
  let aiModel: string | null = null;

  const debugPlan = process.env.OPENAI_DEBUG === "1";

  if (apiKey) {
    const ai = await tryGeneratePlanStepsWithOpenAI(detail, apiKey, model);
    if (ai.ok && ai.steps.length > 0) {
      steps = ai.steps;
      generationSource = "openai";
      aiModel = ai.model;
    } else if (debugPlan && !ai.ok) {
      console.info("[generatePlan] OpenAI failed, rules fallback:", ai.reason);
    }
  }

  const summary =
    generationSource === "openai"
      ? `Plan v${nextVersion} (AI: ${model})`
      : `Plan v${nextVersion} (rules from goals & barriers)`;

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .insert({
      family_id: familyId,
      version: nextVersion,
      summary,
      generation_source: generationSource,
      ai_model: aiModel,
    })
    .select("id")
    .single();

  if (planErr || !plan) {
    return { ok: false, error: planErr?.message ?? "Could not create plan" };
  }

  if (steps.length > 0) {
    const { error: stepsErr } = await supabase.from("plan_steps").insert(
      steps.map((s) => ({
        plan_id: plan.id,
        phase: s.phase,
        title: s.title,
        description: s.description,
        sort_order: s.sort_order,
        status: "pending",
      })),
    );
    if (stepsErr) {
      await supabase.from("plans").delete().eq("id", plan.id);
      return { ok: false, error: stepsErr.message };
    }
  }

  const { error: logErr } = await supabase.from("activity_log").insert({
    family_id: familyId,
    actor_user_id: null,
    action: "plan.generated",
    entity_type: "plan",
    entity_id: plan.id,
    details: {
      version: nextVersion,
      steps: steps.length,
      generation_source: generationSource,
    },
  });
  void logErr;

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
  try {
    ({ supabase } = await requireAppUserWithClient());
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
  if (patch.description !== undefined) updatePayload.description = patch.description;
  if (patch.status !== undefined) updatePayload.status = patch.status;

  const { error } = await supabase
    .from("plan_steps")
    .update(updatePayload)
    .eq("id", stepId)
    .eq("plan_id", planRow.id);

  if (error) {
    return { ok: false, error: error.message };
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
  try {
    ({ supabase } = await requireAppUserWithClient());
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

  const { error } = await supabase.from("plan_steps").insert({
    plan_id: planId,
    phase,
    title,
    description: description ?? "",
    status: "pending",
    sort_order: sortOrder,
  });

  if (error) {
    return { ok: false, error: error.message };
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
    ({ supabase } = await requireAppUserWithClient());
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

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}
