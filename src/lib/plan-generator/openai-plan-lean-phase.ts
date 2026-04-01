import "server-only";

import type { AiMode } from "@/lib/ai/ai-mode";
import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { buildPlanningBrief } from "@/lib/plan-generator/planning-brief";
import { dedupeLeanPhaseSteps } from "@/lib/plan-generator/lean-step-dedupe";
import {
  buildLeanPhaseRootJsonSchema,
  leanPlanPhaseResponseZ,
  type LeanPlanPhaseStep,
} from "@/lib/plan-generator/lean-plan-schema";
import { formatMatchesForPlannerPrompt } from "@/lib/plan-generator/resource-context";
import { GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS } from "@/lib/ai/prompt-geo";
import type { PlanPhase } from "./types";

function cloneSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function shouldLog(): boolean {
  return process.env.OPENAI_DEBUG === "1" || process.env.PLAN_REGENERATE_DEBUG === "1";
}

const PHASE_FOCUS: Record<PlanPhase, string> = {
  "30": `## Phase role: 30-day, immediate stabilization
Focus on urgent, concrete next actions: safety, intake, first calls, same-week tasks, initial applications.
Do not front-load long-term contingency planning here.`,
  "60": `## Phase role: 60-day, follow-through and documentation
Focus on follow-ups, documentation, appointment outcomes, status checks, backup/second-line options, and measured escalation prep.
Do not repeat the same "first contact" or intake actions already listed under "Already covered" unless the action is clearly a different follow-up (e.g. renewal, re-verification).`,
  "90": `## Phase role: 90-day, sustained support and contingency
Focus on sustaining progress, renewals, consolidating supports, contingency plans, and closing remaining gaps.
Do not re-state early crisis steps or duplicate outreach already covered in 30/60 unless materially new (e.g. annual renewal vs. initial enrollment).`,
};

function buildLeanPhaseInstructions(phase: PlanPhase): string {
  const focus = PHASE_FOCUS[phase];
  return `${focus}

## Output rules
- Return JSON only matching the schema (top-level key "steps").
- Aim for **2 to 4 strong steps** for this phase; use 5 only if the case clearly needs that many distinct actions.
- Each step must be **materially different** from the others (no minor wording variants of the same task).
- "summary" = concise what-to-do for a case manager.
- "timing" = due window or cadence (short phrase or null).
- "additional_guidance" = optional nuance only; use null if not needed.
- action_items: 1 to 4 concrete tasks per step when possible; titles are calendar-ready.
- Put document names in required_documents; put people/agencies in contacts.

## Matched resources (reference only)
- MATCHED_RESOURCES are suggestions. **Name a program only when it is clearly relevant** to that step.
- You **may** include generic case-management steps (document prep, internal notes, family check-ins, coordination) **without** naming a directory program.
- **Avoid** naming the **same** organization in multiple steps unless the actions are clearly different (e.g. initial intake vs. six-week follow-up).

## Geography
${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS}`;
}

export type LeanPhaseResult =
  | { ok: true; steps: LeanPlanPhaseStep[]; model: string }
  | { ok: false; reason: string };

export async function tryGenerateLeanPlanPhaseOpenAI(
  detail: FamilyDetail,
  phase: PlanPhase,
  options?: {
    regenerationFeedback?: string;
    retries?: number;
    aiMode?: AiMode;
    /** Compact lines from DB for earlier phases; avoids repeating the same actions/orgs. */
    priorPhasesSummary?: string | null;
  },
): Promise<LeanPhaseResult> {
  const brief = buildPlanningBrief(detail, options?.regenerationFeedback);
  const resources = formatMatchesForPlannerPrompt(detail.resourceMatches, 6);

  const prior = options?.priorPhasesSummary?.trim();
  const priorBlock =
    prior ?
      `## Already covered in earlier phase(s), do NOT repeat
The following is already planned. Your new steps must add **different** work for the ${phase}-day window only.
${prior}

`
    : "";

  const user = `## Planning brief
${brief}

## ${resources}

${priorBlock}## Task
Generate ONLY the ${phase}-day phase steps (phase field must be "${phase}" on every step). Order by urgency within this phase.`;

  const instructions = buildLeanPhaseInstructions(phase);
  const maxAttempts = options?.retries ?? 2;
  let correction = "";
  let lastModel = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const input =
      correction ? `${user}\n\n## Fix\n${correction}\nRegenerate valid JSON.` : user;
    const started = Date.now();
    try {
      const result = await createAiResponse({
        taskType: "plan_phase_generation",
        instructions,
        input,
        structuredJsonSchema: {
          name: `lean_plan_phase_${phase}`,
          schema: cloneSchema(buildLeanPhaseRootJsonSchema(phase)),
          strict: false,
        },
        temperature: 0.35,
        aiMode: options?.aiMode,
      });

      if (!result.ok) {
        return { ok: false, reason: result.error };
      }
      lastModel = result.model;

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        correction = "Invalid JSON. Return one object with key steps only.";
        continue;
      }

      const validated = leanPlanPhaseResponseZ.safeParse(parsed);
      if (!validated.success) {
        correction = validated.error.message.slice(0, 700);
        continue;
      }

      // Coerce phase so a mis-labeled model response still lands in the requested bucket.
      let steps: LeanPlanPhaseStep[] = validated.data.steps.map((s) => ({
        ...s,
        phase,
      }));

      steps = dedupeLeanPhaseSteps(steps, prior ?? null);
      if (steps.length === 0) {
        correction = `Steps were redundant with each other or with "Already covered". Return distinct ${phase}-day steps that add new work.`;
        continue;
      }

      if (shouldLog()) {
        console.info("[openai-plan-lean-phase]", {
          phase,
          attempt: attempt + 1,
          elapsedMs: Date.now() - started,
          model: result.model,
          stepCount: steps.length,
          hadPriorSummary: Boolean(prior),
        });
      }

      return { ok: true, steps, model: lastModel };
    } catch (e) {
      correction = e instanceof Error ? e.message : "Unknown error";
      if (attempt === maxAttempts - 1) {
        return { ok: false, reason: correction };
      }
    }
  }

  return { ok: false, reason: "Failed after retries" };
}
