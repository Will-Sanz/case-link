import "server-only";

import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";
import type { GeneratedStep, GeneratedStepDetails, GeneratedActionItem, PlanPhase } from "./types";
import { GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS } from "@/lib/ai/prompt-geo";
import {
  OPENAI_PLAN_STEPS_ROOT_SCHEMA,
  aiPlanResponseSchema,
  normalizePlanStep,
  type AiPlanStepParsed,
} from "./plan-step-openai-schema";

export const MAX_PLAN_STEPS_PER_PHASE = 5;

export type OpenAiPlanResult =
  | { ok: true; steps: GeneratedStep[]; model: string }
  | { ok: false; reason: string };

function shouldLogOpenAi(): boolean {
  return process.env.OPENAI_DEBUG === "1";
}

/**
 * Verbose trace logs for plan generation / regenerate (prompts, raw responses, retries).
 * Off by default. Set `PLAN_REGENERATE_DEBUG=1` or `OPENAI_DEBUG=1` to enable.
 */
export function shouldLogPlanRegenerate(): boolean {
  if (process.env.PLAN_REGENERATE_DEBUG === "0") return false;
  return (
    process.env.PLAN_REGENERATE_DEBUG === "1" ||
    process.env.OPENAI_DEBUG === "1"
  );
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

const SYSTEM_PROMPT = `You are an experienced housing and social services case manager assistant in Philadelphia. Your job is to produce a PRIORITIZED 30-60-90 day case plan ordered by importance and urgency—NOT strict dependency chains. Steps should be in the most logical sequence for a case worker, but do not need to depend on each other.

## GEOGRAPHIC CONTEXT
${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS}

## FIELD: action_needed_now (mandatory style)
- This is a short directive for the case manager: what to do next, or a crisp factual cue (timelines, deadlines, eligibility notes)—written as a **statement**, not an answer to a question.
- Do **not** start with Yes, No, Sure, Correct, or similar. Do **not** phrase as Q&A (e.g. avoid leading with "Yes –" before a fact).
- Prefer imperative or neutral declarative voice: e.g. "Submit SNAP application; decisions often within 30 days; ask about expedited SNAP (often within ~5 days) if eligible." NOT "Yes – SNAP decisions take up to 30 days…"

## CORE GOAL: Prioritized Action Plan
Generate a prioritized action plan, not a list of similar suggestions. The first step should be the most important action to take immediately. Each subsequent step should be clearly different and lower in urgency or impact. If two steps overlap significantly, combine them into one stronger step.

## PRIORITIZATION RULES (mandatory)
Rank steps by:
1. **Urgency** — deadlines, immediate need for food, housing risk, eviction, crisis
2. **Impact** — what unlocks the most support/resources (e.g., SNAP opens food access; housing application opens shelter options)
3. **Time sensitivity** — applications with deadlines, benefits, scheduling delays

- Step 1 = most important / most urgent action to take right now
- Later steps = still valuable, but less urgent or lower impact
- Do NOT force steps into a dependency chain if it's unnatural
- Later steps can be parallel or independent; they must simply be less critical than earlier ones

## DEDUPLICATION RULES (mandatory)
Before returning steps, check for overlap in:
- **Program names** — SNAP, WIC, food pantry, LIHEAP, etc. Do not have separate steps for "Apply for SNAP" and "Contact food pantry for SNAP referral" if they overlap in outcome
- **Intent** — apply, contact, schedule, verify. Merge "Apply for SNAP and register with food pantry" into one well-scoped step unless there is a clear difference in timing or purpose
- **Outcome** — food access, benefits access, housing stability. If two steps achieve the same outcome, combine them

If two steps are very similar: merge them into one stronger step OR keep only the more actionable / higher-impact version.

AVOID outputs like:
- "Apply for SNAP and register with food pantry" + "Apply for SNAP/WIC and contact food pantries" (merge into one)
- Multiple steps that all say "contact" or "apply" for the same program family

## STEP QUALITY RULES
- Each step must include: a clear, distinct title; one primary objective; specific action items
- Titles must be meaningfully different from each other
- Avoid repeating the same structure or wording across steps
- Each step should answer: "Why is this a separate priority?"
- Prefer fewer, high-quality steps over many repetitive ones (3–5 steps per phase max; 8–12 total is ideal)

## PLANNING PHILOSOPHY
Prioritize: (1) immediate stabilization, (2) urgent action in the first week, (3) concrete progress over passive assessment, (4) meaningful outcomes as early as possible.

## 30-day phase = URGENT ACTION, NOT ASSESSMENT
- **Week 1**: immediate stabilization and scheduling—front-load actions that move the case NOW
- **Weeks 2–4**: follow-through, documentation, attendance, approvals, backup plans

First-week steps MUST include actions like: schedule appointments, submit applications, contact agencies, gather and send documents, enroll in services, confirm eligibility.

## ANTI-PATTERN: Do NOT produce weak or repetitive steps
AVOID: assess, explore, identify—without immediate action. USE: call, schedule, apply, submit, confirm, register, request, book, gather, send, escalate, secure, enroll.
AVOID: multiple steps that are slight rewordings of the same idea (e.g., "Apply for benefits" + "Submit SNAP application").

## URGENCY SCALING (when Urgency is high or crisis)
For high-risk households: compress timelines; push meaningful actions into the first 3–7 days; favor immediate scheduling, filing, escalation.

## Schema and output
- Return JSON matching the API schema exactly. Every key, every step. No placeholders.
- priority field: set "high" for steps 1–2, "medium" for mid-priority, "low" for later steps
- depends_on: use sparingly; prefer natural ordering by priority over explicit dependencies

## Step count
- At MOST 5 steps per phase (30, 60, 90), 15 total. Prefer 3–4 per phase (9–12 total) for clarity.

## Resource grounding
- Use MATCHED_COMMUNITY_RESOURCES when provided. Include program names and contact details.
- action_items[].title must be specific and calendar-ready.`;

/** Extract significant tokens from text (words, program names). */
function tokenize(text: string): Set<string> {
  const lower = text.toLowerCase().replace(/[^\w\s]/g, " ");
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  return new Set(words);
}

/** Program-name fragments that indicate overlap (same outcome category). */
const PROGRAM_FAMILIES = [
  ["snap", "wic", "food", "pantry", "benefits", "ebt"],
  ["liheap", "peco", "utility", "heat", "electric"],
  ["housing", "shelter", "eviction", "rent", "landlord"],
  ["legal", "aid", "tenant", "eviction"],
  ["childcare", "child", "care", "daycare"],
  ["employment", "workforce", "job", "career"],
];

/** Intent verbs that indicate similar actions. */
const INTENT_VERBS = ["apply", "contact", "schedule", "verify", "submit", "register", "enroll", "call", "reach", "outreach"];

/** Title + action_needed_now similarity. Returns 0–1. */
function stepSimilarity(
  a: { title: string; action_needed_now?: string },
  b: { title: string; action_needed_now?: string },
): number {
  const textA = `${a.title} ${a.action_needed_now ?? ""}`;
  const textB = `${b.title} ${b.action_needed_now ?? ""}`;
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);

  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  const total = wordsA.size + wordsB.size - shared;
  const wordSim = total === 0 ? 0 : shared / total;

  let programOverlap = 0;
  for (const family of PROGRAM_FAMILIES) {
    const inA = family.some((p) => textA.includes(p));
    const inB = family.some((p) => textB.includes(p));
    if (inA && inB) {
      programOverlap = Math.max(programOverlap, 0.5);
      const sharedIntent = family.filter((p) => wordsA.has(p) && wordsB.has(p)).length;
      if (sharedIntent > 0) programOverlap = 0.8;
      break;
    }
  }

  const intentOverlap = INTENT_VERBS.filter((v) => wordsA.has(v) && wordsB.has(v)).length;
  const intentBoost = intentOverlap >= 2 ? 0.3 : intentOverlap >= 1 ? 0.15 : 0;

  return Math.min(1, wordSim + programOverlap + intentBoost);
}

/** Deduplicate steps: merge or drop similar steps, keeping higher-priority one. */
function deduplicateSteps<T extends { phase: string; title: string; action_needed_now?: string; priority?: string }>(
  steps: T[],
): T[] {
  const SIMILARITY_THRESHOLD = 0.55;
  const result: T[] = [];

  const priorityScore = (s: T) => {
    const phaseOrder = s.phase === "30" ? 3 : s.phase === "60" ? 2 : 1;
    const priOrder = s.priority === "high" ? 3 : s.priority === "medium" ? 2 : 1;
    return phaseOrder * 10 + priOrder;
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let merged = false;

    for (let j = 0; j < result.length; j++) {
      const earlier = result[j];
      const sim = stepSimilarity(
        { title: step.title, action_needed_now: step.action_needed_now },
        { title: earlier.title, action_needed_now: earlier.action_needed_now },
      );
      if (sim >= SIMILARITY_THRESHOLD) {
        const keepEarlier = priorityScore(earlier) >= priorityScore(step);
        if (keepEarlier) {
          merged = true;
          if (shouldLogOpenAi()) {
            console.info(
              "[openai-plan] dedupe: dropped similar (kept earlier)",
              { phase: step.phase, title: step.title },
              `sim=${sim.toFixed(2)}`,
            );
          }
        } else {
          result[j] = step;
          if (shouldLogOpenAi()) {
            console.info(
              "[openai-plan] dedupe: replaced with higher-priority",
              { phase: earlier.phase, title: earlier.title },
              { phase: step.phase, title: step.title },
            );
          }
        }
        break;
      }
    }

    if (!merged && !result.some((r) => stepSimilarity(
      { title: step.title, action_needed_now: step.action_needed_now },
      { title: r.title, action_needed_now: r.action_needed_now },
    ) >= SIMILARITY_THRESHOLD)) {
      result.push(step);
    }
  }

  return result;
}

/** Sort steps by priority: urgency (phase) + impact (priority field). First step = highest. */
function sortByPriority<T extends { phase: string; title: string; priority?: string }>(
  steps: T[],
): T[] {
  const phaseOrder: Record<string, number> = { "30": 0, "60": 1, "90": 2 };
  const priOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

  return [...steps].sort((a, b) => {
    const phaseA = phaseOrder[a.phase] ?? 2;
    const phaseB = phaseOrder[b.phase] ?? 2;
    if (phaseA !== phaseB) return phaseA - phaseB;

    const priA = priOrder[a.priority ?? "medium"] ?? 1;
    const priB = priOrder[b.priority ?? "medium"] ?? 1;
    if (priA !== priB) return priA - priB;

    return a.title.localeCompare(b.title);
  });
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
  /** User clicked Regenerate — instruct model to rewrite every step from scratch. */
  fullRegeneration?: boolean;
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
  const logRegen = shouldLogPlanRegenerate();
  const context = buildFamilyContext(detail);
  const feedbackBlock =
    options?.regenerationFeedback?.trim() ?
      `\n\n## Regeneration instructions from the case manager (follow closely)\n${options.regenerationFeedback.trim()}\n`
      : "";
  const fullRegenBlock =
    options?.fullRegeneration ?
      `\n\n## FULL PLAN REGENERATION (mandatory)\nThe case manager is replacing an existing saved plan. You must produce ENTIRELY NEW content for every single step—fresh titles, descriptions, action_needed_now, rationale, detailed_instructions, checklists, action_items (titles and descriptions), contacts, blockers, fallback_options, and all other schema fields. Do not reuse or lightly rephrase generic templates; ground every step in this household's goals, barriers, urgency, and matched resources below. Each step should read as written for this case today.\n`
      : "";
  const urgencyBlock =
    detail.urgency === "crisis" || detail.urgency === "high"
      ? `\n\n## URGENCY: ${detail.urgency.toUpperCase()}\nThis household is high-risk. Compress timelines. Push as many concrete actions as possible into the first 3–7 days. Front-load scheduling, filing, and escalation. Do not delay meaningful intervention.\n`
      : "";
  const baseUser = `Create a 30-60-90 day case plan ordered by PRIORITY (urgency + impact), not dependency chains. Step 1 = most important action to take right now. Each step must be clearly distinct—no overlapping or repetitive steps. If SNAP, WIC, and food pantry actions overlap, merge into one well-scoped step.

HARD LIMIT: at most 5 steps per phase, 15 total. Prefer 3–4 per phase (9–12 total) for clarity.

The first 30-day phase must be ACTION-HEAVY—schedule, apply, submit, call, register, confirm, enroll. Avoid passive or duplicate steps.

Every step MUST include ALL schema fields. Set priority: "high" for top 1–2 steps, "medium"/"low" for others. Use depends_on sparingly. No placeholders.

Phases: 30-day = immediate stabilization; 60-day = follow-through; 90-day = sustainability. Use matched resources when they apply.${fullRegenBlock}${urgencyBlock}${feedbackBlock}\n\n${context}`;

  const maxAttempts = options?.retries ?? 4;
  let correction = "";
  let lastModel = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const user =
      correction ?
        `${baseUser}\n\n## REQUIRED FIX (previous output was rejected)\n${correction}\nRegenerate the complete plan JSON. Every step must be fully filled with operational detail—not minimal or single-line fields.`
      : baseUser;

    if (logRegen) {
      const fb = options?.regenerationFeedback?.trim();
      console.info("[openai-plan/regenerate] → AI request", {
        attempt: attempt + 1,
        maxAttempts,
        fullRegeneration: Boolean(options?.fullRegeneration),
        familyId: detail.id,
        familyName: detail.name,
        hasRegenerationFeedback: Boolean(fb),
        regenerationFeedbackChars: fb?.length ?? 0,
        regenerationFeedback: fb ?? null,
        feedbackBlockChars: feedbackBlock.length,
        contextChars: context.length,
        userPromptChars: user.length,
        userPromptHead: user.slice(0, 900),
        userPromptTail:
          user.length > 900 ? user.slice(Math.max(0, user.length - 400)) : null,
        hasCorrection: Boolean(correction),
      });
    }

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
        if (logRegen) {
          console.warn("[openai-plan/regenerate] ← AI error", result.error);
        }
        return { ok: false, reason: result.error };
      }

      lastModel = result.model;

      if (logRegen) {
        let parsedPreview: unknown;
        try {
          parsedPreview = JSON.parse(result.text) as { steps?: unknown[] };
        } catch {
          parsedPreview = "(not valid JSON)";
        }
        const stepsPreview =
          parsedPreview &&
          typeof parsedPreview === "object" &&
          parsedPreview !== null &&
          "steps" in parsedPreview &&
          Array.isArray((parsedPreview as { steps: unknown[] }).steps) ?
            (parsedPreview as { steps: { title?: string }[] }).steps.map((s) => s.title)
          : null;
        console.info("[openai-plan/regenerate] ← AI response", {
          model: result.model,
          textChars: result.text.length,
          total_tokens: result.usage?.total_tokens,
          textPreview: result.text.slice(0, 2800),
          parsedStepTitles: stepsPreview,
        });
      }

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
        if (logRegen) {
          console.warn("[openai-plan/regenerate] Zod rejected response", {
            message: validated.error.message.slice(0, 1200),
          });
        }
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

      let stepsList = sortByPriority(normalized);
      stepsList = deduplicateSteps(stepsList);
      stepsList = sortByPriority(stepsList);
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

      const generatedSteps = parsedStepsToGenerated(stepsList);
      if (logRegen) {
        console.info("[openai-plan/regenerate] ✓ returning to generatePlan (first valid parse)", {
          stepCount: generatedSteps.length,
          phases: generatedSteps.reduce(
            (acc, s) => {
              acc[s.phase] = (acc[s.phase] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          titles: generatedSteps.map((s) => ({ phase: s.phase, title: s.title })),
        });
      }

      return {
        ok: true,
        steps: generatedSteps,
        model: lastModel,
      };
    } catch (e) {
      if (attempt < maxAttempts - 1) {
        correction = e instanceof Error ? e.message : "Unknown error; retry.";
        if (logRegen) {
          console.warn("[openai-plan/regenerate] attempt threw, will retry", e);
        }
        continue;
      }
      if (logRegen) {
        console.warn("[openai-plan/regenerate] attempt threw, giving up", e);
      }
      return {
        ok: false,
        reason: e instanceof Error ? e.message : "OpenAI request failed",
      };
    }
  }

  if (logRegen) {
    console.warn("[openai-plan/regenerate] ✗ failed after all attempts (JSON/schema only)");
  }
  return {
    ok: false,
    reason: "Failed to get valid plan JSON from the model after retries",
  };
}
