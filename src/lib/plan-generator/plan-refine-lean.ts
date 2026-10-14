import { z } from "zod";
import type { PlanPhase } from "@/lib/plan-generator/types";
import type { PlanStepDetails, PlanStepRow, PlanStepActionItemRow } from "@/types/family";
import { planActionContentSchema, planContactSchema } from "./lean-plan-schema";
import { toStructuredJsonSchema } from "@/lib/ai/structured-json-schema";
import { matchPlanRowsById } from "@/lib/domain/plan/refinement-identity";

const leanActionItemSchema = planActionContentSchema.extend({ id: z.string().uuid() });

export const planRefineLeanStepSchema = z.strictObject({
  id: z.string().uuid(),
  phase: z.enum(["30", "60", "90"]),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(4000),
  required_documents: z.array(z.string().trim().min(1).max(500)).max(20).nullable(),
  contacts: z.array(planContactSchema).max(12).nullable(),
  expected_outcome: z.string().max(800),
  timing_guidance: z.string().max(400),
  priority: z.enum(["low", "medium", "high"]).nullable(),
  action_items: z.array(leanActionItemSchema).max(50).nullable(),
});

export const planRefineLeanResponseSchema = z.strictObject({
  steps: z.array(planRefineLeanStepSchema).min(1).max(15),
});

export const OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA = toStructuredJsonSchema(planRefineLeanResponseSchema);

export type PlanRefineLeanStep = z.infer<typeof planRefineLeanStepSchema>;

export type DraftStepRefineInput = {
  id: string;
  updated_at: string;
  status: PlanStepRow["status"];
  workflow_data?: PlanStepRow["workflow_data"];
  phase: PlanPhase;
  title: string;
  description: string;
  details: PlanStepDetails;
  action_items: Array<Pick<PlanStepActionItemRow, "id" | "title" | "description" | "week_index" | "target_date" | "updated_at" | "status" | "notes" | "outcome" | "follow_up_date">>;
};

/** Null leaves a list unchanged; an empty list explicitly clears it. */
export function mergeLeanRefineIntoBase(base: DraftStepRefineInput, lean: PlanRefineLeanStep): DraftStepRefineInput {
  matchPlanRowsById([base], [lean]);
  const actions = matchPlanRowsById(base.action_items, lean.action_items ?? base.action_items);
  return {
    ...base,
    phase: lean.phase,
    title: lean.title.trim(),
    description: lean.description.trim(),
    details: {
      ...base.details,
      ...(lean.required_documents !== null ? { required_documents: lean.required_documents.map(value => value.trim()).filter(Boolean), materials_needed: undefined } : {}),
      ...(lean.contacts !== null ? { contacts: lean.contacts.map(contact => ({
        name: contact.name.trim(), phone: contact.phone?.trim() || undefined,
        email: contact.email?.trim() || undefined, notes: contact.notes?.trim() || undefined,
      })) } : {}),
      expected_outcome: lean.expected_outcome.trim(),
      timing_guidance: lean.timing_guidance.trim(),
      ...(lean.priority != null ? { priority: lean.priority } : {}),
    },
    action_items: lean.action_items === null ? base.action_items : base.action_items.map((action, i) => ({
      ...action, ...actions[i], target_date: actions[i].target_date ?? action.target_date, week_index: action.week_index,
      ...(action.status === "blocked" && actions[i].target_date ? { follow_up_date: actions[i].target_date } : {}),
    })),
  };
}
