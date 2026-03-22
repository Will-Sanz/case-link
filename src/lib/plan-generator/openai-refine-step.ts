import "server-only";

import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";
import type { GeneratedStepDetails } from "./types";
import {
  OPENAI_SINGLE_PLAN_STEP_SCHEMA,
  aiPlanStepSchema,
  normalizePlanStep,
  validatePlanStepsRichness,
  applyPlanStepDefaults,
  type AiPlanStepParsed,
} from "./plan-step-openai-schema";

export type RefineStepResult =
  | { ok: true; step: { title: string; description: string; details: GeneratedStepDetails } }
  | { ok: false; reason: string };

function cloneSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are an experienced housing and social services case manager assistant. Your job is to REFINE A SINGLE PLAN STEP based on case manager feedback. Make it an EXECUTION-READY step the case manager can act on immediately.

## Action-oriented refinement
- Use action verbs: call, schedule, apply, submit, confirm, register, request, book, gather, send, escalate, secure, enroll.
- Avoid passive starts: assess, explore, identify, connect with, review options—unless paired with an immediate same-day action.
- Embed any assessment into a concrete task (e.g. "Call X, confirm Y, and book Z" not "Assess Y").

## CRITICAL: Output is schema-enforced
- You MUST return one JSON object matching the API schema exactly—all keys, every time.
- Do NOT omit any field. No "TBD", "N/A", or placeholder strings.
- Keep prose concise: 1–3 sentences per narrative field, 3–5 checklist items, 2–3 fallback options.

## Rules
- Output ONLY the revised step as the root JSON object (not wrapped in "steps").
- Keep the step in the same phase (30, 60, or 90) unless the feedback explicitly asks to change it.
- Make the step MORE SPECIFIC, ACTIONABLE, and EXECUTION-FRIENDLY.
- The checklist MUST contain at least 3 concrete, checkable sub-actions.
- You MUST include at least 2 action_items with week_index and specific titles.
- Incorporate the case manager's feedback exactly where reasonable.
- Use contact_script for outreach (exact phone script); use null if not an outreach step.
- Include required_documents when documents are needed; be specific.
- Include blockers (≥1) and fallback_options (≥1) with realistic content.
- When linked resources exist, use their names and contact details practically.

## Required fields (all must be substantive)
- phase, title, description, action_needed_now
- why_now, rationale, stage_goal, detailed_instructions (2–4 action-focused sentences)
- checklist (3–5 items), required_documents, contacts (1–3)
- blockers, fallback_options (2–3), expected_outcome, success_marker, timing_guidance
- priority: "low" | "medium" | "high"
- action_items: array of { title, description (nullable), week_index, target_date (nullable) }
- contact_script, depends_on, milestone_type (use null when not applicable)`;

/**
 * Refines a single plan step. Uses strict JSON Schema + richness validation.
 */
export async function refineStepWithOpenAI(
  detail: FamilyDetail,
  currentStep: {
    phase: string;
    title: string;
    description: string;
    details?: unknown;
    workflow_data?: { blocker_reason?: string | null };
  },
  feedback: string,
  options?: { surroundingStepTitles?: string[]; retries?: number },
): Promise<RefineStepResult> {
  const blockerReason = currentStep.workflow_data?.blocker_reason;
  const context = [
    `Household: ${detail.name}`,
    detail.summary ? `Summary: ${detail.summary}` : null,
    detail.household_notes ? `Circumstances: ${detail.household_notes}` : null,
    detail.goals.length
      ? `Goals: ${detail.goals.map((g) => g.label).join("; ")}`
      : null,
    detail.barriers.length
      ? `Barriers: ${detail.barriers.map((b) => b.label).join("; ")}`
      : null,
    formatMatchesForAiPrompt(
      detail.resourceMatches.filter((m) => m.status === "accepted"),
      10,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const currentContent = JSON.stringify(
    {
      phase: currentStep.phase,
      title: currentStep.title,
      description: currentStep.description,
      details: currentStep.details,
      ...(blockerReason && { blocker_reason: blockerReason }),
    },
    null,
    2,
  );

  const surroundingBlock =
    (options?.surroundingStepTitles?.length ?? 0) > 0
      ? `\n## Surrounding steps (for context, do not repeat)\n${options!.surroundingStepTitles!.join("\n")}`
      : "";

  const baseUser = `## Case context
${context}

## Current step (to refine)
${currentContent}${surroundingBlock}

## Case manager feedback
${feedback}

Refine ONLY this step. Return the full step object with ALL schema fields filled with operational, action-oriented detail. Be concise but actionable.${blockerReason ? ` The step is BLOCKED because: ${blockerReason}. Consider workarounds, smaller first steps, or alternate approaches.` : ""}`;

  const maxAttempts = options?.retries ?? 4;
  let correction = "";
  let lastNormalized: AiPlanStepParsed | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const user =
      correction ?
        `${baseUser}\n\n## REQUIRED FIX\n${correction}\nRegenerate the complete step JSON with substantive content in every field.`
      : baseUser;

    try {
      const result = await createAiResponse({
        taskType: "step_refinement",
        instructions:
          SYSTEM_PROMPT + "\n\nRespond with JSON only matching the enforced schema. No markdown.",
        input: user,
        structuredJsonSchema: {
          name: "refined_plan_step",
          schema: cloneSchema(OPENAI_SINGLE_PLAN_STEP_SCHEMA),
          strict: true,
        },
        temperature: 0.4,
        maxTokens: 8192,
      });

      if (!result.ok) {
        return { ok: false, reason: result.error };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        correction = "Invalid JSON. Return one JSON object only.";
        continue;
      }

      const validated = aiPlanStepSchema.safeParse(parsed);
      if (!validated.success) {
        correction = `Validation failed: ${validated.error.message.slice(0, 600)}`;
        continue;
      }

      const normalized = normalizePlanStep(validated.data);
      lastNormalized = normalized;

      const rich = validatePlanStepsRichness([normalized]);
      if (rich.ok) {
        const s = normalized;
        const details: GeneratedStepDetails = {
          action_needed_now: s.action_needed_now,
          rationale: s.rationale,
          detailed_instructions: s.detailed_instructions,
          checklist: s.checklist,
          required_documents: s.required_documents,
          contact_script: s.contact_script?.trim() || undefined,
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
          ok: true,
          step: {
            title: s.title.trim(),
            description: s.description.trim(),
            details,
          },
        };
      }

      correction = rich.reasons.slice(0, 10).join("\n");
    } catch (e) {
      if (attempt < maxAttempts - 1) {
        correction = e instanceof Error ? e.message : "Retry.";
        continue;
      }
      return {
        ok: false,
        reason: e instanceof Error ? e.message : "OpenAI request failed",
      };
    }
  }

  if (lastNormalized) {
    const defaulted = applyPlanStepDefaults(lastNormalized);
    const rich2 = validatePlanStepsRichness([defaulted]);
    if (rich2.ok) {
      const s = defaulted;
      const details: GeneratedStepDetails = {
        action_needed_now: s.action_needed_now,
        rationale: s.rationale,
        detailed_instructions: s.detailed_instructions,
        checklist: s.checklist,
        required_documents: s.required_documents,
        contact_script: s.contact_script?.trim() || undefined,
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
        ok: true,
        step: {
          title: s.title.trim(),
          description: s.description.trim(),
          details,
        },
      };
    }
  }

  return { ok: false, reason: "Failed to refine step after multiple retries" };
}
