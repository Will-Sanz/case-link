"use server";

import { requireAppUserWithClient } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { getFamilyDetail } from "@/lib/services/families";
import { askCaseAssistant } from "@/lib/case-assistant/ai-case-assistant";
import type { CaseAssistantHistoryItem } from "@/types/case-assistant";
import type { AiMode } from "@/lib/ai/ai-mode";
import { askCaseAssistantInputSchema } from "@/lib/validations/ai-actions";

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

  try {
    const session = await requireAppUserWithClient();
    const supabase = session.supabase;
    const detail = await getFamilyDetail(supabase, parsed.data.familyId);
    if (!detail) return { ok: false, error: "Family not found" };

    if (!getEnv().OPENAI_API_KEY?.trim()) {
      return { ok: false, error: "AI is not configured." };
    }

    return await askCaseAssistant(detail, parsed.data.question, {
      aiMode: parsed.data.aiMode,
      conversationHistory: parsed.data.conversationHistory,
      requestMeta: { userId: session.user.id, route: "caseAssistant" },
    });
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
}
