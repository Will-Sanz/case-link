import { z } from "zod";
import { findLikelyIdentifiers } from "../privacy/no-pii";

/** Chat is for questions; application identifiers and secrets use an approved provider's direct channel. */
export function hasExcludedAssistantInformation(value: string): boolean {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  return (
    findLikelyIdentifiers(normalized).length > 0 ||
    /\d{3}[-.\/\s‐‑‒–—―]*\d{2}[-.\/\s‐‑‒–—―]*\d{4}|\d{12,19}/.test(
      normalized,
    ) ||
    /\b(?:password|passcode|pin|ssn|social\s+security(?:\s+number)?|account\s+(?:number|no)|ebt)\s*(?:is\s+|[:=#]\s*)\S+/i.test(
      normalized,
    )
  );
}

export const assistantQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    idempotencyKey: z.uuid(),
    consented: z.literal(true),
  })
  .strict()
  .superRefine(({ question }, context) => {
    if (hasExcludedAssistantInformation(question))
      context.addIssue({
        code: "custom",
        path: ["question"],
        message:
          "Remove personal identifiers, account numbers, passwords and PINs before sending. Enter any required identity details directly with the official program.",
      });
  });
export type AssistantQuestion = z.infer<typeof assistantQuestionSchema>;
export type ParentAssistantAnswer = {
  intro: string;
  paragraphs: {
    text: string;
    sourceLabel: string;
    sourceUrl?: string;
    recordedAt?: string;
  }[];
  actionIds: string[];
};
export type ParentAssistantMessage = {
  id: string;
  question: string;
  status: "queued" | "running" | "answered" | "failed";
  answer: ParentAssistantAnswer | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};
export type ParentAssistantConversation = {
  messages: ParentAssistantMessage[];
  available: boolean;
  unavailableReason: string | null;
  historyLimited: boolean;
};
