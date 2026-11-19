import { z } from "zod";
import { aiModeSchema } from "@/lib/validations/plans";
import { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGE_CHARS, MAX_QUESTION_CHARS } from "@/lib/case-assistant/conversation-history";

const caseAssistantHistoryItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(MAX_HISTORY_MESSAGE_CHARS),
});

export const askCaseAssistantInputSchema = z.object({
  familyId: z.string().uuid(),
  question: z.string().trim().min(1, "Message is required").max(MAX_QUESTION_CHARS),
  aiMode: aiModeSchema,
  conversationHistory: z.array(caseAssistantHistoryItemSchema).max(MAX_HISTORY_MESSAGES)
    .refine((history) => history.reduce((sum, message) => sum + message.content.length, 0) <= MAX_HISTORY_CHARS, "Conversation is too large")
    .refine((history) => history.length % 2 === 0 && history.every((message, index) => message.role === (index % 2 ? "assistant" : "user")), "Send complete question and answer pairs")
    .optional(),
});
