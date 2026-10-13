import { z } from "zod";

export const dateOnlySchema = (message: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, message)
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    }, message);

export const aiModeSchema = z.enum(["fast", "thinking"]).optional();

const planStepDetailsSchema = z.object({
  owner: z.enum(["case_manager", "family", "school_program", "shared"]).optional(),
  /** Short, concrete next action for the case manager. */
  action_needed_now: z.string().optional(),
  rationale: z.string().optional(),
  detailed_instructions: z.string().optional(),
  checklist: z.array(z.string()).optional(),
  required_documents: z.array(z.string()).optional(),
  contact_script: z.string().optional(),
  materials_needed: z.array(z.string()).optional(),
  contacts: z
    .array(
      z.object({
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
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

const planStepWorkflowSchema = z.object({
  blocker_reason: z.string().nullable().optional(),
  outcome_notes: z.string().nullable().optional(),
  contact_attempted_at: z.string().nullable().optional(),
  outreach_result: z.string().nullable().optional(),
  needs_escalation: z.boolean().optional(),
  documents_received: z.boolean().optional(),
  family_understood: z.boolean().optional(),
  case_manager_assisted: z.boolean().optional(),
  checklist_completed: z.array(z.boolean()).optional(),
});

export const stagedPlanStartSchema = z.object({
  familyId: z.string().uuid(),
  regenerationFeedback: z.string().max(4000).optional(),
  aiMode: aiModeSchema,
});

export const stagedPlanAdvanceSchema = z.object({
  familyId: z.string().uuid(),
  aiMode: aiModeSchema,
});

export const planClientDisplaySchema = z.object({
  title: z.string().max(200).optional(),
  phaseSummaries: z
    .object({
      "30": z.string().max(2000).optional(),
      "60": z.string().max(2000).optional(),
      "90": z.string().max(2000).optional(),
    })
    .optional(),
});

export const updatePlanSchema = z.object({
  familyId: z.string().uuid(),
  /** Internal plan label (e.g. version line). */
  summary: z.string().max(500).optional(),
  clientDisplay: planClientDisplaySchema.optional(),
});

export const markPlanReviewedSchema = z.object({
  familyId: z.string().uuid(),
  planId: z.string().uuid(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
});

export const updatePlanStepSchema = z.object({
  stepId: z.string().uuid(),
  familyId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
  details: planStepDetailsSchema.optional(),
  workflow_data: planStepWorkflowSchema.optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  phase: z.enum(["30", "60", "90"]).optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
});

export const createManualStepSchema = z
  .object({
    familyId: z.string().uuid(),
    planId: z.string().uuid(),
    goal: z.string().trim().min(1, "Goal is required").max(500),
    title: z.string().min(1, "Title is required").max(500),
    description: z.string().max(4000).optional().default(""),
    target_date: dateOnlySchema("Choose a valid target date"),
    details: planStepDetailsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!value.details?.expected_outcome?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["details", "expected_outcome"],
        message: "Expected result is required",
      });
    }
  });

export const deletePlanStepSchema = z.object({
  stepId: z.string().uuid(),
  familyId: z.string().uuid(),
});

export const linkResourceToStepSchema = z.object({
  matchId: z.string().uuid(),
  familyId: z.string().uuid(),
  stepId: z.string().uuid(),
});

export const updatePlanStepActionItemSchema = z.object({
  actionItemId: z.string().uuid(),
  familyId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(4000).nullable().optional(),
  week_index: z.number().int().min(1).max(52).optional(),
  target_date: z
    .union([dateOnlySchema("Use a valid target date"), z.null()])
    .optional(),
  outcome: z.string().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  follow_up_date: z
    .union([dateOnlySchema("Use a valid follow-up date"), z.null()])
    .optional(),
});

export const refineStepSchema = z.object({
  stepId: z.string().uuid(),
  familyId: z.string().uuid(),
  feedback: z.string().min(1, "Feedback is required").max(2000),
  aiMode: aiModeSchema,
});

export const savePlanEditsSchema = z.object({
  familyId: z.string().uuid(),
  planId: z.string().uuid(),
  steps: z.array(z.object({
    stepId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    patch: updatePlanStepSchema.omit({ familyId: true, stepId: true, expectedUpdatedAt: true }).strict(),
    actionItems: z.array(z.object({
      actionItemId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      patch: updatePlanStepActionItemSchema.omit({ familyId: true, actionItemId: true, expectedUpdatedAt: true }).strict(),
    })).max(50),
  })).min(1).max(15),
});
export type SavePlanEditsInput = z.infer<typeof savePlanEditsSchema>;

const previewDraftActionItemSchema = z.object({
  id: z.string().uuid(),
  updated_at: z.string().datetime({ offset: true }),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  notes: z.string().max(2000).nullable(),
  outcome: z.string().max(2000).nullable(),
  follow_up_date: dateOnlySchema("Use a valid follow-up date").nullable(),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(4000).nullable(),
  week_index: z.number().int().min(1).max(52),
  target_date: dateOnlySchema("Use a valid target date").nullable(),
});

export const previewStepDraftSchema = z.object({
  id: z.string().uuid(),
  updated_at: z.string().datetime({ offset: true }),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  workflow_data: planStepWorkflowSchema.optional(),
  phase: z.enum(["30", "60", "90"]),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(4000),
  details: planStepDetailsSchema.optional(),
  action_items: z.array(previewDraftActionItemSchema).max(50),
});

export const previewRefinePlanSchema = z.object({
  familyId: z.string().uuid(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  feedback: z.string().min(1, "Feedback is required").max(2000),
  aiMode: aiModeSchema,
  draft: z.object({
    steps: z.array(previewStepDraftSchema).min(1).max(15),
  }),
});


export const previewRefineStepSchema = refineStepSchema.extend({
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), draft: previewStepDraftSchema,
});
