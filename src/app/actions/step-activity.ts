"use server";

import { z } from "zod";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { logServerError } from "@/lib/logger/server-error";
import { getStepActivity } from "@/lib/services/workflow";

export async function fetchStepActivity(stepId: string) {
  const parsedStepId = z.string().uuid().safeParse(stepId);
  if (!parsedStepId.success) return [];

  try {
    const supabase = (await requireAppUserWithClient()).supabase;

    const { data: step } = await supabase
      .from("plan_steps")
      .select("plan_id")
      .eq("id", parsedStepId.data)
      .maybeSingle();

    if (!step) return [];

    const { data: plan } = await supabase
      .from("plans")
      .select("family_id")
      .eq("id", step.plan_id)
      .maybeSingle();

    if (!plan) return [];

    return await getStepActivity(supabase, parsedStepId.data, 30);
  } catch (e) {
    logServerError("fetchStepActivity", e);
    return [];
  }
}
