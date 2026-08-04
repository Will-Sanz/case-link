"use server";

import { requireAppUserWithClient } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { getFamilyDetail } from "@/lib/services/families";
import { askCaseAssistant } from "@/lib/case-assistant/ai-case-assistant";
import type { CaseAssistantHistoryItem } from "@/types/case-assistant";
import type { AiMode } from "@/lib/ai/ai-mode";
import { askCaseAssistantInputSchema } from "@/lib/validations/ai-actions";
import { validateFamilyNoPii } from "@/lib/privacy/no-pii";
import { publicSessionError } from "@/lib/auth/session-errors";
import { publicMessageFromCaughtError } from "@/lib/errors/public-action-error";

export type CaseAssistantResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

export type { CaseAssistantHistoryItem } from "@/types/case-assistant";

export async function askCaseAssistantAction(
  familyId: string,
  question: string,
  aiMode?: AiMode,
  conversationHistory?: CaseAssistantHistoryItem[],
): Promise<CaseAssistantResult> {
  const parsed = askCaseAssistantInputSchema.safeParse({
    familyId,
    question,
    aiMode,
    conversationHistory,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  let session;
  try {
    session = await requireAppUserWithClient();
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  try {
    const supabase = session.supabase;
    const detail = await getFamilyDetail(supabase, parsed.data.familyId);
    if (!detail) return { ok: false, error: "Family not found" };
    const privacy = validateFamilyNoPii(detail, [
      { field: "question", label: "Assistant question", value: parsed.data.question },
      ...(parsed.data.conversationHistory ?? []).map((message, index) => ({
        field: `conversationHistory.${index}.content`,
        label: "Assistant conversation",
        value: message.content,
      })),
    ]);
    if (!privacy.ok) {
      return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
    }

    if (!getEnv().OPENAI_API_KEY?.trim()) {
      return { ok: false, error: "AI is not configured." };
    }

    return await askCaseAssistant(detail, parsed.data.question, {
      aiMode: parsed.data.aiMode,
      conversationHistory: parsed.data.conversationHistory,
      requestMeta: { route: "caseAssistant" },
    });
  } catch (error) {
    return {
      ok: false,
      error: publicMessageFromCaughtError(
        "askCaseAssistantAction",
        error,
        "The assistant could not complete this request. Try again.",
      ),
    };
  }
}
