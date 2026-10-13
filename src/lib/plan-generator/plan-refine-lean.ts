import "server-only";

import { z } from "zod";
import type { PlanPhase } from "@/lib/plan-generator/types";
import type { PlanStepDetails, PlanStepRow, PlanStepActionItemRow } from "@/types/family";
import { dateOnlySchema } from "@/lib/validations/plans";
import { matchPlanRowsById } from "@/lib/domain/plan/refinement-identity";

const contactJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    phone: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
  },
  required: ["name", "phone", "email", "notes"],
  additionalProperties: false,
} as const;

const actionItemJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: ["string", "null"] },
    week_index: { type: "integer" },
    target_date: { type: ["string", "null"] },
  },
  required: ["id", "title", "description", "week_index", "target_date"],
  additionalProperties: false,
} as const;

/** Minimal step shape for plan-level refine (no legacy checklist / blockers / rationale in model output). */
const leanPlanStepRefineJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    phase: { type: "string", enum: ["30", "60", "90"] },
    title: { type: "string" },
    description: { type: "string" },
    required_documents: { type: ["array", "null"], items: { type: "string" } },
    contacts: { type: ["array", "null"], items: contactJsonSchema },
    expected_outcome: { type: "string" },
    timing_guidance: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    action_items: {
      type: ["array", "null"],
      items: actionItemJsonSchema,
      minItems: 0,
      maxItems: 50,
    },
  },
  required: [
    "id",
    "phase",
    "title",
    "description",
    "required_documents",
    "contacts",
    "expected_outcome",
    "timing_guidance",
    "action_items",
  ],
  additionalProperties: false,
} as const;

export const OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: leanPlanStepRefineJsonSchema,
      minItems: 1,
      maxItems: 15,
    },
  },
  required: ["steps"],
  additionalProperties: false,
} as const;

const contactSchema = z.object({
  name: z.string(),
  phone: z.union([z.string(), z.null()]).optional(),
  email: z.union([z.string(), z.null()]).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
});

const leanActionItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  description: z.union([z.string().max(4000), z.null()]).optional(),
  week_index: z.number().int().min(1).max(52),
  target_date: z.union([dateOnlySchema("Use a valid target date"), z.null()]).optional(),
});

export const planRefineLeanStepSchema = z.object({
  id: z.string().uuid(),
  phase: z.enum(["30", "60", "90"]),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(4000),
  required_documents: z.array(z.string()).nullable(),
  contacts: z.array(contactSchema).nullable(),
  expected_outcome: z.string().max(800),
  timing_guidance: z.string().max(400),
  priority: z.union([z.enum(["low", "medium", "high"]), z.null()]).optional(),
  action_items: z.array(leanActionItemSchema).max(50).nullable(),
});

export const planRefineLeanResponseSchema = z.object({
  steps: z.array(planRefineLeanStepSchema).min(1).max(15),
});

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
  action_items: Array<z.infer<typeof leanActionItemSchema> & Pick<PlanStepActionItemRow, "updated_at" | "status" | "notes" | "outcome" | "follow_up_date">>;
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
    action_items: base.action_items.map((action, i) => ({ ...action, ...actions[i] })),
  };
}
