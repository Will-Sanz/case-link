import "server-only";

import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";
import type { GeneratedStep, GeneratedStepDetails, GeneratedActionItem, PlanPhase } from "./types";
import {
  OPENAI_PLAN_STEPS_ROOT_SCHEMA,
  aiPlanResponseSchema,
  normalizePlanStep,
  validatePlanStepsRichness,
  validate30DayActionOrientation,
  applyPlanStepDefaults,
  type AiPlanStepParsed,
} from "./plan-step-openai-schema";

export const MAX_PLAN_STEPS_PER_PHASE = 5;

export type OpenAiPlanResult =
  | { ok: true; steps: GeneratedStep[]; model: string }
  | { ok: false; reason: string };

function shouldLogOpenAi(): boolean {
  return process.env.OPENAI_DEBUG === "1";
}

const AI_PROMPT_MATCH_LIMIT = 15;

function cloneSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function buildFamilyContext(detail: FamilyDetail): string {
  const lines: string[] = [
    `Household name: ${detail.name}`,
    detail.urgency ? `Urgency: ${detail.urgency}` : null,
    detail.summary ? `Summary: ${detail.summary}` : null,
    detail.household_notes ? `Circumstances: ${detail.household_notes}` : null,
    detail.goals.length
      ? `Goals:\n${detail.goals.map((g) => `- ${g.label}${g.preset_key ? ` (${g.preset_key})` : ""}`).join("\n")}`
      : null,
    detail.barriers.length
      ? `Barriers:\n${detail.barriers.map((b) => `- ${b.label}${b.preset_key ? ` (${b.preset_key})` : ""}`).join("\n")}`
      : null,
  ].filter(Boolean) as string[];

  const familyBlock = lines.join("\n\n");
  const resourcesBlock = formatMatchesForAiPrompt(
    detail.resourceMatches,
    AI_PROMPT_MATCH_LIMIT,
  );

  return `${familyBlock}\n\n---\n\n${resourcesBlock}`;
}

const SYSTEM_PROMPT = `You are an experienced housing and social services case manager assistant in Philadelphia. Your job is to produce a PROGRESSIVELY SEQUENCED 30-60-90 day case plan that creates REAL MOVEMENT IMMEDIATELY—especially in the first 7 days. Each stage has a distinct role; the 30-day phase must be action-heavy, not assessment-heavy.

## PLANNING PHILOSOPHY (mandatory)
Prioritize: (1) immediate stabilization, (2) urgent action in the first week, (3) concrete progress over passive assessment, (4) meaningful outcomes as early as possible.

## CRITICAL: 30-day phase = URGENT ACTION, NOT ASSESSMENT
The first 30 days are divided as:
- **Week 1**: immediate stabilization and scheduling—front-load actions that move the case NOW
- **Weeks 2–4**: follow-through, documentation, attendance, approvals, backup plans

First-week steps MUST include actions like: schedule appointments, submit applications, contact agencies, gather and send documents, enroll in services, confirm eligibility, start payment-plan or legal-support processes, arrange transportation/childcare logistics, lock in deadlines and next appointments.

By end of week 1, the household should have concrete actions underway—not a list of things to look into.

## ANTI-PATTERN: Do NOT produce weak early-phase steps
AVOID starting 30-day steps with: assess, explore, identify, connect with, review options—UNLESS the step also includes the immediate real-world action to take that same day or week.

Instead, 30-day step titles and action_needed_now should use: call, schedule, apply, submit, confirm, register, request, book, gather, send, escalate, secure, enroll.

## PUSH ASSESSMENT INTO ACTION
If you need to understand something, embed that learning into an action:
- NOT "Assess childcare needs" → USE "Call childcare assistance line, confirm eligibility based on child ages and work schedule, and book the earliest intake appointment"
- NOT "Assess employment barriers" → USE "Register both adults with the workforce office, ask about resume help and job placement, and document transportation or schedule barriers during registration"
- NOT "Assess legal options" → USE "Call tenant legal aid, confirm eviction timeline, and request the earliest intake or hotline guidance"

## URGENCY SCALING (when Urgency is high or crisis)
For high-risk or crisis households: compress timelines; push as many meaningful actions as possible into the first 3–7 days; favor immediate scheduling, filing, escalation; treat delays as risks. A family at high housing risk cannot wait 30 days for action. Reduce risk fast—do not just describe it.

## CRITICAL: Output is schema-enforced
- You MUST return a JSON object that matches the API schema exactly: every key on every step, every time.
- Do NOT omit any field. Do NOT return partial steps.
- Every string field must contain operational guidance—not labels, not "TBD", not "N/A".
- Be concise: short direct prose; 1–3 sentences per narrative field; 3–5 checklist items; 2–3 fallback options; 1–3 contacts. Avoid filler, repetition, generic case-management language.

## Stage differentiation
- **30 days**: immediate stabilization and service activation—scheduling, submissions, enrollments, confirmations
- **60 days**: follow-through, approvals, attendance, removal of blockers, service uptake
- **90 days**: routine-building, sustainability, maintenance, relapse prevention

Do NOT let the 30-day phase become mostly discovery work. Do NOT delay meaningful intervention until day 60 or 90.

## Required content per step (every step)
- action_needed_now — one clear imperative sentence (action verb first)
- rationale — 1–2 concise sentences
- detailed_instructions — 2–4 action-focused sentences or bullets
- checklist — 3–5 concrete tasks
- required_documents — only key documents needed
- contacts — 1–3 most relevant
- success_marker — 1 concise sentence
- fallback_options — 2–3 concise options
- priority — low | medium | high
Plus: why_now, stage_goal, expected_outcome, timing_guidance, blockers, action_items (2+), contact_script (for outreach), depends_on, milestone_type.

## Step count (STRICT)
- At MOST 5 steps per phase (30, 60, 90), 15 steps total.

## Resource grounding
- Use MATCHED_COMMUNITY_RESOURCES when provided. Include program names and contact details.
- action_items[].title must be specific and calendar-ready.`;

/** Simple similarity: shared significant words / total words. Returns 0–1. */
function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const wordsA = new Set(norm(a));
  const wordsB = new Set(norm(b));
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  const total = wordsA.size + wordsB.size - shared;
  return total === 0 ? 0 : shared / total;
}

function deduplicateSteps<T extends { phase: string; title: string }>(
  steps: T[],
): T[] {
  const SIMILARITY_THRESHOLD = 0.6;
  const result: T[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let isDuplicate = false;

    for (let j = 0; j < result.length; j++) {
      const earlier = result[j];
      const sim = titleSimilarity(step.title, earlier.title);
      if (sim >= SIMILARITY_THRESHOLD) {
        isDuplicate = true;
        if (shouldLogOpenAi()) {
          console.info(
            "[openai-plan] dedupe: similar steps",
            { phase: earlier.phase, title: earlier.title },
            { phase: step.phase, title: step.title },
            `sim=${sim.toFixed(2)}`,
          );
        }
        break;
      }
    }

    if (!isDuplicate) {
      result.push(step);
    }
  }

  return result;
}

export function capStepsPerPhase<
  T extends { phase: string; title: string },
>(steps: T[], maxPerPhase: number): T[] {
  const counts: Record<string, number> = { "30": 0, "60": 0, "90": 0 };
  const out: T[] = [];
  for (const s of steps) {
    const p = s.phase;
    if (p !== "30" && p !== "60" && p !== "90") continue;
    if ((counts[p] ?? 0) >= maxPerPhase) continue;
    counts[p] = (counts[p] ?? 0) + 1;
    out.push(s);
  }
  return out;
}

export type TryGeneratePlanOptions = {
  regenerationFeedback?: string;
  retries?: number;
};

function parsedStepsToGenerated(stepsList: AiPlanStepParsed[]): GeneratedStep[] {
  return stepsList.map((s, i) => {
    const actionItems: GeneratedActionItem[] | undefined =
      s.action_items && s.action_items.length > 0 ?
        s.action_items.map((a) => ({
          title: a.title.trim(),
          description: a.description?.trim() || undefined,
          week_index: a.week_index,
          target_date: a.target_date?.trim() || undefined,
        }))
      : undefined;

    const details: GeneratedStepDetails = {
      action_needed_now: s.action_needed_now,
      rationale: s.rationale,
      detailed_instructions: s.detailed_instructions,
      checklist: s.checklist,
      contact_script: s.contact_script?.trim() || undefined,
      required_documents: s.required_documents,
      contacts: s.contacts.map((c) => ({
        name: c.name,
        phone: c.phone?.trim() || undefined,
        email: c.email?.trim() || undefined,
        notes: c.notes?.trim() || undefined,
      })),
      blockers: s.blockers,
      fallback_options: s.fallback_options,
      expected_outcome: s.expected_outcome,
      timing_guidance: s.timing_guidance,
      priority: s.priority,
      stage_goal: s.stage_goal,
      why_now: s.why_now,
      depends_on: s.depends_on?.trim() || undefined,
      milestone_type: s.milestone_type?.trim() || undefined,
      success_marker: s.success_marker,
    };

    return {
      phase: s.phase as PlanPhase,
      title: s.title.trim(),
      description: s.description.trim(),
      sort_order: i,
      details,
      action_items: actionItems,
    };
  });
}

/**
 * Calls OpenAI to draft 30/60/90-day plan steps. Uses strict JSON Schema + richness validation + retries.
 */
export async function tryGeneratePlanStepsWithOpenAI(
  detail: FamilyDetail,
  options?: TryGeneratePlanOptions,
): Promise<OpenAiPlanResult> {
  const context = buildFamilyContext(detail);
  const feedbackBlock =
    options?.regenerationFeedback?.trim() ?
      `\n\n## Regeneration instructions from the case manager (follow closely)\n${options.regenerationFeedback.trim()}\n`
      : "";
  const urgencyBlock =
    detail.urgency === "crisis" || detail.urgency === "high"
      ? `\n\n## URGENCY: ${detail.urgency.toUpperCase()}\nThis household is high-risk. Compress timelines. Push as many concrete actions as possible into the first 3–7 days. Front-load scheduling, filing, and escalation. Do not delay meaningful intervention.\n`
      : "";
  const baseUser = `Create a 30-60-90 day case plan that drives real progress in week 1. HARD LIMIT: at most 5 steps per phase, 15 steps total.

The first 30-day phase must be ACTION-HEAVY—schedule, apply, submit, call, register, confirm, enroll. Avoid passive 30-day steps that only assess, explore, or identify without immediate next action.

Every step MUST include ALL schema fields with substantive, action-oriented content. Keep prose concise: 1–3 sentences per field, 3–5 checklist items, 2–3 fallback options, 1–3 contacts. Use contact_script for outreach steps; null otherwise. No placeholders (TBD, N/A).

Phases: 30-day = immediate stabilization and service activation; 60-day = follow-through and approvals; 90-day = sustainability and maintenance. Use matched resources when they apply.${urgencyBlock}${feedbackBlock}\n\n${context}`;

  const maxAttempts = options?.retries ?? 4;
  let correction = "";
  let lastNormalized: AiPlanStepParsed[] | null = null;
  let lastModel = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const user =
      correction ?
        `${baseUser}\n\n## REQUIRED FIX (previous output was rejected)\n${correction}\nRegenerate the complete plan JSON. Every step must be fully filled with operational detail—not minimal or single-line fields.`
      : baseUser;

    try {
      const result = await createAiResponse({
        taskType: "full_plan_generation",
        instructions:
          SYSTEM_PROMPT +
          "\n\nRespond with JSON only matching the enforced schema. No markdown.",
        input: user,
        structuredJsonSchema: {
          name: "case_plan_steps",
          schema: cloneSchema(OPENAI_PLAN_STEPS_ROOT_SCHEMA),
          strict: true,
        },
        temperature: 0.35,
        maxTokens: 16384,
      });

      if (!result.ok) {
        if (shouldLogOpenAi()) console.info("[openai-plan] error:", result.error);
        return { ok: false, reason: result.error };
      }

      lastModel = result.model;

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        if (shouldLogOpenAi()) console.info("[openai-plan] JSON.parse failed, retrying...");
        correction =
          "The response was not valid JSON. Output a single JSON object with a 'steps' array only.";
        continue;
      }

      const validated = aiPlanResponseSchema.safeParse(parsed);
      if (!validated.success) {
        if (shouldLogOpenAi()) {
          console.info(
            "[openai-plan] Zod validation failed:",
            validated.error.message,
          );
        }
        correction = `Schema/type validation failed: ${validated.error.message.slice(0, 800)}`;
        continue;
      }

      const normalized = validated.data.steps.map(normalizePlanStep);
      lastNormalized = normalized;

      const rich = validatePlanStepsRichness(normalized);
      const actionOk = validate30DayActionOrientation(normalized);

      if (rich.ok && actionOk.ok) {
        const phaseOrder: PlanPhase[] = ["30", "60", "90"];
        let stepsList = [...normalized].sort(
          (a, b) =>
            phaseOrder.indexOf(a.phase as PlanPhase) -
              phaseOrder.indexOf(b.phase as PlanPhase) ||
            a.title.localeCompare(b.title),
        );

        stepsList = deduplicateSteps(stepsList);
        stepsList = capStepsPerPhase(stepsList, MAX_PLAN_STEPS_PER_PHASE);

        if (shouldLogOpenAi() && stepsList.length < normalized.length) {
          console.info(
            "[openai-plan] capped/deduped steps:",
            normalized.length,
            "→",
            stepsList.length,
          );
        }

        if (shouldLogOpenAi()) {
          console.info(
            "[openai-plan]",
            stepsList.length,
            "steps,",
            result.usage?.total_tokens ?? "?",
            "tokens",
          );
        }

        return {
          ok: true,
          steps: parsedStepsToGenerated(stepsList),
          model: lastModel,
        };
      }

      if (shouldLogOpenAi()) {
        const allReasons = [...(rich.ok ? [] : rich.reasons), ...(actionOk.ok ? [] : actionOk.reasons)];
        console.info(
          "[openai-plan] validation failed:",
          allReasons.slice(0, 5).join(" | "),
        );
      }
      correction = [...(rich.ok ? [] : rich.reasons), ...(actionOk.ok ? [] : actionOk.reasons)].slice(0, 12).join("\n");
    } catch (e) {
      if (attempt < maxAttempts - 1) {
        correction = e instanceof Error ? e.message : "Unknown error; retry.";
        continue;
      }
      return {
        ok: false,
        reason: e instanceof Error ? e.message : "OpenAI request failed",
      };
    }
  }

  if (lastNormalized?.length) {
    const defaulted = lastNormalized.map(applyPlanStepDefaults);
    const rich2 = validatePlanStepsRichness(defaulted);
    if (rich2.ok) {
      if (shouldLogOpenAi()) {
        console.info("[openai-plan] applied defaults after failed richness passes");
      }
      const phaseOrder: PlanPhase[] = ["30", "60", "90"];
      let stepsList = [...defaulted].sort(
        (a, b) =>
          phaseOrder.indexOf(a.phase as PlanPhase) -
            phaseOrder.indexOf(b.phase as PlanPhase) ||
          a.title.localeCompare(b.title),
      );
      stepsList = deduplicateSteps(stepsList);
      stepsList = capStepsPerPhase(stepsList, MAX_PLAN_STEPS_PER_PHASE);
      return {
        ok: true,
        steps: parsedStepsToGenerated(stepsList),
        model: lastModel || "unknown",
      };
    }
  }

  return {
    ok: false,
    reason: "Failed to generate a sufficiently detailed plan after retries",
  };
}
