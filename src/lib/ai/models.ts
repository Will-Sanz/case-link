/** Server-controlled task routing; global and legacy operator overrides remain supported. */

import type { AiMode } from "@/lib/ai/ai-mode";
import { getEnv } from "@/lib/env";
import { isAllowedOpenAiModelId, OPENAI_MODELS } from "./model-allowlist";

/** Task types for model routing */
export type AiTaskType = "plan_generation" | "plan_phase_generation" | "plan_refinement" | "step_refinement" | "case_assistant";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const MODELS = {
  PLAN_GENERATION: "gpt-6.1-sol",
  PLAN_REFINEMENT: "gpt-6.1-sol",
  CASE_ASSISTANT: "gpt-6.1-sol",
  STEP_REFINEMENT: "gpt-6.1-sol",
} as const;

const PLAN_CONFIG = { model: MODELS.PLAN_GENERATION, effort: "medium", maxTokens: 16384, prefix: "OPENAI_PLAN_GENERATION" } as const;
const TASK_CONFIG = {
  plan_generation: PLAN_CONFIG,
  plan_phase_generation: PLAN_CONFIG,
  plan_refinement: { model: MODELS.PLAN_REFINEMENT, effort: "medium", maxTokens: 8192, prefix: "OPENAI_PLAN_REFINEMENT" },
  step_refinement: { model: MODELS.STEP_REFINEMENT, effort: "medium", maxTokens: 4096, prefix: "OPENAI_STEP_REFINEMENT" },
  case_assistant: { model: MODELS.CASE_ASSISTANT, effort: "medium", maxTokens: 8192, prefix: "OPENAI_CASE_ASSISTANT" },
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

  const config = TASK_CONFIG[taskType];
  const explicit = env[`${config.prefix}_MODEL`]?.trim();
  if (explicit) return explicit;
  const planning = taskType === "plan_generation" || taskType === "plan_phase_generation";
  // Preserve old operator overrides while task-specific settings take precedence.
  const legacy = mode === "thinking"
    ? (planning ? env.OPENAI_PLAN_PHASE_THINKING_MODEL : env.OPENAI_THINKING_UI_MODEL) || env.OPENAI_PLAN_MODEL
    : (planning ? env.OPENAI_PLAN_PHASE_MODEL : undefined) || env.OPENAI_UI_MODEL;
  return legacy?.trim() || config.model;
}

export function getReasoningEffortForTask(taskType: AiTaskType): ReasoningEffort {
  const config = TASK_CONFIG[taskType];
  return getEnv()[`${config.prefix}_REASONING_EFFORT`] ?? config.effort;
}

export function getDefaultMaxTokensForTask(taskType: AiTaskType): number {
  const config = TASK_CONFIG[taskType];
  return getEnv()[`${config.prefix}_MAX_OUTPUT_TOKENS`] ?? config.maxTokens;
}

export function augmentInstructionsForMode(
  instructions: string,
  mode: AiMode,
): string {
  if (mode === "fast") {
    return `${instructions}\n\n## Output mode: Fast\nPrioritize brevity: tight wording, fewer redundant bullets, no filler. Stay accurate and easy for a school case manager and family to review.`;
  }
  return `${instructions}\n\n## Output mode: Thorough\nBe concrete and precise. Add nuance only where it helps the case manager; avoid repetition or padding.`;
}
