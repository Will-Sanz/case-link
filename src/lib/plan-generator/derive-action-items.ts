import type { GeneratedStep, GeneratedActionItem, PlanPhase } from "./types";

/** Base week index for each phase (1-indexed). 30-day = 1–4, 60-day = 5–8, 90-day = 9–12 */
const PHASE_WEEK_START: Record<PlanPhase, number> = {
  "30": 1,
  "60": 5,
  "90": 9,
};

const PHASE_WEEK_END: Record<PlanPhase, number> = {
  "30": 4,
  "60": 8,
  "90": 12,
};

/**
 * Derives action_items for a step when AI didn't provide them (rules/resource fallback).
 * Uses checklist items or step title to create 1–5 weekly action items.
 */
export function deriveActionItemsForStep(step: GeneratedStep): GeneratedActionItem[] {
  if (step.action_items && step.action_items.length > 0) {
    return step.action_items;
  }

  const phase = step.phase;
  const weekStart = PHASE_WEEK_START[phase];
  const weekEnd = PHASE_WEEK_END[phase];
  const weekSpan = weekEnd - weekStart + 1;

  const checklist = step.details?.checklist ?? [];
  const sources = checklist.length > 0
    ? checklist
    : [step.title];

  const items: GeneratedActionItem[] = [];
  for (let i = 0; i < sources.length; i++) {
    const weekIndex = weekStart + Math.min(Math.floor((i / Math.max(sources.length, 1)) * weekSpan), weekSpan - 1);
    items.push({
      title: typeof sources[i] === "string" ? sources[i] : step.title,
      week_index: Math.min(weekIndex, 12),
    });
  }

  if (items.length === 0) {
    items.push({
      title: step.title,
      week_index: weekStart,
    });
  }

  return items;
}

/**
 * Ensures every step has action_items, deriving from checklist/title when needed.
 */
export function ensureActionItems(steps: GeneratedStep[]): GeneratedStep[] {
  return steps.map((s) => ({
    ...s,
    action_items: deriveActionItemsForStep(s),
  }));
}
