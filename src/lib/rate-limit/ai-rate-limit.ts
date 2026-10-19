import "server-only";

import type { AiTaskType } from "@/lib/ai/models";
import { z } from "zod";
import { logServerError } from "@/lib/logger/server-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const budgetSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true), retryAfter: z.literal(0) }),
  z.object({ allowed: z.literal(false), retryAfter: z.number().int().min(1).max(86400), reason: z.enum(["operation", "user_hour", "deployment_day", "disabled", "control_unavailable"]) }),
]);
type SharedBudgetResult = z.infer<typeof budgetSchema>;

function budgetForTask(taskType: AiTaskType): { operation: string; weight: number } {
  if (taskType === "plan_generation" || taskType === "plan_phase_generation") return { operation: "plan_phase", weight: 2 };
  if (taskType === "plan_refinement" || taskType === "step_refinement") {
    return { operation: "plan", weight: 2 };
  }
  return { operation: "chat", weight: 1 };
}

/** Consume the shared Postgres budget. Fails closed if the control is unavailable. */
export async function consumeOpenAiRateSlot(taskType: AiTaskType): Promise<SharedBudgetResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const budget = budgetForTask(taskType);
    const { data, error } = await supabase.rpc("consume_ai_budget", {
      p_operation: budget.operation,
      p_weight: budget.weight,
    });
    if (error) throw error;

    return budgetSchema.parse(data);
  } catch (error) {
    logServerError("consumeOpenAiRateSlot", error);
    return { allowed: false, retryAfter: 60, reason: "control_unavailable" };
  }
}
