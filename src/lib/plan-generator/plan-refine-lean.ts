import "server-only";

import { z } from "zod";
import type { GeneratedActionItem, GeneratedStepDetails, PlanPhase } from "@/lib/plan-generator/types";
import {
  normalizePlanStep,
  type AiPlanStepParsed,
} from "@/lib/plan-generator/plan-step-openai-schema";

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
    title: { type: "string" },
    description: { type: ["string", "null"] },
    week_index: { type: "integer" },
    target_date: { type: ["string", "null"] },
  },
  required: ["title", "description", "week_index", "target_date"],
  additionalProperties: false,
} as const;

/** Minimal step shape for plan-level refine (no legacy checklist / blockers / rationale in model output). */
const leanPlanStepRefineJsonSchema = {
  type: "object",
  properties: {
    phase: { type: "string", enum: ["30", "60", "90"] },
    title: { type: "string" },
    description: { type: "string" },
    required_documents: { type: "array", items: { type: "string" } },
    contacts: { type: "array", items: contactJsonSchema },
    expected_outcome: { type: "string" },
    timing_guidance: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    action_items: {
      type: "array",
      items: actionItemJsonSchema,
      minItems: 0,
      maxItems: 8,
    },
  },
  required: [
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
  title: z.string().min(1).max(300),
  description: z.union([z.string().max(500), z.null()]).optional(),
  week_index: z.number().int().min(1).max(12),
  target_date: z.union([z.string(), z.null()]).optional(),
});

export const planRefineLeanStepSchema = z.object({
  phase: z.enum(["30", "60", "90"]),
  title: z.string().min(1).max(500),
  description: z.string().max(4000),
  required_documents: z.array(z.string()),
  contacts: z.array(contactSchema),
  expected_outcome: z.string().max(800),
  timing_guidance: z.string().max(400),
  priority: z.union([z.enum(["low", "medium", "high"]), z.null()]).optional(),
  action_items: z.array(leanActionItemSchema).max(8),
});

export const planRefineLeanResponseSchema = z.object({
  steps: z.array(planRefineLeanStepSchema).min(1).max(15),
});

export type PlanRefineLeanStep = z.infer<typeof planRefineLeanStepSchema>;

export type DraftStepRefineInput = {
  phase: PlanPhase;
  title: string;
  description: string;
  details: GeneratedStepDetails;
  action_items: GeneratedActionItem[];
};

/**
 * Maps the server draft wire shape into a full AiPlanStepParsed baseline so lean refine can merge overlays.
 */
export function draftRefineInputToAiParsed(wire: DraftStepRefineInput): AiPlanStepParsed {
  const d = wire.details;
  const checklist =
    d.checklist && d.checklist.length >= 3 ?
      d.checklist.map((c) => c.trim()).filter(Boolean)
    : [
        "Confirm objective and documents for this step",
        "Complete the primary outreach or task",
        "Record outcome and next follow-up in the case file",
      ];

  const actionItems =
    wire.action_items && wire.action_items.length >= 2 ?
      wire.action_items.map((a) => ({
        title: a.title.trim(),
        description: a.description?.trim() || null,
        week_index: a.week_index,
        target_date: a.target_date?.trim() || null,
      }))
    : [
        {
          title: `Start: ${wire.title.slice(0, 80)}`,
          description: "Begin the first concrete task from the step description.",
          week_index: wire.phase === "30" ? 1 : wire.phase === "60" ? 5 : 9,
          target_date: null,
        },
        {
          title: `Follow up: ${wire.title.slice(0, 80)}`,
          description: "Confirm results and document next steps.",
          week_index: wire.phase === "30" ? 2 : wire.phase === "60" ? 6 : 10,
          target_date: null,
        },
      ];

  const contacts = (d.contacts ?? []).map((c) => ({
    name: (c.name ?? "Contact").trim(),
    phone: c.phone?.trim() || null,
    email: c.email?.trim() || null,
    notes: c.notes?.trim() || null,
  }));

  return normalizePlanStep({
    phase: wire.phase,
    title: wire.title.trim() || "Plan step",
    description: wire.description.trim(),
    action_needed_now: (d.action_needed_now ?? wire.title).trim().slice(0, 500),
    action_items: actionItems,
    rationale: (d.rationale ?? `Execute this step: ${wire.title}`).trim().slice(0, 1200),
    detailed_instructions: (d.detailed_instructions ?? wire.description).trim().slice(0, 2000),
    checklist,
    required_documents: (d.required_documents ?? []).map((x) => x.trim()).filter(Boolean),
    contacts: contacts.length > 0 ? contacts : [{ name: "Primary contact", phone: null, email: null, notes: null }],
    blockers:
      d.blockers && d.blockers.length > 0 ?
        d.blockers.map((b) => b.trim()).filter(Boolean)
      : ["Typical: documentation delays, callbacks, or eligibility questions, note in file."],
    fallback_options:
      d.fallback_options && d.fallback_options.length > 0 ?
        d.fallback_options.map((b) => b.trim()).filter(Boolean)
      : ["Try alternate contact channel or supervisor consult if stalled."],
    expected_outcome: (d.expected_outcome ?? `Progress on: ${wire.title}`).trim().slice(0, 600),
    success_marker: (d.success_marker ?? "Primary deliverable documented or next step scheduled.").trim().slice(
      0,
      400,
    ),
    stage_goal: (d.stage_goal ?? wire.title).trim().slice(0, 600),
    why_now: (d.why_now ?? `Fits the ${wire.phase}-day phase priorities.`).trim().slice(0, 600),
    timing_guidance: (d.timing_guidance ?? `Within the ${wire.phase}-day window.`).trim().slice(0, 400),
    priority: d.priority === "high" || d.priority === "medium" || d.priority === "low" ? d.priority : "medium",
    contact_script: d.contact_script?.trim() || null,
    depends_on: d.depends_on?.trim() || null,
    milestone_type: d.milestone_type?.trim() || null,
  });
}

export function mergeLeanRefineIntoBase(base: AiPlanStepParsed, lean: PlanRefineLeanStep): AiPlanStepParsed {
  const description = lean.description.trim() ? lean.description : base.description;
  const title = lean.title.trim() ? lean.title : base.title;

  const required_documents =
    lean.required_documents.length > 0 ? lean.required_documents.map((x) => x.trim()).filter(Boolean) : base.required_documents;

  const contacts =
    lean.contacts.length > 0 ?
      lean.contacts.map((c) => ({
        name: c.name.trim(),
        phone: c.phone?.trim() || undefined,
        email: c.email?.trim() || undefined,
        notes: c.notes?.trim() || undefined,
      }))
    : base.contacts;

  const action_items =
    lean.action_items.length > 0 ?
      lean.action_items.map((a) => ({
        title: a.title.trim(),
        description: a.description?.trim() || null,
        week_index: a.week_index,
        target_date: a.target_date?.trim() || null,
      }))
    : base.action_items;

  const expected_outcome = lean.expected_outcome.trim() ? lean.expected_outcome.trim() : base.expected_outcome;
  const timing_guidance = lean.timing_guidance.trim() ? lean.timing_guidance.trim() : base.timing_guidance;
  const priority = lean.priority ?? base.priority;

  return normalizePlanStep({
    ...base,
    phase: lean.phase,
    title,
    description,
    action_items,
    required_documents,
    contacts,
    expected_outcome,
    timing_guidance,
    priority,
    detailed_instructions:
      description !== base.description ? description : base.detailed_instructions,
    action_needed_now:
      description !== base.description ?
        description.slice(0, 500)
      : base.action_needed_now,
  });
}
