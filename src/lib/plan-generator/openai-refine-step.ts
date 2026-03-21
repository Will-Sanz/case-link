import "server-only";

import { z } from "zod";
import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
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
  action_needed_now: z.string().max(500).optional(),
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

const SYSTEM_PROMPT = `You are an experienced housing and social services case manager assistant. Your job is to REFINE A SINGLE PLAN STEP based on case manager feedback. Make it an EXECUTION-READY step the case manager can act on immediately.

## Rules
- Output ONLY the revised step. Do NOT rewrite the whole plan.
- Keep the step in the same phase (30, 60, or 90) unless the feedback explicitly asks to change it.
- Make the step MORE SPECIFIC, ACTIONABLE, and EXECUTION-FRIENDLY. Avoid vague advice.
- Add action_needed_now: one short sentence stating the exact next action (e.g. "Call PECO customer assistance and ask about CAP enrollment").
- The checklist MUST contain concrete, checkable sub-actions (e.g. "Call between 9 AM and 4 PM", "Write down intake requirements").
- Incorporate the case manager's feedback exactly where reasonable.
- Do NOT repeat actions already covered in other steps unless it's a true follow-up.
- Use contact_script when outreach is involved (exact phrasing for phone calls).
- Include required_documents when documents are needed.
- Include fallback_options when the first approach might fail.
- If the step is blocked, consider workarounds, smaller first steps, or alternate resources.
- When linked resources exist, use their names and contact details practically.

## Output format
Output ONLY valid JSON. No markdown. Shape:
{
  "phase": "30" | "60" | "90",
  "title": "Clear step title",
  "description": "2-3 sentence summary",
  "action_needed_now": "One concrete sentence: what to do next",
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

/**
 * Refines a single plan step. Uses gpt-5.4 via Responses API.
 */
export async function refineStepWithOpenAI(
  detail: FamilyDetail,
  currentStep: {
    phase: string;
    title: string;
    description: string;
    details?: unknown;
    workflow_data?: { blocker_reason?: string | null };
  },
  feedback: string,
  options?: { surroundingStepTitles?: string[] },
): Promise<RefineStepResult> {
  const blockerReason = currentStep.workflow_data?.blocker_reason;
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
      ...(blockerReason && { blocker_reason: blockerReason }),
    },
    null,
    2,
  );

  const surroundingBlock =
    (options?.surroundingStepTitles?.length ?? 0) > 0
      ? `\n## Surrounding steps (for context, do not repeat)\n${options!.surroundingStepTitles!.join("\n")}`
      : "";

  const userPrompt = `## Case context
${context}

## Current step (to refine)
${currentContent}${surroundingBlock}

## Case manager feedback
${feedback}

Refine ONLY this step. Output the revised step as JSON.${blockerReason ? ` The step is BLOCKED because: ${blockerReason}. Consider workarounds, smaller first steps, or alternate approaches.` : ""}`;

  try {
    const result = await createAiResponse({
      taskType: "step_refinement",
      instructions: SYSTEM_PROMPT + "\n\nOutput ONLY valid JSON. No markdown.",
      input: userPrompt,
      responseFormat: "json_object",
      temperature: 0.4,
      maxTokens: 2048,
    });

    if (!result.ok) {
      return { ok: false, reason: result.error };
    }

    const parsed = JSON.parse(result.text) as unknown;
    const validated = aiStepSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, reason: "OpenAI JSON did not match expected shape" };
    }

    const s = validated.data;
    const hasDetails =
      s.action_needed_now ||
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
          action_needed_now: s.action_needed_now,
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
