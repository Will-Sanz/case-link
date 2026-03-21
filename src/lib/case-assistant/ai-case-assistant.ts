import "server-only";

import type { FamilyDetail } from "@/types/family";
import { createAiResponse } from "@/lib/ai/client";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";

function buildCaseContext(detail: FamilyDetail): string {
  const plan = detail.plan;
  const steps = plan?.steps ?? [];
  const currentStep = steps.find(
    (s) =>
      s.status === "pending" ||
      s.status === "in_progress" ||
      s.status === "blocked",
  );
  const acceptedResources = detail.resourceMatches.filter(
    (m) => m.status === "accepted" && m.resource,
  );
  const resourceBlock = formatMatchesForAiPrompt(
    detail.resourceMatches.filter((m) => m.status !== "dismissed"),
    10,
  );

  const lines = [
    `Family: ${detail.name}`,
    detail.summary ? `Summary: ${detail.summary}` : null,
    detail.urgency ? `Urgency: ${detail.urgency}` : null,
    detail.household_notes ? `Circumstances: ${detail.household_notes}` : null,
    detail.goals.length
      ? `Goals: ${detail.goals.map((g) => g.label).join("; ")}`
      : null,
    detail.barriers.length
      ? `Barriers: ${detail.barriers.map((b) => b.label).join("; ")}`
      : null,
    detail.members?.length
      ? `Household: ${detail.members.map((m) => m.display_name).join(", ")}`
      : null,
    "---",
    `Plan: ${plan ? `${steps.length} steps` : "No plan yet"}`,
    currentStep
      ? `Current step (${currentStep.phase}-day): ${currentStep.title} [${currentStep.status}]`
      : null,
    currentStep?.status === "blocked" &&
    (currentStep.workflow_data as { blocker_reason?: string })?.blocker_reason
      ? `Blocked because: ${(currentStep.workflow_data as { blocker_reason: string }).blocker_reason}`
      : null,
    steps.length > 0
      ? `Step titles: ${steps.map((s) => `${s.phase}d: ${s.title}`).join(" | ")}`
      : null,
    "---",
    `Accepted resources: ${acceptedResources.length}`,
    resourceBlock,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}

/**
 * Case-level assistant. Uses gpt-5.4 via Responses API.
 */
export async function askCaseAssistant(
  detail: FamilyDetail,
  question: string,
): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  const context = buildCaseContext(detail);

  const instructions = `You are an experienced case manager assistant in Philadelphia. You help case managers execute 30/60/90 day plans for families facing housing instability and related challenges.

You have full context about:
- The family (summary, urgency, goals, barriers, household)
- The current plan and steps
- Accepted and suggested resources
- Blockers and progress

Answer questions practically and specifically. Give actionable guidance. Use the family's actual data—refer to real step titles, resource names, and circumstances. Avoid generic advice. If the question is about what to do next, prioritize based on urgency and plan structure.`;

  const input = `## Case context
${context}

## Question
${question}

Answer concisely and practically.`;

  const result = await createAiResponse({
    taskType: "case_assistant",
    instructions,
    input,
    temperature: 0.4,
    maxTokens: 800,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, answer: result.text };
}

