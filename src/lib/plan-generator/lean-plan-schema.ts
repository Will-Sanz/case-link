/**
 * Lean plan step shape for generation: maps into existing plan_steps / details JSONB.
 * "summary" → column `description`; exact action dates provide the schedule.
 * "additional_guidance" → details.detailed_instructions; no default bloat fields in output.
 */

import { z } from "zod";
import type { PlanStepDetails } from "@/types/family";
import type { PlanPhase } from "./types";
import { dateOnlySchema, updatePlanStepActionItemSchema } from "@/lib/validations/plans";
import { toStructuredJsonSchema } from "@/lib/ai/structured-json-schema";
import { contactsForResourceIds, type ResourceCatalogEntry } from "@/lib/matching/plan-resources";

/** Same editable task limits in AI, manual edits, and persistence. Null dates preserve existing drafts. */
export const planActionContentSchema = updatePlanStepActionItemSchema.pick({
  title: true, description: true, week_index: true, target_date: true,
}).required().strict();

export const leanActionItemZ = planActionContentSchema.extend({
  target_date: dateOnlySchema("Every generated action needs a valid target date"),
});

export const leanPlanStepBodyZ = z.strictObject({
  goal: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(4000),
  // The staged-insert RPC accepts up to 20 new tasks per goal.
  action_items: z.array(leanActionItemZ).min(1).max(20),
  timing: z.null(),
  required_documents: z.array(z.string().trim().min(1).max(500)).max(20),
  resource_ids: z.array(z.string().uuid()).max(12),
  expected_outcome: z.string().trim().min(1).max(800),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  additional_guidance: z.string().max(3000).nullable(),
});

export function planPhaseResponseSchema(phase: PlanPhase) {
  return z.strictObject({ steps: z.array(leanPlanStepBodyZ.extend({ phase: z.literal(phase) })).min(1).max(5) });
}

export type LeanPlanStepBody = z.infer<typeof leanPlanStepBodyZ>;
export type LeanPlanPhaseStep = z.infer<ReturnType<typeof planPhaseResponseSchema>>["steps"][number];

function normStr(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

/** Compact details for DB: only user-meaningful keys + optional legacy empties avoided. */
export function leanStepToPlanDetails(lean: LeanPlanStepBody, catalog: ResourceCatalogEntry[] = []): PlanStepDetails {
  const guidance = normStr(lean.additional_guidance ?? undefined) ?? undefined;
  const pri = lean.priority ?? "medium";
  const detailsPriority = pri === "urgent" ? "high" : pri;

  return {
    owner: "case_manager",
    detailed_instructions: guidance,
    expected_outcome: lean.expected_outcome.trim(),
    required_documents: lean.required_documents.map((s) => s.trim()).filter(Boolean),
    contacts: contactsForResourceIds(lean.resource_ids, catalog),
    checklist: [],
    priority: detailsPriority,
    stage_goal: lean.goal.trim(),
  };
}

/** Persist sparse JSON only (lean draft). */
export function sparseDetailsForPersistence(lean: LeanPlanPhaseStep, catalog: ResourceCatalogEntry[] = []): PlanStepDetails {
  return leanStepToPlanDetails(lean, catalog);
}

export function buildLeanPhaseRootJsonSchema(phase: PlanPhase) {
  return toStructuredJsonSchema(planPhaseResponseSchema(phase));
}
