/**
 * AI model configuration and task routing (per user AI mode: fast vs thinking).
 *
 * Overrides still apply: OPENAI_MODEL_OVERRIDE wins all. Per-mode env tuning:
 * - OPENAI_PLAN_MODEL, OPENAI_PLAN_PHASE_MODEL, OPENAI_UI_MODEL
 * - OPENAI_PLAN_PHASE_THINKING_MODEL,_OPENAI_THINKING_UI_MODEL, OPENAI_FAST_PLAN_MODEL
 */

import type { AiMode } from "@/lib/ai/ai-mode";
import { getEnv } from "@/lib/env";

/** Task types for model routing */
export type AiTaskType =
  | "full_plan_generation"
  | "plan_phase_generation"
  | "plan_refinement"
  | "step_refinement"
  | "case_assistant"
  | "blocker_troubleshoot"
  | "call_script"
  | "email_draft"
  | "prep_checklist"
  | "fallback_options"
  | "family_explanation"
  | "break_into_actions"
  | "what_happens_next"
  | "troubleshoot_blocker";

export const MODELS = {
  PLAN_GENERATION: "o3",
  CHAT_UI_EDITS: "gpt-4.1-mini",
} as const;

const PLAN_MONOLITH_TASK_TYPES: AiTaskType[] = ["full_plan_generation"];
const PLAN_PHASE_TASK_TYPES: AiTaskType[] = ["plan_phase_generation"];

/** Tasks that use the Responses API (structured output / reasoning-heavy). */
const RESPONSES_API_TASK_TYPES: AiTaskType[] = [
  "full_plan_generation",
  "plan_phase_generation",
  "plan_refinement",
  "step_refinement",
  "case_assistant",
  "blocker_troubleshoot",
];

/** o-series models accept `reasoning.effort` on the Responses API. */
export function modelSupportsReasoningEffort(modelId: string): boolean {
  return /^o\d/i.test(modelId.trim());
}

export function getModelForTask(taskType: AiTaskType, mode: AiMode): string {
  const env = getEnv();
  const override = env.OPENAI_MODEL_OVERRIDE?.trim();
  if (override) return override;

  if (mode === "thinking") {
    if (PLAN_MONOLITH_TASK_TYPES.includes(taskType)) {
      return env.OPENAI_PLAN_MODEL?.trim() || MODELS.PLAN_GENERATION;
    }
    if (PLAN_PHASE_TASK_TYPES.includes(taskType)) {
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

  if (PLAN_MONOLITH_TASK_TYPES.includes(taskType)) {
    return env.OPENAI_FAST_PLAN_MODEL?.trim() || env.OPENAI_UI_MODEL?.trim() || MODELS.CHAT_UI_EDITS;
  }
  if (PLAN_PHASE_TASK_TYPES.includes(taskType)) {
    return env.OPENAI_PLAN_PHASE_MODEL?.trim() || env.OPENAI_UI_MODEL?.trim() || MODELS.CHAT_UI_EDITS;
  }
  return env.OPENAI_UI_MODEL?.trim() || MODELS.CHAT_UI_EDITS;
}

export function getDefaultMaxTokensForTask(taskType: AiTaskType, mode: AiMode): number {
  const fast = mode === "fast";
  switch (taskType) {
    case "full_plan_generation":
      return fast ? 6144 : 8192;
    case "plan_phase_generation":
      return fast ? 4096 : 6144;
    /** Full-plan preview refine: lean JSON + merge; below monolithic generation. */
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

/**
 * Whether this task should use the Responses API (reasoning-heavy).
 */
export function taskUsesResponsesApi(taskType: AiTaskType): boolean {
  return RESPONSES_API_TASK_TYPES.includes(taskType);
}
