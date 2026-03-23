import "server-only";

import type { PlanRow } from "@/types/family";

/** How to label the plan’s origin in the UI (derived from DB, no raw enum in components). */
export type PlanSourcePresentation = {
  sourceKind: "ai" | "manual" | "rules";
};

export function buildPlanPresentation(
  plan: Pick<PlanRow, "generation_source">,
): PlanSourcePresentation {
  const g = plan.generation_source;
  if (g === "openai") return { sourceKind: "ai" };
  if (g === "manual") return { sourceKind: "manual" };
  return { sourceKind: "rules" };
}
