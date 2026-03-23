/**
 * AI model configuration and task routing.
 *
 * - **o3** — 30/60/90 plan generation & regeneration (`full_plan_generation`)
 * - **gpt-4.1-mini** — chat, UI helpers, step refinement, case assistant, edits
 *
 * Overrides:
 * - OPENAI_PLAN_MODEL — overrides plan task model (default: o3)
 * - OPENAI_UI_MODEL — overrides all non-plan AI tasks (default: gpt-4.1-mini)
 * - OPENAI_MODEL_OVERRIDE — force one model for every task (`createAiResponse`)
 */

import { getEnv } from "@/lib/env";

/** Task types for model routing */
export type AiTaskType =
  | "full_plan_generation"
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

/** Plan create + regenerate (server action → OpenAI full plan). */
const PLAN_TASK_TYPES: AiTaskType[] = ["full_plan_generation"];

/** Tasks that use the Responses API (structured output / reasoning-heavy). */
const RESPONSES_API_TASKS: AiTaskType[] = [
  "full_plan_generation",
  "step_refinement",
  "case_assistant",
  "blocker_troubleshoot",
];

/**
 * Returns the model ID for a given task type.
 */
export function getModelForTask(taskType: AiTaskType): string {
  if (PLAN_TASK_TYPES.includes(taskType)) {
    return getEnv().OPENAI_PLAN_MODEL?.trim() || MODELS.PLAN_GENERATION;
  }
  return getEnv().OPENAI_UI_MODEL?.trim() || MODELS.CHAT_UI_EDITS;
}

/**
 * Whether this task should use the Responses API (reasoning-heavy).
 */
export function useResponsesApi(taskType: AiTaskType): boolean {
  return RESPONSES_API_TASKS.includes(taskType);
}
