import { z } from "zod";
import { aiModeSchema } from "@/lib/validations/plans";
import { STEP_HELPER_TYPES, type StepHelperType } from "@/types/step-helper";

const stepHelperTypeSchema = z.custom<StepHelperType>(
  (v): v is StepHelperType =>
    typeof v === "string" && (STEP_HELPER_TYPES as readonly string[]).includes(v),
  { message: "Invalid helper type" },
);

const caseAssistantHistoryItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

export const askCaseAssistantInputSchema = z.object({
  familyId: z.string().uuid(),
  question: z.string().trim().min(1, "Message is required").max(4000),
  aiMode: aiModeSchema,
  conversationHistory: z.array(caseAssistantHistoryItemSchema).max(40).optional(),
});

export const stepHelperActionInputSchema = z.object({
  stepId: z.string().uuid(),
  familyId: z.string().uuid(),
  helperType: stepHelperTypeSchema,
  aiMode: aiModeSchema,
});

export const suggestNextMoveInputSchema = z.object({
  stepId: z.string().uuid(),
  familyId: z.string().uuid(),
  aiMode: aiModeSchema,
});
