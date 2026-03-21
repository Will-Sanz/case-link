import {
  getDefaultSteps,
  getStepTemplatesForPreset,
} from "./templates";
import type { GeneratedStep, PlanGeneratorInput, PlanPhase } from "./types";

const PHASE_ORDER: PlanPhase[] = ["30", "60", "90"];

function phaseSortOrder(p: PlanPhase): number {
  return PHASE_ORDER.indexOf(p);
}

/**
 * Generate plan steps from family goals and barriers.
 * Rules-based: preset keys map to step templates; custom goals/barriers get default steps.
 * Deduplicates by (phase, title) to avoid repeating similar steps.
 */
export function generatePlanSteps(input: PlanGeneratorInput): GeneratedStep[] {
  const seen = new Set<string>();
  const steps: GeneratedStep[] = [];

  const presetKeys = new Set<string>();
  for (const g of input.goals) {
    if (g.preset_key) presetKeys.add(g.preset_key);
  }
  for (const b of input.barriers) {
    if (b.preset_key) presetKeys.add(b.preset_key);
  }

  for (const key of presetKeys) {
    const templates = getStepTemplatesForPreset(key);
    for (const t of templates) {
      const sig = `${t.phase}:${t.title}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      steps.push({
        phase: t.phase,
        title: t.title,
        description: t.description,
        sort_order: 0,
      });
    }
  }

  if (steps.length === 0) {
    for (const t of getDefaultSteps()) {
      steps.push({
        phase: t.phase,
        title: t.title,
        description: t.description,
        sort_order: 0,
      });
    }
  }

  steps.sort((a, b) => {
    const pa = phaseSortOrder(a.phase);
    const pb = phaseSortOrder(b.phase);
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });

  steps.forEach((s, i) => {
    s.sort_order = i;
  });

  return steps;
}
