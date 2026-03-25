/**
 * Lean plan step shape for generation + refinement: maps into existing plan_steps / details JSONB.
 * "summary" → column `description`; "timing" → details.timing_guidance;
 * "additional_guidance" → details.detailed_instructions; no default bloat fields in output.
 */

import { z } from "zod";
import type { PlanStepDetails } from "@/types/family";
import type { GeneratedActionItem, GeneratedStep, GeneratedStepDetails, PlanPhase } from "./types";

const contactLeanZ = z.object({
  name: z.string(),
  phone: z.union([z.string(), z.null()]).optional(),
  email: z.union([z.string(), z.null()]).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
});

export const leanActionItemZ = z.object({
  title: z.string().min(1).max(300),
  description: z.union([z.string().max(500), z.null()]).optional(),
  week_index: z.number().int().min(1).max(12),
  target_date: z.union([z.string(), z.null()]).optional(),
});

/** One step from the model (phase may be omitted in single-step refine — caller supplies). */
export const leanPlanStepBodyZ = z.object({
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(4000),
  action_items: z.array(leanActionItemZ).min(1).max(5),
  timing: z.union([z.string().max(400), z.null()]).optional(),
  required_documents: z.array(z.string()).max(20),
  contacts: z.array(contactLeanZ).max(12),
  expected_outcome: z.string().min(1).max(800),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  additional_guidance: z.union([z.string().max(3000), z.null()]).optional(),
});

export const leanPlanPhaseResponseZ = z.object({
  steps: z.array(leanPlanStepBodyZ.extend({ phase: z.enum(["30", "60", "90"]) })).min(1).max(5),
});

/** Single step refinement (root JSON = one step). */
export const leanSingleStepZ = leanPlanStepBodyZ.extend({
  phase: z.enum(["30", "60", "90"]),
});

export type LeanPlanStepBody = z.infer<typeof leanPlanStepBodyZ>;
export type LeanPlanPhaseStep = z.infer<typeof leanPlanPhaseResponseZ>["steps"][number];

function normStr(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

/** Compact details for DB: only user-meaningful keys + optional legacy empties avoided. */
export function leanStepToPlanDetails(lean: LeanPlanStepBody, phase: PlanPhase): PlanStepDetails {
  const timing = normStr(lean.timing ?? undefined) ?? undefined;
  const guidance = normStr(lean.additional_guidance ?? undefined) ?? undefined;
  const pri = lean.priority ?? "medium";
  const detailsPriority = pri === "urgent" ? "high" : pri;

  const stageGoals: Record<PlanPhase, string> = {
    "30": "Stabilize and start concrete outreach this month.",
    "60": "Follow through on applications and appointments.",
    "90": "Sustain gains and close remaining gaps.",
  };

  return {
    timing_guidance: timing ?? `Within the ${phase}-day window; confirm dates with each agency.`,
    detailed_instructions: guidance,
    expected_outcome: lean.expected_outcome.trim(),
    required_documents: lean.required_documents.map((s) => s.trim()).filter(Boolean),
    contacts: lean.contacts.map((c) => ({
      name: c.name.trim(),
      phone: normStr(c.phone as string | null | undefined),
      email: normStr(c.email as string | null | undefined),
      notes: normStr(c.notes as string | null | undefined),
    })),
    checklist: [],
    priority: detailsPriority,
    stage_goal: stageGoals[phase],
  };
}

/**
 * Build GeneratedStep for ensureActionItems + insert pipeline (fills required GeneratedStepDetails).
 */
export function leanPhaseStepToGeneratedStep(
  lean: LeanPlanPhaseStep,
  sort_order: number,
): GeneratedStep {
  const phase = lean.phase;
  const sparse = leanStepToPlanDetails(lean, phase);
  const actionItems: GeneratedActionItem[] = lean.action_items.map((a) => ({
    title: a.title.trim(),
    description: normStr(a.description as string | null | undefined),
    week_index: a.week_index,
    target_date: normStr(a.target_date as string | null | undefined),
  }));

  const summary = lean.summary.trim();
  const fullDetails: GeneratedStepDetails = {
    action_needed_now: actionItems[0]?.title ?? summary.slice(0, 200),
    rationale: "",
    detailed_instructions: sparse.detailed_instructions ?? "",
    checklist: [],
    required_documents: sparse.required_documents ?? [],
    contacts: (sparse.contacts ?? []).map((c) => ({
      name: c.name ?? "",
      phone: c.phone,
      email: c.email,
      notes: c.notes,
    })),
    blockers: [],
    fallback_options: [],
    expected_outcome: sparse.expected_outcome ?? "",
    timing_guidance: sparse.timing_guidance ?? "",
    priority: (sparse.priority ?? "medium") as "low" | "medium" | "high",
    stage_goal: sparse.stage_goal ?? "",
    why_now: "",
    success_marker: sparse.expected_outcome ?? "",
  };

  return {
    phase,
    title: lean.title.trim(),
    description: summary,
    sort_order,
    details: fullDetails,
    action_items: actionItems,
  };
}

/** Persist sparse JSON only (lean draft). */
export function sparseDetailsForPersistence(lean: LeanPlanPhaseStep): PlanStepDetails {
  return leanStepToPlanDetails(lean, lean.phase);
}

const leanStepObjectFields = {
  phase: { type: "string", enum: ["30", "60", "90"] },
  title: { type: "string" },
  summary: { type: "string" },
  action_items: {
    type: "array",
    minItems: 1,
    maxItems: 5,
    items: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: ["string", "null"] },
        week_index: { type: "integer" },
        target_date: { type: ["string", "null"] },
      },
      required: ["title", "description", "week_index", "target_date"],
      additionalProperties: false,
    },
  },
  timing: { type: ["string", "null"] },
  required_documents: { type: "array", items: { type: "string" } },
  contacts: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        notes: { type: ["string", "null"] },
      },
      required: ["name", "phone", "email", "notes"],
      additionalProperties: false,
    },
  },
  expected_outcome: { type: "string" },
  priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
  additional_guidance: { type: ["string", "null"] },
} as const;

const leanStepRequired = [
  "phase",
  "title",
  "summary",
  "action_items",
  "timing",
  "required_documents",
  "contacts",
  "expected_outcome",
  "priority",
  "additional_guidance",
] as const;

export function buildLeanPhaseRootJsonSchema(phase: PlanPhase) {
  const stepProps = {
    type: "object",
    properties: {
      phase: { type: "string", enum: [phase] },
      title: { type: "string" },
      summary: { type: "string" },
      action_items: leanStepObjectFields.action_items,
      timing: leanStepObjectFields.timing,
      required_documents: leanStepObjectFields.required_documents,
      contacts: leanStepObjectFields.contacts,
      expected_outcome: leanStepObjectFields.expected_outcome,
      priority: leanStepObjectFields.priority,
      additional_guidance: leanStepObjectFields.additional_guidance,
    },
    required: [...leanStepRequired],
    additionalProperties: false,
  } as const;

  return {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: stepProps,
        minItems: 1,
        maxItems: 5,
      },
    },
    required: ["steps"],
    additionalProperties: false,
  } as const;
}

/** Single-step root for refinement. */
export function buildLeanSingleStepRootJsonSchema() {
  return {
    type: "object",
    properties: { ...leanStepObjectFields },
    required: [...leanStepRequired],
    additionalProperties: false,
  } as const;
}
