import { z } from "zod";

export const generatePlanSchema = z.object({
  familyId: z.string().uuid(),
});

export const updatePlanStepSchema = z.object({
  stepId: z.string().uuid(),
  familyId: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
});

export const createManualStepSchema = z.object({
  familyId: z.string().uuid(),
  planId: z.string().uuid(),
  phase: z.enum(["30", "60", "90"]),
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().max(4000).optional().default(""),
});

export const deletePlanStepSchema = z.object({
  stepId: z.string().uuid(),
  familyId: z.string().uuid(),
});
