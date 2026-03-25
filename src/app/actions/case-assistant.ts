"use server";

import { requireAppUserWithClient } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { getFamilyDetail } from "@/lib/services/families";
import type { AiMode } from "@/lib/ai/ai-mode";
import { askCaseAssistant } from "@/lib/case-assistant/ai-case-assistant";

export type CaseAssistantResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

export async function askCaseAssistantAction(
  familyId: string,
  question: string,
  aiMode?: AiMode,
): Promise<CaseAssistantResult> {
  try {
    const session = await requireAppUserWithClient();
    const supabase = session.supabase;
    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Family not found" };

    if (!getEnv().OPENAI_API_KEY?.trim()) {
      return { ok: false, error: "AI requires OPENAI_API_KEY" };
    }

    return await askCaseAssistant(detail, question, { aiMode });
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
}
