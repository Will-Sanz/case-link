import "server-only";

import type { AiMode } from "@/lib/ai/ai-mode";
import type { OpenAiRequestMeta } from "@/lib/ai/openai-request-meta";
import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { getEnv } from "@/lib/env";
import { formatMatchesForPlannerPrompt } from "@/lib/plan-generator/resource-context";
import { matchPlanRowsById } from "@/lib/domain/plan/refinement-identity";
import { actionTargetDate } from "@/lib/domain/plan/action-state";
import { contactReferences, planResourceCatalog } from "@/lib/matching/plan-resources";
import { validateNoPii } from "@/lib/privacy/no-pii";
import { CASEWORK_SAFETY_PROMPT } from "@/lib/ai/casework-safety";
import {
  type DraftStepRefineInput,
  mergeLeanRefineIntoBase,
  OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA,
  planRefineLeanResponseSchema,
} from "./plan-refine-lean";
export const MAX_PLAN_STEPS_PER_PHASE = 5;

/** Shorter context for plan-level refine (compact resources, minimal prose). */
function buildFamilyContextForRefine(detail: FamilyDetail): string {
  const notes =
    [detail.summary?.trim(), detail.household_notes?.trim()].filter(Boolean).join(" · ") || "none";
  const barriers =
    detail.barriers.length > 0 ?
      detail.barriers.map((b) => b.label).join("; ")
    : "none";
  return `Barriers: ${barriers}\nCase notes: ${notes}\n${formatMatchesForPlannerPrompt(detail.resourceMatches, 6)}`;
}

function compactDraftJsonForRefine(
  draftSteps: DraftStepRefineInput[],
): string {
  return JSON.stringify(
    draftSteps.map((s) => {
      const d = s.details;
      return {
        id: s.id,
        status: s.status,
        workflow_data: s.workflow_data,
        phase: s.phase,
        title: s.title,
        description: s.description,
        owner: d.owner,
        goal: d.stage_goal,
        timing_guidance: d.timing_guidance,
        required_documents: d.required_documents ?? [],
        resource_references: contactReferences(d.contacts),
        unverified_contacts_omitted: (d.contacts ?? []).filter(contact => !contact.source_resource_id).length,
        expected_outcome: d.expected_outcome,
        priority: d.priority,
        action_items: s.action_items.map(action => ({ ...action, target_date: actionTargetDate(action) })),
      };
    }),
    null,
    2,
  );
}

export async function previewRefinePlanStepsWithOpenAI(
  detail: FamilyDetail,
  draftSteps: DraftStepRefineInput[],
  feedback: string,
  options?: { aiMode?: AiMode; requestMeta?: OpenAiRequestMeta; taskType?: "step_refinement" | "plan_refinement" },
): Promise<{ ok: true; steps: DraftStepRefineInput[]; model: string } | { ok: false; reason: string }> {
  const taskType = options?.taskType ?? "plan_refinement";
  const env = getEnv();
  const logRefine = env.PLAN_REFINE_DEBUG === "1" || env.OPENAI_DEBUG === "1";
  const startedAt = Date.now();
  const catalog = planResourceCatalog(detail.resourceMatches, 6);
  const context = buildFamilyContextForRefine(detail);
  const draftJson = compactDraftJsonForRefine(draftSteps);

  const user = `## Context
${context}

## Current plan (lean view, preserve unless feedback asks to change)
${draftJson}

## Instructions
${feedback.trim()}

## Rules
- Revise this existing draft; do not invent a new plan shape.
- Return exactly ${draftSteps.length} steps with their original IDs and phases. Include each step/action ID exactly once.
- IDs identify the same work regardless of response order. Never substitute, duplicate, add, remove, or move IDs between goals.
- Status, ownership, outcomes, progress notes, and completed work are human records. Do not reinterpret or reassign them.
- For blocked (Waiting) work, target_date means the next follow-up date. Return null to preserve an existing date.
- Return null for action_items, required_documents, or resource_ids to leave that list unchanged.
- Return [] for required_documents or resource_ids only when the instructions ask to remove every item.
- Choose resource_ids only from MATCHED_RESOURCES. Never return contact names, phone numbers, email addresses, URLs, or invented programs in prose. Contact facts are added by the app from the directory. Missing eligibility, hours, and availability must remain unknown; propose checking them.
- Preserve the exact number of actions, including zero or one; do not add filler tasks, contacts, or documents.
- JSON only; key \`steps\` matching the schema.
- Geographic scope: Philadelphia; use matched resources when relevant; do not invent programs.`;

  const instructions =
    "You edit an existing case plan draft for a case manager. " +
    CASEWORK_SAFETY_PROMPT + "\nChange only what the case manager explicitly requests. Preserve all other wording and human records exactly. " +
    "Return one JSON object with key `steps` only. Each step includes its original id, phase, title, description, " +
    "required_documents, resource_ids, expected_outcome, timing_guidance, priority (null to preserve), and action_items " +
    "(use null to leave a list unchanged; [] explicitly clears it).";

  try {
    const result = await createAiResponse({
      taskType,
      instructions,
      input: user,
      structuredJsonSchema: {
        name: "plan_refine_lean_steps",
        schema: OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA,
        strict: true,
      },
      temperature: 0.25,
      aiMode: options?.aiMode,
      requestMeta: options?.requestMeta,
    });

    if (!result.ok) {
      if (logRefine) {
        console.info("[plan-refine]", {
          taskType,
          model: null,
          aiMode: options?.aiMode ?? null,
          retry: false,
          ms: Date.now() - startedAt,
          ok: false,
          error: result.error,
        });
      }
      return { ok: false, reason: result.error };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      if (logRefine) {
        console.info("[plan-refine]", {
          taskType,
          model: result.model,
          aiMode: options?.aiMode ?? null,
          retry: false,
          ms: Date.now() - startedAt,
          ok: false,
          error: "invalid_json",
        });
      }
      return { ok: false, reason: "Refine response was not valid JSON." };
    }

    const validated = planRefineLeanResponseSchema.safeParse(parsed);
    if (!validated.success) {
      if (logRefine) {
        console.info("[plan-refine]", {
          taskType,
          model: result.model,
          aiMode: options?.aiMode ?? null,
          retry: false,
          ms: Date.now() - startedAt,
          ok: false,
          error: "invalid_refinement_shape",
        });
      }
      return {
        ok: false,
        reason: "The AI returned an invalid plan draft. Nothing was applied. Try a smaller change or edit it yourself.",
      };
    }

    if (validated.data.steps.length !== draftSteps.length) {
      if (logRefine) {
        console.info("[plan-refine]", {
          taskType,
          model: result.model,
          aiMode: options?.aiMode ?? null,
          retry: false,
          ms: Date.now() - startedAt,
          ok: false,
          error: "step_count_mismatch",
        });
      }
      return {
        ok: false,
        reason:
          "Refinement changed the step count. Try again with narrower instructions, or edit steps individually.",
      };
    }

    if (!validateNoPii([{ field: "proposal", label: "AI proposal", value: JSON.stringify(validated.data) }]).ok || /https?:\/\/|www\./i.test(JSON.stringify(validated.data))) {
      return { ok: false, reason: "The AI included unsupported contact or identifying information. Nothing was applied; try a smaller edit." };
    }
    const matched = matchPlanRowsById(draftSteps, validated.data.steps);
    const merged = draftSteps.map((base, i) => mergeLeanRefineIntoBase(base, matched[i], catalog));

    for (let i = 0; i < merged.length; i++) {
      if (merged[i]!.phase !== draftSteps[i]!.phase) {
        if (logRefine) {
          console.info("[plan-refine]", {
            taskType,
            model: result.model,
            aiMode: options?.aiMode ?? null,
            retry: false,
            ms: Date.now() - startedAt,
            ok: false,
            error: "phase_mismatch",
          });
        }
        return {
          ok: false,
          reason:
            "Refinement changed the goal structure. Keep the existing goals and request wording or date edits.",
        };
      }
    }

    if (logRefine) {
      console.info("[plan-refine]", {
        taskType,
        model: result.model,
        aiMode: options?.aiMode ?? null,
        retry: false,
        ms: Date.now() - startedAt,
        ok: true,
      });
    }

    return { ok: true, steps: merged, model: result.model };
  } catch (e) {
    if (logRefine) {
      console.info("[plan-refine]", {
        taskType,
        model: null,
        aiMode: options?.aiMode ?? null,
        retry: false,
        ms: Date.now() - startedAt,
        ok: false,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "OpenAI refinement failed",
    };
  }
}
