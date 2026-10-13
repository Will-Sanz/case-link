/**
 * AI model configuration and task routing (per user AI mode: fast vs thinking).
 *
 * Overrides still apply: OPENAI_MODEL_OVERRIDE wins all. Per-mode env tuning:
 * - OPENAI_PLAN_MODEL, OPENAI_PLAN_PHASE_MODEL, OPENAI_UI_MODEL
 * - OPENAI_PLAN_PHASE_THINKING_MODEL,_OPENAI_THINKING_UI_MODEL
 */

import type { AiMode } from "@/lib/ai/ai-mode";
import { getEnv } from "@/lib/env";
import { isAllowedOpenAiModelId, OPENAI_MODELS } from "./model-allowlist";

/** Task types for model routing */
export type AiTaskType = "plan_phase_generation" | "plan_refinement" | "step_refinement" | "case_assistant";

export const MODELS = {
  PLAN_GENERATION: "gpt-5.6-luna",
  CHAT_UI_EDITS: "gpt-5.6-luna",
} as const;

/** Models that accept configurable reasoning effort. */
export function modelSupportsReasoningEffort(modelId: string): boolean {
  const id = modelId.trim();
  return isAllowedOpenAiModelId(id) && OPENAI_MODELS[id].reasoning;
}

export function getModelForTask(taskType: AiTaskType, mode: AiMode): string {
  const env = getEnv();
  const override = env.OPENAI_MODEL_OVERRIDE?.trim();
  if (override) return override;

  if (mode === "thinking") {
    if (taskType === "plan_phase_generation") {
      return (
        env.OPENAI_PLAN_PHASE_THINKING_MODEL?.trim() ||
        env.OPENAI_PLAN_MODEL?.trim() ||
        MODELS.PLAN_GENERATION
      );
    }
    return (
      env.OPENAI_THINKING_UI_MODEL?.trim() ||
      env.OPENAI_PLAN_MODEL?.trim() ||
      MODELS.PLAN_GENERATION
    );
  }

  if (taskType === "plan_phase_generation") {
    return env.OPENAI_PLAN_PHASE_MODEL?.trim() || env.OPENAI_UI_MODEL?.trim() || MODELS.CHAT_UI_EDITS;
  }
  return env.OPENAI_UI_MODEL?.trim() || MODELS.CHAT_UI_EDITS;
}

export function getDefaultMaxTokensForTask(taskType: AiTaskType, mode: AiMode): number {
  const fast = mode === "fast";
  switch (taskType) {
    case "plan_phase_generation":
      return fast ? 4096 : 6144;
    /** Full-plan preview refine: lean JSON plus reviewed changes. */
    case "plan_refinement":
      return fast ? 3584 : 5120;
    case "step_refinement":
      return fast ? 3072 : 4096;
    default:
      return fast ? 2048 : 3072;
  }
}

export function augmentInstructionsForMode(
  instructions: string,
  mode: AiMode,
): string {
  if (mode === "fast") {
    return `${instructions}\n\n## Output mode: Fast\nPrioritize brevity: tight wording, fewer redundant bullets, no filler. Stay accurate and easy to transfer to city forms.`;
  }
  return `${instructions}\n\n## Output mode: Thorough\nBe concrete and precise. Add nuance only where it helps the case manager; avoid repetition or padding.`;
}
