/**
 * AI model configuration and task routing.
 *
 * Two-model strategy:
 * - gpt-5.4: Core casework, high-stakes reasoning (plan generation, refinement, case assistant)
 * - gpt-5.4-mini: Fast helper actions (scripts, emails, checklists)
 *
 * Override: Set OPENAI_MODEL_OVERRIDE in env to force one model for all tasks (e.g. gpt-4o for QA).
 */

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

/** Model IDs */
export const MODELS = {
  /** Core reasoning: plan generation, refinement, case assistant, blocker help */
  CORE: "gpt-5.4",
  /** Fast helpers: scripts, emails, checklists, simple explanations */
  HELPER: "gpt-5.4-mini",
} as const;

/** Tasks that require core model (quality over latency) */
const CORE_TASKS: AiTaskType[] = [
  "full_plan_generation",
  "step_refinement",
  "case_assistant",
  "blocker_troubleshoot",
];

/**
 * Returns the model ID for a given task type.
 * Core casework uses gpt-5.4; helper tools use gpt-5.4-mini.
 */
export function getModelForTask(taskType: AiTaskType): string {
  if (CORE_TASKS.includes(taskType)) {
    return MODELS.CORE;
  }
  return MODELS.HELPER;
}

/**
 * Whether this task should use the Responses API (reasoning-heavy).
 */
export function useResponsesApi(taskType: AiTaskType): boolean {
  return CORE_TASKS.includes(taskType);
}
