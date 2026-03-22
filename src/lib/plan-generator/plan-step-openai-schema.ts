/**
 * OpenAI Structured Outputs schema + Zod validation for full plan generation.
 * Keeps API schema (strict JSON Schema) aligned with runtime validation.
 */

import { z } from "zod";

/** Minimum substantive content — empty strings pass Zod's z.string() but fail here. */
const MIN_LEN = {
  action_needed_now: 12,
  rationale: 25,
  detailed_instructions: 60,
  why_now: 15,
  stage_goal: 15,
  expected_outcome: 15,
  success_marker: 12,
  timing_guidance: 12,
  checklistItem: 4,
  checklistCount: 3,
  actionItemsCount: 2,
  fallbackOption: 8,
  fallbackCount: 1,
  blocker: 8,
  blockerCount: 1,
} as const;

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

const planStepJsonSchema = {
  type: "object",
  properties: {
    phase: { type: "string", enum: ["30", "60", "90"] },
    title: { type: "string" },
    description: { type: "string" },
    action_needed_now: { type: "string" },
    action_items: {
      type: "array",
      items: actionItemJsonSchema,
      minItems: 2,
      maxItems: 6,
    },
    rationale: { type: "string" },
    detailed_instructions: { type: "string" },
    checklist: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 5,
    },
    required_documents: {
      type: "array",
      items: { type: "string" },
    },
    contacts: {
      type: "array",
      items: contactJsonSchema,
    },
    blockers: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4,
    },
    fallback_options: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
    },
    expected_outcome: { type: "string" },
    success_marker: { type: "string" },
    stage_goal: { type: "string" },
    why_now: { type: "string" },
    timing_guidance: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    contact_script: { type: ["string", "null"] },
    depends_on: { type: ["string", "null"] },
    milestone_type: { type: ["string", "null"] },
  },
  required: [
    "phase",
    "title",
    "description",
    "action_needed_now",
    "action_items",
    "rationale",
    "detailed_instructions",
    "checklist",
    "required_documents",
    "contacts",
    "blockers",
    "fallback_options",
    "expected_outcome",
    "success_marker",
    "stage_goal",
    "why_now",
    "timing_guidance",
    "priority",
    "contact_script",
    "depends_on",
    "milestone_type",
  ],
  additionalProperties: false,
} as const;

/**
 * One plan step as the entire JSON root (used for step refinement calls).
 * Same shape as each element of `steps` in full plan generation.
 */
export const OPENAI_SINGLE_PLAN_STEP_SCHEMA = planStepJsonSchema;

/** Root schema for OpenAI `text.format` / Chat Completions `json_schema`. */
export const OPENAI_PLAN_STEPS_ROOT_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: planStepJsonSchema,
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

const aiActionItemSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.union([z.string().max(500), z.null()]).optional(),
  week_index: z.number().int().min(1).max(12),
  target_date: z.union([z.string(), z.null()]).optional(),
});

/** Shape after JSON parse (nullable fields from OpenAI may be null). */
export const aiPlanStepSchema = z.object({
  phase: z.enum(["30", "60", "90"]),
  title: z.string().min(1).max(500),
  description: z.string().max(4000),
  action_needed_now: z.string().max(500),
  action_items: z.array(aiActionItemSchema).min(2).max(6),
  rationale: z.string().max(1200),
  detailed_instructions: z.string().max(2000),
  checklist: z.array(z.string()).min(3).max(5),
  required_documents: z.array(z.string()),
  contacts: z.array(contactSchema),
  blockers: z.array(z.string()),
  fallback_options: z.array(z.string()),
  expected_outcome: z.string().max(600),
  success_marker: z.string().max(400),
  stage_goal: z.string().max(600),
  why_now: z.string().max(600),
  timing_guidance: z.string().max(400),
  priority: z.enum(["low", "medium", "high"]),
  contact_script: z.union([z.string(), z.null()]).optional(),
  depends_on: z.union([z.string(), z.null()]).optional(),
  milestone_type: z.union([z.string(), z.null()]).optional(),
});

export const aiPlanResponseSchema = z.object({
  steps: z.array(aiPlanStepSchema).min(1).max(15),
});

export type AiPlanStepParsed = z.infer<typeof aiPlanStepSchema>;

const PLACEHOLDER_RE = /^(n\/?a|tbd|todo|\.\.\.|—|-|none)$/i;

function isPlaceholder(s: string): boolean {
  const t = s.trim();
  return t.length === 0 || PLACEHOLDER_RE.test(t);
}

function normStr(v: string | null | undefined): string {
  if (v == null) return "";
  return String(v).trim();
}

function normNullable(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

/** Normalize OpenAI nullables and trim strings on a parsed step. */
export function normalizePlanStep(s: AiPlanStepParsed): AiPlanStepParsed {
  return {
    ...s,
    title: s.title.trim(),
    description: s.description.trim(),
    action_needed_now: s.action_needed_now.trim(),
    rationale: s.rationale.trim(),
    detailed_instructions: s.detailed_instructions.trim(),
    checklist: s.checklist.map((c) => c.trim()).filter(Boolean),
    required_documents: s.required_documents.map((c) => c.trim()).filter(Boolean),
    contacts: s.contacts.map((c) => ({
      name: c.name.trim(),
      phone: normNullable(c.phone as string | null | undefined),
      email: normNullable(c.email as string | null | undefined),
      notes: normNullable(c.notes as string | null | undefined),
    })),
    blockers: s.blockers.map((c) => c.trim()).filter(Boolean),
    fallback_options: s.fallback_options.map((c) => c.trim()).filter(Boolean),
    expected_outcome: s.expected_outcome.trim(),
    success_marker: s.success_marker.trim(),
    stage_goal: s.stage_goal.trim(),
    why_now: s.why_now.trim(),
    timing_guidance: s.timing_guidance.trim(),
    action_items: s.action_items.map((a) => ({
      title: a.title.trim(),
      description: normNullable(a.description as string | null | undefined),
      week_index: a.week_index,
      target_date: normNullable(a.target_date as string | null | undefined),
    })),
    contact_script: normNullable(s.contact_script as string | null | undefined),
    depends_on: normNullable(s.depends_on as string | null | undefined),
    milestone_type: normNullable(s.milestone_type as string | null | undefined),
  };
}

export type RichnessResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

/**
 * Ensures each step has deep, operational content (not single-field stubs).
 */
export function validatePlanStepsRichness(steps: AiPlanStepParsed[]): RichnessResult {
  const reasons: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const label = `Step ${i + 1} (“${s.title.slice(0, 40)}${s.title.length > 40 ? "…" : ""}”)`;

    const check = (field: string, val: string, min: number) => {
      if (isPlaceholder(val) || val.length < min) {
        reasons.push(
          `${label}: "${field}" must be substantive (min ~${min} chars, not placeholder).`,
        );
      }
    };

    check("action_needed_now", s.action_needed_now, MIN_LEN.action_needed_now);
    check("rationale", s.rationale, MIN_LEN.rationale);
    check("detailed_instructions", s.detailed_instructions, MIN_LEN.detailed_instructions);
    check("why_now", s.why_now, MIN_LEN.why_now);
    check("stage_goal", s.stage_goal, MIN_LEN.stage_goal);
    check("expected_outcome", s.expected_outcome, MIN_LEN.expected_outcome);
    check("success_marker", s.success_marker, MIN_LEN.success_marker);
    check("timing_guidance", s.timing_guidance, MIN_LEN.timing_guidance);

    if (s.checklist.length < MIN_LEN.checklistCount) {
      reasons.push(`${label}: checklist must have at least ${MIN_LEN.checklistCount} concrete items.`);
    }
    for (let j = 0; j < s.checklist.length; j++) {
      if (isPlaceholder(s.checklist[j]) || s.checklist[j].length < MIN_LEN.checklistItem) {
        reasons.push(`${label}: checklist item ${j + 1} is too vague or empty.`);
      }
    }

    if (s.action_items.length < MIN_LEN.actionItemsCount) {
      reasons.push(`${label}: need at least ${MIN_LEN.actionItemsCount} action_items.`);
    }

    if (s.fallback_options.length < MIN_LEN.fallbackCount) {
      reasons.push(`${label}: need at least ${MIN_LEN.fallbackCount} fallback_option(s).`);
    }
    for (const fb of s.fallback_options) {
      if (isPlaceholder(fb) || fb.length < MIN_LEN.fallbackOption) {
        reasons.push(`${label}: each fallback_option must be specific (not generic or empty).`);
        break;
      }
    }

    if (s.blockers.length < MIN_LEN.blockerCount) {
      reasons.push(`${label}: need at least ${MIN_LEN.blockerCount} blocker (use "Common: …" if none obvious).`);
    }
    for (const b of s.blockers) {
      if (isPlaceholder(b) || b.length < MIN_LEN.blocker) {
        reasons.push(`${label}: each blocker entry must be substantive.`);
        break;
      }
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Weak verbs that signal passive/assessment-heavy steps. 30-day steps should avoid these at the start. */
const WEAK_START_PATTERNS = /\b(assess|explore|identify|connect with|review options?|evaluate|understand|document)\b/i;

/** Strong action verbs we want in 30-day steps. */
const STRONG_ACTION_PATTERN =
  /\b(call|schedule|apply|submit|confirm|register|request|book|gather|send|escalate|secure|enroll|reach out|contact|file|complete)\b/i;

/**
 * Validates that 30-day phase steps are action-oriented, not assessment-heavy.
 * Fails if a 30-day step's title or action_needed_now starts with weak verbs and lacks strong action verbs.
 */
export function validate30DayActionOrientation(
  steps: AiPlanStepParsed[],
): RichnessResult {
  const reasons: string[] = [];
  const thirtyDaySteps = steps.filter((s) => s.phase === "30");

  for (let i = 0; i < thirtyDaySteps.length; i++) {
    const s = thirtyDaySteps[i];
    const label = `30-day step "${s.title.slice(0, 50)}${s.title.length > 50 ? "…" : ""}"`;
    const combined = `${s.title} ${s.action_needed_now}`.toLowerCase();
    const hasWeakStart = WEAK_START_PATTERNS.test(combined.slice(0, 80));
    const hasStrongAction = STRONG_ACTION_PATTERN.test(combined);

    if (hasWeakStart && !hasStrongAction) {
      reasons.push(
        `${label}: too passive. Use action verbs (call, schedule, apply, submit, register, etc.) and embed any assessment into a concrete same-day/week action.`,
      );
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * Last-resort fill so persisted steps are never bare stubs after exhausted retries.
 */
export function applyPlanStepDefaults(step: AiPlanStepParsed): AiPlanStepParsed {
  const title = step.title.trim() || "Plan step";
  const out = normalizePlanStep({ ...step });

  const ensure = (val: string, fallback: string) =>
    isPlaceholder(val) || val.length < 8 ? fallback : val;

  out.rationale = ensure(
    out.rationale,
    `This step advances the household toward their goals by executing: ${title}. Document what you did and outcomes for the file.`,
  );
  out.why_now = ensure(
    out.why_now,
    `This belongs in the ${out.phase}-day phase to keep momentum and meet timelines tied to "${title}".`,
  );
  out.stage_goal = ensure(
    out.stage_goal,
    `Move "${title}" forward with clear accountability and next checkpoints.`,
  );
  out.detailed_instructions = ensure(
    out.detailed_instructions,
    `${out.action_needed_now}\n\n1) Prepare what you need (documents, phone numbers, calendar).\n2) Execute the primary outreach or task for this step.\n3) Record who you spoke with, dates, and any follow-up promised.\n4) Update the case file and set the next follow-up date.`,
  );
  out.expected_outcome = ensure(
    out.expected_outcome,
    `The family or case has measurable progress on "${title}" (appointment set, application submitted, or barrier removed/documented).`,
  );
  out.success_marker = ensure(
    out.success_marker,
    `You can check this step complete when the main deliverable for "${title}" is done and documented.`,
  );
  out.timing_guidance = ensure(
    out.timing_guidance,
    `Complete during the ${out.phase}-day window; prioritize within 3–5 business days unless crisis factors apply.`,
  );

  if (out.checklist.length < MIN_LEN.checklistCount) {
    const base = [
      `Confirm objective for: ${title}`,
      "Complete the primary task or call listed in action needed now",
      "Log outcome, names, and next follow-up date in the case file",
    ];
    out.checklist = [...out.checklist, ...base].slice(0, 5);
  }

  if (out.action_items.length < MIN_LEN.actionItemsCount) {
    out.action_items = [
      ...out.action_items,
      {
        title: `Kick off: ${title}`,
        description: "Start the first concrete task from detailed instructions.",
        week_index: out.phase === "30" ? 1 : out.phase === "60" ? 5 : 9,
        target_date: null,
      },
      {
        title: `Follow up and document: ${title}`,
        description: "Confirm result and record next steps.",
        week_index: out.phase === "30" ? 2 : out.phase === "60" ? 6 : 10,
        target_date: null,
      },
    ].slice(0, 6);
  }

  if (out.fallback_options.length < MIN_LEN.fallbackCount) {
    out.fallback_options = [
      ...out.fallback_options,
      "If the primary contact is unreachable, leave voicemail with callback number and try alternate hours or a backup program from resources.",
    ];
  }

  if (out.blockers.length < MIN_LEN.blockerCount) {
    out.blockers = [
      ...out.blockers,
      "Typical: missing documents, no callback, or eligibility uncertainty—address in session notes and adjust timeline.",
    ];
  }

  if (out.required_documents.length === 0) {
    out.required_documents = [
      "Government-issued ID for adults",
      "Proof of household composition (as applicable)",
      "Any program-specific forms referenced in detailed instructions",
    ];
  }

  return normalizePlanStep(out);
}
