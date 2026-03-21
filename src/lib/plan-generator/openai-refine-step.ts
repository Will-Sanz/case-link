import "server-only";

import { z } from "zod";
import type { FamilyDetail } from "@/types/family";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";
import type { GeneratedStepDetails } from "./types";

const contactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
});

const aiStepSchema = z.object({
  phase: z.enum(["30", "60", "90"]),
  title: z.string().min(1).max(500),
  description: z.string().max(4000),
  rationale: z.string().optional(),
  detailed_instructions: z.string().optional(),
  checklist: z.array(z.string()).optional(),
  required_documents: z.array(z.string()).optional(),
  contact_script: z.string().optional(),
  contacts: z.array(contactSchema).optional(),
  blockers: z.array(z.string()).optional(),
  fallback_options: z.array(z.string()).optional(),
  expected_outcome: z.string().optional(),
  timing_guidance: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  stage_goal: z.string().optional(),
  why_now: z.string().optional(),
  depends_on: z.string().optional(),
  milestone_type: z.string().optional(),
  success_marker: z.string().optional(),
});

export type RefineStepResult =
  | { ok: true; step: { title: string; description: string; details?: GeneratedStepDetails } }
  | { ok: false; reason: string };

const SYSTEM_PROMPT = `You are an experienced housing and social services case manager assistant. Your job is to REFINE A SINGLE PLAN STEP based on case manager feedback.

## Rules
- Output ONLY the revised step. Do NOT rewrite the whole plan.
- Keep the step in the same phase (30, 60, or 90) unless the feedback explicitly asks to change it.
- Make the step MORE SPECIFIC and ACTIONABLE. Avoid vague advice.
- The checklist MUST contain concrete, checkable sub-actions (e.g. "Call between 9 AM and 4 PM", "Write down intake requirements").
- Incorporate the case manager's feedback exactly where reasonable.
- Do NOT repeat actions already covered in other steps unless it's a true follow-up.
- Use contact_script when outreach is involved (what to say on the phone).
- Include required_documents when documents are needed.
- Include fallback_options when the first approach might fail.

## Output format
Output ONLY valid JSON. No markdown. Shape:
{
  "phase": "30" | "60" | "90",
  "title": "Clear step title",
  "description": "2-3 sentence summary",
  "rationale": "Why this matters",
  "detailed_instructions": "Step-by-step guidance. Be specific.",
  "checklist": ["Specific sub-action 1", "Specific sub-action 2", ...],
  "required_documents": ["Doc 1", "Doc 2"],
  "contact_script": "What to say when calling: ...",
  "contacts": [{"name": "...", "phone": "...", "email": "...", "notes": "..."}],
  "fallback_options": ["If X fails, try Y"],
  "expected_outcome": "What success looks like",
  "success_marker": "Clear indicator this step is done"
}`;

export async function refineStepWithOpenAI(
  detail: FamilyDetail,
  currentStep: {
    phase: string;
    title: string;
    description: string;
    details?: unknown;
  },
  feedback: string,
  apiKey: string,
  model: string,
): Promise<RefineStepResult> {
  const context = [
    `Household: ${detail.name}`,
    detail.summary ? `Summary: ${detail.summary}` : null,
    detail.household_notes ? `Circumstances: ${detail.household_notes}` : null,
    detail.goals.length
      ? `Goals: ${detail.goals.map((g) => g.label).join("; ")}`
      : null,
    detail.barriers.length
      ? `Barriers: ${detail.barriers.map((b) => b.label).join("; ")}`
      : null,
    formatMatchesForAiPrompt(
      detail.resourceMatches.filter((m) => m.status === "accepted"),
      10,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const currentContent = JSON.stringify(
    {
      phase: currentStep.phase,
      title: currentStep.title,
      description: currentStep.description,
      details: currentStep.details,
    },
    null,
    2,
  );

  const userPrompt = `## Case context
${context}

## Current step (to refine)
${currentContent}

## Case manager feedback
${feedback}

Refine ONLY this step. Output the revised step as JSON.`;

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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `OpenAI HTTP ${res.status}: ${errText.slice(0, 150)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      return { ok: false, reason: "Empty OpenAI response" };
    }

    const parsed = JSON.parse(raw) as unknown;
    const validated = aiStepSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, reason: "OpenAI JSON did not match expected shape" };
    }

    const s = validated.data;
    const hasDetails =
      s.rationale ||
      s.detailed_instructions ||
      (s.checklist && s.checklist.length > 0) ||
      (s.required_documents && s.required_documents.length > 0) ||
      (s.contacts && s.contacts.length > 0) ||
      (s.fallback_options && s.fallback_options.length > 0) ||
      s.expected_outcome ||
      s.timing_guidance ||
      s.priority ||
      s.stage_goal ||
      s.why_now ||
      s.contact_script;

    const details: GeneratedStepDetails | undefined = hasDetails
      ? {
          rationale: s.rationale,
          detailed_instructions: s.detailed_instructions,
          checklist: s.checklist,
          required_documents: s.required_documents,
          contact_script: s.contact_script,
          contacts: s.contacts,
          fallback_options: s.fallback_options,
          expected_outcome: s.expected_outcome,
          timing_guidance: s.timing_guidance,
          priority: s.priority,
          stage_goal: s.stage_goal,
          why_now: s.why_now,
          depends_on: s.depends_on,
          milestone_type: s.milestone_type,
          success_marker: s.success_marker,
        }
      : undefined;

    return {
      ok: true,
      step: {
        title: s.title.trim(),
        description: s.description.trim(),
        details,
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "OpenAI request failed",
    };
  }
}
