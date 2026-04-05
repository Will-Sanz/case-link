"use server";

import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { publicMessageFromSupabaseError } from "@/lib/errors/public-action-error";
import { getEnv } from "@/lib/env";
import { getFamilyDetail } from "@/lib/services/families";
import { stepHelperTypeToPersistField } from "@/lib/domain/step-helper/persist-field";
import type { AiMode } from "@/lib/ai/ai-mode";
import type { StepHelperType } from "@/types/step-helper";
import { generateStepHelper } from "@/lib/step-helper/ai-step-helper";
import { stepHelperActionInputSchema } from "@/lib/validations/ai-actions";

export type StepHelperActionResult =
  | { ok: true; content: string; listContent?: string[] }
  | { ok: false; error: string };

export async function generateStepHelperAction(
  stepId: string,
  familyId: string,
  helperType: StepHelperType,
  aiMode?: AiMode,
): Promise<StepHelperActionResult> {
  const parsed = stepHelperActionInputSchema.safeParse({
    stepId,
    familyId,
    helperType,
    aiMode,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  try {
    const session = await requireAppUserWithClient();
    const supabase = session.supabase;
    const detail = await getFamilyDetail(supabase, parsed.data.familyId);
    if (!detail) return { ok: false, error: "Family not found" };

    const step = detail.plan?.steps.find((s) => s.id === parsed.data.stepId);
    if (!step) return { ok: false, error: "Step not found" };

    if (!getEnv().OPENAI_API_KEY?.trim()) {
      return { ok: false, error: "AI is not configured." };
    }

    return await generateStepHelper(detail, step, parsed.data.helperType, {
      aiMode: parsed.data.aiMode,
      requestMeta: { userId: session.user.id, route: `stepHelper:${parsed.data.helperType}` },
    });
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
}

/** Persists AI helper output; maps `helperType` → storage field on the server. */
export async function saveStepHelperOutputAction(
  stepId: string,
  familyId: string,
  helperType: StepHelperType,
  value: string | string[] | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const field = stepHelperTypeToPersistField(helperType);
  return saveStepHelperAction(stepId, familyId, field, value);
}

export async function saveStepHelperAction(
  stepId: string,
  familyId: string,
  field: keyof import("@/types/family").PlanStepAiHelperData,
  value: string | string[] | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireAppUserWithClient();
    const supabase = session.supabase;

    const { data: step } = await supabase
      .from("plan_steps")
      .select("plan_id, ai_helper_data")
      .eq("id", stepId)
      .maybeSingle();

    if (!step) return { ok: false, error: "Step not found" };

    const { data: plan } = await supabase
      .from("plans")
      .select("family_id")
      .eq("id", step.plan_id)
      .eq("family_id", familyId)
      .maybeSingle();

    if (!plan) return { ok: false, error: "Step not found" };

    const current = (step.ai_helper_data as Record<string, unknown>) ?? {};
    const next = {
      ...current,
      [field]: value,
      last_assisted_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("plan_steps")
      .update({ ai_helper_data: next })
      .eq("id", stepId);

    if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };

    await supabase.from("activity_log").insert({
      family_id: familyId,
      actor_user_id: session.user.id,
      action: "step.ai_helper_saved",
      entity_type: "plan_step",
      entity_id: stepId,
      details: { field },
    });

    revalidatePath(`/families/${familyId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
}
