import "server-only";

import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { buildPlanningBrief } from "@/lib/plan-generator/planning-brief";
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

const LEAN_PHASE_INSTRUCTIONS = `You are a Philadelphia-area case management drafting assistant. Output a lean, submission-ready ${"{PHASE}"}-day plan section only.

## Rules
- Return JSON only matching the schema (top-level key "steps").
- 1–5 steps for THIS phase only. Each step must be distinct and action-oriented (call, apply, schedule, submit, gather).
- "summary" = concise what-to-do for a case manager (replaces long narratives).
- "timing" = due window or cadence (short phrase or null).
- "additional_guidance" = optional nuance only; use null if not needed.
- action_items: 1–5 concrete tasks; titles are calendar-ready; not raw document names.
- Put document names in required_documents; put people/agencies in contacts.
- Use ONLY programs from MATCHED_RESOURCES when naming organizations; if list is empty, stay generic.
- priority: low | medium | high | urgent

## Geography
${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS}`;

export type LeanPhaseResult =
  | { ok: true; steps: LeanPlanPhaseStep[]; model: string }
  | { ok: false; reason: string };

export async function tryGenerateLeanPlanPhaseOpenAI(
  detail: FamilyDetail,
  phase: PlanPhase,
  options?: { regenerationFeedback?: string; retries?: number },
): Promise<LeanPhaseResult> {
  const brief = buildPlanningBrief(detail, options?.regenerationFeedback);
  const resources = formatMatchesForPlannerPrompt(detail.resourceMatches, 6);
  const user = `## Planning brief\n${brief}\n\n## ${resources}\n\n## Task\nGenerate ONLY the ${phase}-day phase steps (phase field must be "${phase}" on every step). Order by urgency within the phase.`;

  const instructions = LEAN_PHASE_INSTRUCTIONS.replace("{PHASE}", phase);
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
        maxTokens: 6144,
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

      const steps = validated.data.steps.filter((s) => s.phase === phase);
      if (steps.length === 0) {
        correction = `Every step must have phase "${phase}".`;
        continue;
      }

      if (shouldLog()) {
        console.info("[openai-plan-lean-phase]", {
          phase,
          attempt: attempt + 1,
          elapsedMs: Date.now() - started,
          model: result.model,
          stepCount: steps.length,
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
