import type { PlanGenerationState } from "@/types/family";

export type GenerationPhase = "30" | "60" | "90";

export function completedGenerationStageCount(
  state: PlanGenerationState | null | undefined,
): number {
  if (!state) return 0;
  if (state.generation_strategy === "single") return state.phases_complete["30"] ? 1 : 0;
  return Object.values(state.phases_complete).filter(Boolean).length;
}

/** Recover the next safe stage from persisted rows after a refresh or interrupted request. */
export function pendingPhaseFromPersistedCounts(counts: Record<GenerationPhase, number>, strategy?: "single"): GenerationPhase | null {
  if (counts["30"] === 0) return "30";
  if (strategy === "single") return null;
  if (counts["60"] === 0) return "60";
  if (counts["90"] === 0) return "90";
  return null;
}

