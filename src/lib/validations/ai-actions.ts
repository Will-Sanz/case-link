import { z } from "zod";
import { aiModeSchema } from "@/lib/validations/plans";

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
