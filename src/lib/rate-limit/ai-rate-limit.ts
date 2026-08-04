import "server-only";

import type { AiTaskType } from "@/lib/ai/models";
import { isProd } from "@/lib/env/runtime";
import { logServerError } from "@/lib/logger/server-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SharedBudgetResult = {
  allowed: boolean;
  retryAfter: number;
  reason?: string;
};

function budgetForTask(taskType: AiTaskType): { operation: string; weight: number } {
  if (taskType === "full_plan_generation") return { operation: "plan", weight: 3 };
  if (taskType === "plan_phase_generation") return { operation: "plan_phase", weight: 2 };
  if (taskType === "plan_refinement" || taskType === "step_refinement") {
    return { operation: "plan", weight: 2 };
  }
  if (taskType === "pdf_field_mapping") return { operation: "pdf_mapping", weight: 1 };
  if (taskType === "case_assistant") return { operation: "chat", weight: 1 };
  return { operation: "helper", weight: 1 };
}

/** Consume the shared Postgres budget. Production fails closed if the control is unavailable. */
export async function consumeOpenAiRateSlot(taskType: AiTaskType): Promise<SharedBudgetResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const budget = budgetForTask(taskType);
    const { data, error } = await supabase.rpc("consume_ai_budget", {
      p_operation: budget.operation,
      p_weight: budget.weight,
    });
    if (error) throw error;

    const value = data as Partial<SharedBudgetResult> | null;
    if (typeof value?.allowed !== "boolean") throw new Error("Invalid AI budget response");
    return {
      allowed: value.allowed,
      retryAfter:
        typeof value.retryAfter === "number" && Number.isFinite(value.retryAfter)
          ? Math.max(1, Math.ceil(value.retryAfter))
          : 60,
      reason: typeof value.reason === "string" ? value.reason : undefined,
    };
  } catch (error) {
    logServerError("consumeOpenAiRateSlot", error);
    return isProd()
      ? { allowed: false, retryAfter: 60, reason: "control_unavailable" }
      : { allowed: true, retryAfter: 0 };
  }
}
