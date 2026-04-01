import {
  getDefaultSteps,
  getStepTemplatesForPreset,
} from "./templates";
import type {
  GeneratedStep,
  GeneratedStepDetails,
  PlanGeneratorInput,
  PlanPhase,
  StepTemplate,
} from "./types";

function rulesTemplateDetails(t: StepTemplate): GeneratedStepDetails {
  return {
    action_needed_now: `Start work on: ${t.title}`,
    why_now: `This step belongs in the ${t.phase}-day phase to keep the case plan sequenced and accountable.`,
    rationale: t.description,
    detailed_instructions: `${t.description}\n\n1) Review the household context and goals.\n2) Take the primary action described in the step title.\n3) Document who you contacted, dates, and outcomes.\n4) Set a follow-up date in the case file.`,
    checklist: [
      `Confirm understanding of: ${t.title}`,
      "Complete the main task or outreach",
      "Record outcomes and next steps in case notes",
    ],
    required_documents: [],
    contacts: [],
    blockers: ["Competing priorities, missing information, or delayed responses from programs."],
    fallback_options: [
      "If blocked, note the barrier, try an alternate resource from the directory, or escalate to a supervisor.",
    ],
    stage_goal: `Move forward on ${t.title} with clear documentation.`,
    expected_outcome: `Measurable progress or documented outcome related to: ${t.title}`,
    timing_guidance: `Work this during the ${t.phase}-day window; prioritize within 1 to 2 weeks unless crisis factors apply.`,
    priority: "medium",
    success_marker: `You can mark complete when the core work for "${t.title}" is done and logged.`,
  };
}

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
        details: rulesTemplateDetails(t),
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
        details: rulesTemplateDetails(t),
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
