import "server-only";

import { z } from "zod";
import type { FamilyDetail } from "@/types/family";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";
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

function shouldLogOpenAi(): boolean {
  return process.env.OPENAI_DEBUG === "1";
}

const AI_PROMPT_MATCH_LIMIT = 15;

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

  const familyBlock = lines.join("\n\n");
  const resourcesBlock = formatMatchesForAiPrompt(
    detail.resourceMatches,
    AI_PROMPT_MATCH_LIMIT,
  );

  return `${familyBlock}\n\n---\n\n${resourcesBlock}`;
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
Given a family's situation and (when present) a ranked list of REAL community programs from their resource directory, produce a practical 30-60-90 day case plan.

Rules:
- Output ONLY valid JSON, no markdown. Shape: {"steps":[{"phase":"30"|"60"|"90","title":"...","description":"..."},...]}
- phase "30" = first month priorities, "60" = next 30 days, "90" = following 30 days.
- 3–12 steps total, spread across phases. Each title is concise; description is operational (who to call, what to send, what to document).

RESOURCE GROUNDING (critical):
- When MATCHED_COMMUNITY_RESOURCES is provided, treat it as the PRIMARY basis for concrete actions. Most steps should name a specific program from that list and explain the next outreach step (call, email, intake, referral packet, follow-up date).
- Use exact program names, office/department, and contact details from the list when you include them in descriptions.
- Prefer "Contact [Program X] at [phone/email] to begin [intake/referral] for …" over generic advice like "seek legal help" or "explore workforce options".
- If several resources fit one goal, assign clear priorities across phases (e.g. immediate stabilization in 30-day, follow-on in 60/90).
- Do NOT invent organizations not in the matched list. If the list is empty or insufficient for a goal, use generic program-type language only for that gap.

General:
- Align with stated goals and barriers; steps should be doable by a case manager this week.`;

  const user = `Create a case plan for this family. Ground steps in matched resources whenever they are listed below.\n\n${context}`;

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
        temperature: 0.35,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (shouldLogOpenAi()) {
        console.info("[openai-plan] HTTP", res.status, errText.slice(0, 300));
      }
      return {
        ok: false,
        reason: `OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const raw = data.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      if (shouldLogOpenAi()) {
        console.info("[openai-plan] empty response:", data);
      }
      return { ok: false, reason: "Empty OpenAI response" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (shouldLogOpenAi()) {
        console.info("[openai-plan] ← JSON.parse failed on assistant content");
      }
      return { ok: false, reason: "OpenAI returned invalid JSON" };
    }

    const validated = aiResponseSchema.safeParse(parsed);
    if (!validated.success) {
      if (shouldLogOpenAi()) {
        console.info(
          "[openai-plan] validation failed:",
          validated.error.message,
          JSON.stringify(parsed).slice(0, 500),
        );
      }
      return { ok: false, reason: "OpenAI JSON did not match expected shape" };
    }

    if (shouldLogOpenAi()) {
      const usage = data.usage;
      console.info(
        "[openai-plan]",
        validated.data.steps.length,
        "steps,",
        usage?.total_tokens ?? "?",
        "tokens",
      );
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
