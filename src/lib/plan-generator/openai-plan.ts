import "server-only";

import { z } from "zod";
import type { FamilyDetail } from "@/types/family";
import type { GeneratedStep, PlanPhase } from "./types";

const aiStepSchema = z.object({
  phase: z.enum(["30", "60", "90"]),
  title: z.string().min(1).max(500),
  description: z.string().max(4000),
});

const aiResponseSchema = z.object({
  steps: z.array(aiStepSchema).min(1).max(40),
});

export type OpenAiPlanResult =
  | { ok: true; steps: GeneratedStep[]; model: string }
  | { ok: false; reason: string };

function buildFamilyContext(detail: FamilyDetail): string {
  const lines: string[] = [
    `Household name: ${detail.name}`,
    detail.urgency ? `Urgency: ${detail.urgency}` : null,
    detail.summary ? `Summary: ${detail.summary}` : null,
    detail.household_notes ? `Circumstances: ${detail.household_notes}` : null,
    detail.goals.length
      ? `Goals:\n${detail.goals.map((g) => `- ${g.label}${g.preset_key ? ` (${g.preset_key})` : ""}`).join("\n")}`
      : null,
    detail.barriers.length
      ? `Barriers:\n${detail.barriers.map((b) => `- ${b.label}${b.preset_key ? ` (${b.preset_key})` : ""}`).join("\n")}`
      : null,
  ].filter(Boolean) as string[];
  return lines.join("\n\n");
}

/**
 * Calls OpenAI to draft 30/60/90-day plan steps. Returns ok:false on any failure (caller uses rules fallback).
 */
export async function tryGeneratePlanStepsWithOpenAI(
  detail: FamilyDetail,
  apiKey: string,
  model: string,
): Promise<OpenAiPlanResult> {
  const context = buildFamilyContext(detail);
  const system = `You are an experienced housing and social services case manager assistant in Philadelphia.
Given a family's situation, produce a practical 30-60-90 day case plan.

Rules:
- Output ONLY valid JSON, no markdown. Shape: {"steps":[{"phase":"30"|"60"|"90","title":"...","description":"..."},...]}
- phase "30" = first month priorities, "60" = next 30 days, "90" = following 30 days.
- 3–12 steps total, spread across phases when appropriate. Each title is concise; description is actionable for a case manager.
- Align steps with the stated goals and barriers; suggest concrete next actions (referrals, documentation, follow-ups).
- Do not invent specific agency names unless they appear in the input; prefer generic program types when unsure.`;

  const user = `Create a case plan for this family:\n\n${context}`;

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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      return { ok: false, reason: "Empty OpenAI response" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "OpenAI returned invalid JSON" };
    }

    const validated = aiResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, reason: "OpenAI JSON did not match expected shape" };
    }

    const phaseOrder: PlanPhase[] = ["30", "60", "90"];
    const steps: GeneratedStep[] = validated.data.steps
      .sort(
        (a, b) =>
          phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) ||
          a.title.localeCompare(b.title),
      )
      .map((s, i) => ({
        phase: s.phase,
        title: s.title.trim(),
        description: s.description.trim(),
        sort_order: i,
      }));

    return { ok: true, steps, model };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "OpenAI request failed",
    };
  }
}
