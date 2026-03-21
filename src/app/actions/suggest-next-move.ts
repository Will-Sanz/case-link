"use server";

import { requireAppUserWithClient } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { getFamilyDetail } from "@/lib/services/families";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SuggestResult =
  | { ok: true; suggestions: string[] }
  | { ok: false; error: string };

/**
 * AI-assisted suggestion for a blocked plan step. Uses OpenAI when available;
 * otherwise returns fallback suggestions from step details.
 */
export async function suggestNextMoveForBlockedStep(
  stepId: string,
  familyId: string,
): Promise<SuggestResult> {
  try {
    await requireAppUserWithClient();
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const supabase = await createSupabaseServerClient();
  const detail = await getFamilyDetail(supabase, familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }

  const plan = detail.plan;
  const step = plan?.steps.find((s) => s.id === stepId);
  if (!step) {
    return { ok: false, error: "Step not found" };
  }

  const details = step.details as {
    fallback_options?: string[];
    blockers?: string[];
    contacts?: Array<{ name?: string; phone?: string; email?: string }>;
    rationale?: string;
    detailed_instructions?: string;
  } | null;

  const fallbacks = details?.fallback_options ?? [];
  const blockerReason = (step.workflow_data as { blocker_reason?: string })?.blocker_reason;

  const env = getEnv();
  const apiKey = env.OPENAI_API_KEY;
  const model = env.OPENAI_PLAN_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    return {
      ok: true,
      suggestions: fallbacks.length > 0
        ? fallbacks
        : [
            "Try a different contact method (email if phone failed, or vice versa)",
            "Schedule an in-person visit if remote outreach isn't working",
            "Break this step into smaller tasks the family can complete",
            "Escalate to supervisor or alternate provider",
            "Check if an alternative organization can help",
          ],
    };
  }

  const context = [
    `Family: ${detail.name}`,
    detail.summary ? `Summary: ${detail.summary}` : null,
    `Step: ${step.title}`,
    step.description ? `Description: ${step.description}` : null,
    blockerReason ? `Blocked because: ${blockerReason}` : "Step is blocked",
    fallbacks.length ? `Known fallbacks: ${fallbacks.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are an experienced case manager assistant. A plan step is blocked. Provide 3–5 brief, actionable suggestions for what the case manager could try next. Be specific and practical. Output a JSON object with a single key "suggestions" whose value is an array of strings. No markdown, no extra text.`;

  const userPrompt = `Blocked step context:\n${context}\n\nSuggest 3–5 concrete next moves.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 600,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Suggestions unavailable: ${errText.slice(0, 100)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      throw new Error("Empty response");
    }

    const parsed = JSON.parse(raw) as { suggestions?: string[] };
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === "string").slice(0, 5)
      : [];

    return {
      ok: true,
      suggestions: suggestions.length > 0 ? suggestions : fallbacks,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      ok: true,
      suggestions: fallbacks.length > 0
        ? fallbacks
        : [
            "Try a different contact method",
            "Break into smaller tasks",
            "Escalate if needed",
            "Check alternative organizations",
          ],
    };
  }
}
