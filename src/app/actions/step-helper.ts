"use server";

import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { getFamilyDetail } from "@/lib/services/families";
import {
  generateStepHelper,
  type StepHelperType,
} from "@/lib/step-helper/ai-step-helper";

export type StepHelperActionResult =
  | { ok: true; content: string; listContent?: string[] }
  | { ok: false; error: string };

export async function generateStepHelperAction(
  stepId: string,
  familyId: string,
  helperType: StepHelperType,
): Promise<StepHelperActionResult> {
  try {
    const session = await requireAppUserWithClient();
    const supabase = session.supabase;
    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Family not found" };

    const step = detail.plan?.steps.find((s) => s.id === stepId);
    if (!step) return { ok: false, error: "Step not found" };

    if (!getEnv().OPENAI_API_KEY?.trim()) {
      return { ok: false, error: "AI requires OPENAI_API_KEY" };
    }

    return await generateStepHelper(detail, step, helperType);
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
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

    if (error) return { ok: false, error: error.message };

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
