import "server-only";

import type { AiMode } from "@/lib/ai/ai-mode";
import type { FamilyDetail } from "@/types/family";
import type { PlanStepDetails } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { formatMatchesForPlannerPrompt } from "@/lib/plan-generator/resource-context";
import { GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS } from "@/lib/ai/prompt-geo";
import {
  buildLeanSingleStepRootJsonSchema,
  leanSingleStepZ,
  sparseDetailsForPersistence,
} from "@/lib/plan-generator/lean-plan-schema";

export type RefineStepResult =
  | {
      ok: true;
      step: {
        title: string;
        description: string;
        details: PlanStepDetails;
        /** Row-level priority when urgent/high/low/medium */
        stepPriority?: "low" | "medium" | "high" | "urgent";
      };
    }
  | { ok: false; reason: string };

function cloneSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are refining ONE plan step for a Philadelphia case manager drafting a submission-ready 30/60/90 outline.

## Output (JSON only, enforced schema)
- summary: concise "what to do" (this becomes the main step text for the form).
- timing: short due window or cadence, or null.
- additional_guidance: optional nuance only; null if not needed.
- action_items: 1–5 concrete tasks (titles are calendar-ready; not raw document names).
- required_documents, contacts, expected_outcome: practical and specific.
- priority: low | medium | high | urgent

## Rules
- Action verbs: call, schedule, apply, submit, gather, confirm, enroll.
- Put document names in required_documents; agencies/people in contacts.
- Use MATCHED_RESOURCES names only when listing programs; do not invent organizations.
- Keep the same phase unless feedback explicitly asks to change it.

## Geography
${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS}`;

/**
 * Refines a single plan step with the lean schema (faster, smaller output).
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
  options?: { surroundingStepTitles?: string[]; retries?: number; aiMode?: AiMode },
): Promise<RefineStepResult> {
  const phase =
    currentStep.phase === "30" || currentStep.phase === "60" || currentStep.phase === "90"
      ? currentStep.phase
      : "30";

  const blockerReason = currentStep.workflow_data?.blocker_reason;
  const context = [
    `Household: ${detail.name}`,
    detail.summary ? `Summary: ${detail.summary}` : null,
    detail.household_notes ? `Notes: ${detail.household_notes}` : null,
    detail.goals.length ? `Goals: ${detail.goals.map((g) => g.label).join("; ")}` : null,
    detail.barriers.length ? `Barriers: ${detail.barriers.map((b) => b.label).join("; ")}` : null,
    formatMatchesForPlannerPrompt(
      detail.resourceMatches.filter((m) => m.status === "accepted"),
      5,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const currentContent = JSON.stringify(
    {
      phase: currentStep.phase,
      title: currentStep.title,
      summary: currentStep.description,
      details: currentStep.details,
      ...(blockerReason ? { blocker_reason: blockerReason } : {}),
    },
    null,
    2,
  );

  const surroundingBlock =
    (options?.surroundingStepTitles?.length ?? 0) > 0
      ? `\n## Nearby steps (context only)\n${options!.surroundingStepTitles!.join("\n")}`
      : "";

  const baseUser = `## Case context
${context}

## Current step
${currentContent}${surroundingBlock}

## Feedback
${feedback}

Refine this step only. phase must stay "${phase}" unless feedback explicitly requests a change.${blockerReason ? ` Step is blocked: ${blockerReason}. Offer a smaller concrete first action or alternate path.` : ""}`;

  const maxAttempts = options?.retries ?? 3;
  let correction = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const user =
      correction ? `${baseUser}\n\n## Fix\n${correction}\nReturn valid JSON for the full step object.` : baseUser;

    try {
      const result = await createAiResponse({
        taskType: "step_refinement",
        instructions: SYSTEM_PROMPT + "\n\nRespond with JSON only. No markdown.",
        input: user,
        structuredJsonSchema: {
          name: "lean_refined_plan_step",
          schema: cloneSchema(buildLeanSingleStepRootJsonSchema()),
          strict: false,
        },
        temperature: 0.35,
        aiMode: options?.aiMode,
      });

      if (!result.ok) {
        return { ok: false, reason: result.error };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        correction = "Invalid JSON. Return one object only.";
        continue;
      }

      const validated = leanSingleStepZ.safeParse(parsed);
      if (!validated.success) {
        correction = validated.error.message.slice(0, 600);
        continue;
      }

      const s = validated.data;
      const allowPhaseChange = /\bphase\b/i.test(feedback);
      const body =
        s.phase !== phase && !allowPhaseChange ? { ...s, phase: phase as "30" | "60" | "90" } : s;

      const details = sparseDetailsForPersistence(body);
      const stepPriority =
        body.priority === "urgent" ? "urgent"
        : body.priority === "high" ? "high"
        : body.priority === "low" ? "low"
        : "medium";

      return {
        ok: true,
        step: {
          title: body.title.trim(),
          description: body.summary.trim(),
          details,
          stepPriority,
        },
      };
    } catch (e) {
      correction = e instanceof Error ? e.message : "Retry";
      if (attempt === maxAttempts - 1) {
        return { ok: false, reason: correction };
      }
    }
  }

  return { ok: false, reason: "Failed to refine step" };
}
