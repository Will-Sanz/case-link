"use server";

import { requireAppUserWithClient } from "@/lib/auth/session";
import { getStepActivity } from "@/lib/services/workflow";

export async function fetchStepActivity(stepId: string) {
  const supabase = (await requireAppUserWithClient()).supabase;

  const { data: step } = await supabase
    .from("plan_steps")
    .select("plan_id")
    .eq("id", stepId)
    .maybeSingle();

  if (!step) return [];

  const { data: plan } = await supabase
    .from("plans")
    .select("family_id")
    .eq("id", step.plan_id)
    .maybeSingle();

  if (!plan) return [];

  return getStepActivity(supabase, stepId, 30);
}
