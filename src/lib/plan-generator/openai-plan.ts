import "server-only";

import { z } from "zod";
import type { FamilyDetail } from "@/types/family";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";
import type { GeneratedStep, GeneratedStepDetails, PlanPhase } from "./types";

const contactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
});

const aiStepSchema = z.object({
  phase: z.enum(["30", "60", "90"]),
  title: z.string().min(1).max(500),
  description: z.string().max(4000),
  rationale: z.string().optional(),
  detailed_instructions: z.string().optional(),
  checklist: z.array(z.string()).optional(),
  required_documents: z.array(z.string()).optional(),
  contacts: z.array(contactSchema).optional(),
  blockers: z.array(z.string()).optional(),
  fallback_options: z.array(z.string()).optional(),
  expected_outcome: z.string().optional(),
  timing_guidance: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  stage_goal: z.string().optional(),
  why_now: z.string().optional(),
  depends_on: z.string().optional(),
  milestone_type: z.string().optional(),
  success_marker: z.string().optional(),
});

const aiResponseSchema = z.object({
  steps: z.array(aiStepSchema).min(1).max(40),
});

export type OpenAiPlanResult =
  | { ok: true; steps: GeneratedStep[]; model: string }
  | { ok: false; reason: string };

function shouldLogOpenAi(): boolean {
  return process.env.OPENAI_DEBUG === "1";
}

const AI_PROMPT_MATCH_LIMIT = 15;

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

const SYSTEM_PROMPT = `You are an experienced housing and social services case manager assistant in Philadelphia. Your job is to produce a PROGRESSIVELY SEQUENCED 30-60-90 day case plan where each stage has a distinct role and later stages build on earlier ones—never repeat the same advice in slightly different wording.

## CRITICAL: Stage differentiation (each phase has a different job)

### 30-day phase = URGENT ACTION AND SETUP
Focus: immediate stabilization, triage, intake, urgent outreach, first document gathering, emergency appointments, initial contact.
- First outreach to key programs
- Initial document collection (ID, proof of address)
- Schedule urgent appointments
- Begin intake processes
- Assess immediate risks
- Connect with crisis resources if needed

### 60-day phase = EXECUTION AND FOLLOW-THROUGH
Focus: follow-through, appointments, progress checks, application completion, troubleshooting, early momentum.
- Follow up on 30-day outreach (with a SPECIFIC new action—e.g. "Submit missing documents" not "Contact X again")
- Attend scheduled appointments
- Complete applications started in 30-day
- Troubleshoot barriers that emerged
- Document outcomes and next steps
- Build momentum on started processes

### 90-day phase = STABILIZATION AND SUSTAINABILITY
Focus: consolidation, long-term stability, habit-building, contingency planning, renewals, reassessment, next-phase planning.
- Consolidate gains
- Renew or extend assistance
- Build sustainable habits (budgeting, routines)
- Contingency planning (what if X happens)
- Reassess goals and barriers
- Plan next phase beyond 90 days

## ANTI-REPETITION RULES (mandatory)
- Do NOT restate the same action in multiple phases unless it has a DIFFERENT goal, context, or next step.
- Each phase must contain DISTINCT actions appropriate to that point in the timeline.
- If a later phase references an earlier step, it must ADVANCE it (e.g. "Submit documents requested in intake" not "Call again").
- Prefer PROGRESSION over repetition.
- Do NOT repeat: "gather documents," "call this number," "follow up" unless the later version is materially different (e.g. 60-day: "Submit the documents they requested" vs 30-day: "Gather initial documents").
- Avoid generic restatements of earlier advice.
- Avoid near-duplicate phrasing across stages.
- Vary guidance types: outreach, preparation, follow-up, habit-building, documentation, review, contingency planning.
- Before finalizing: mentally check whether any step is too similar to an earlier one; if so, rewrite to be specific and differentiated.
- Avoid repeating the same sentence structure across items.

## Output format
Output ONLY valid JSON. No markdown. Shape:
{
  "steps": [
    {
      "phase": "30" | "60" | "90",
      "title": "Clear, phase-specific step title",
      "description": "2–3 sentence summary",
      "stage_goal": "What this phase aims to achieve (for 30: setup, 60: execution, 90: sustainability)",
      "why_now": "Why this action happens in THIS stage rather than earlier or later",
      "depends_on": "Brief ref to prior step if this builds on it (e.g. '30-day CAP intake')",
      "milestone_type": "outreach | preparation | follow_up | review | habit_building | contingency | renewal | application | troubleshooting",
      "rationale": "Why this step matters to the family",
      "detailed_instructions": "Full step-by-step guidance. Be specific.",
      "checklist": ["Sub-step 1", "Sub-step 2", ...],
      "required_documents": ["Doc 1", "Doc 2"],
      "contacts": [{"name": "...", "phone": "...", "email": "...", "notes": "..."}],
      "blockers": ["Common obstacle 1"],
      "fallback_options": ["If X fails, try Y"],
      "expected_outcome": "What success looks like",
      "success_marker": "Clear indicator this step is done",
      "timing_guidance": "When to do this",
      "priority": "low" | "medium" | "high"
    }
  ]
}

## Resource grounding
- When MATCHED_COMMUNITY_RESOURCES are provided, use them when they fit. Include program names and contact details.
- You are NOT limited to resources; provide general guidance when no match exists.
- Combine: resource-based recommendations + general guidance + fallback advice.

## Quality
- 3–12 steps total, spread across phases. Each phase should have distinct value.
- Be specific. Avoid "explore options" or "seek assistance."
- Each step should add NEW value. Later stages must feel like natural progressions, not replays.`;

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

/** Filter overly similar steps. Keeps first occurrence, drops later near-duplicates. */
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

/**
 * Calls OpenAI to draft 30/60/90-day plan steps. Returns ok:false on any failure (caller uses rules fallback).
 */
export async function tryGeneratePlanStepsWithOpenAI(
  detail: FamilyDetail,
  apiKey: string,
  model: string,
): Promise<OpenAiPlanResult> {
  const context = buildFamilyContext(detail);
  const user = `Create a progressively sequenced 30-60-90 day case plan. Each stage must add NEW value—30-day: urgent setup, 60-day: execution and follow-through, 90-day: stabilization and sustainability. Do NOT repeat the same actions across phases. Use stage_goal, why_now, milestone_type for every step. Use matched resources when they apply.\n\n${context}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.35,
        max_tokens: 8192,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (shouldLogOpenAi()) {
        console.info("[openai-plan] HTTP", res.status, errText.slice(0, 300));
      }
      return {
        ok: false,
        reason: `OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { total_tokens?: number };
    };

    const raw = data.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      if (shouldLogOpenAi()) console.info("[openai-plan] empty response:", data);
      return { ok: false, reason: "Empty OpenAI response" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (shouldLogOpenAi())
        console.info("[openai-plan] JSON.parse failed");
      return { ok: false, reason: "OpenAI returned invalid JSON" };
    }

    const validated = aiResponseSchema.safeParse(parsed);
    if (!validated.success) {
      if (shouldLogOpenAi()) {
        console.info(
          "[openai-plan] validation failed:",
          validated.error.message,
          JSON.stringify(parsed).slice(0, 500),
        );
      }
      return { ok: false, reason: "OpenAI JSON did not match expected shape" };
    }

    if (shouldLogOpenAi()) {
      console.info(
        "[openai-plan]",
        validated.data.steps.length,
        "steps,",
        data.usage?.total_tokens ?? "?",
        "tokens",
      );
    }

    const phaseOrder: PlanPhase[] = ["30", "60", "90"];
    let stepsList = validated.data.steps
      .sort(
        (a, b) =>
          phaseOrder.indexOf(a.phase as PlanPhase) -
            phaseOrder.indexOf(b.phase as PlanPhase) ||
          a.title.localeCompare(b.title),
      );

    stepsList = deduplicateSteps(stepsList);

    const steps: GeneratedStep[] = stepsList.map((s, i) => {
      const hasDetails =
        s.rationale ||
        s.detailed_instructions ||
        (s.checklist && s.checklist.length > 0) ||
        (s.required_documents && s.required_documents.length > 0) ||
        (s.contacts && s.contacts.length > 0) ||
        (s.blockers && s.blockers.length > 0) ||
        (s.fallback_options && s.fallback_options.length > 0) ||
        s.expected_outcome ||
        s.timing_guidance ||
        s.priority ||
        s.stage_goal ||
        s.why_now ||
        s.depends_on ||
        s.milestone_type ||
        s.success_marker;

      const details: GeneratedStepDetails | undefined = hasDetails
        ? {
            rationale: s.rationale,
            detailed_instructions: s.detailed_instructions,
            checklist: s.checklist,
            required_documents: s.required_documents,
            contacts: s.contacts,
            blockers: s.blockers,
            fallback_options: s.fallback_options,
            expected_outcome: s.expected_outcome,
            timing_guidance: s.timing_guidance,
            priority: s.priority,
            stage_goal: s.stage_goal,
            why_now: s.why_now,
            depends_on: s.depends_on,
            milestone_type: s.milestone_type,
            success_marker: s.success_marker,
          }
        : undefined;

      return {
        phase: s.phase as PlanPhase,
        title: s.title.trim(),
        description: s.description.trim(),
        sort_order: i,
        details,
      };
    });

    return { ok: true, steps, model };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "OpenAI request failed",
    };
  }
}
