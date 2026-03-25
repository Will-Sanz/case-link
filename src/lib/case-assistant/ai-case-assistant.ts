import "server-only";

import type { AiMode } from "@/lib/ai/ai-mode";
import { parseAiMode } from "@/lib/ai/ai-mode";
import { GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS } from "@/lib/ai/prompt-geo";
import type { CaseAssistantHistoryItem } from "@/types/case-assistant";
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

const MAX_PRIOR_HISTORY_CHARS = 12_000;

function formatPriorConversation(history: CaseAssistantHistoryItem[]): string {
  if (!history.length) return "";
  const blocks = history.map((m) => {
    const label = m.role === "user" ? "Case manager" : "Assistant";
    return `${label}:\n${m.content.trim()}`;
  });
  let text = blocks.join("\n\n---\n\n");
  if (text.length > MAX_PRIOR_HISTORY_CHARS) {
    text = `…\n\n${text.slice(-MAX_PRIOR_HISTORY_CHARS)}`;
  }
  return `## Prior messages in this session\n\n${text}\n\n`;
}

/**
 * Case-level assistant. Uses gpt-5.4 via Responses API.
 */
export async function askCaseAssistant(
  detail: FamilyDetail,
  question: string,
  options?: { aiMode?: AiMode; conversationHistory?: CaseAssistantHistoryItem[] },
): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  const context = buildCaseContext(detail);
  const mode = parseAiMode(options?.aiMode);
  const prior = formatPriorConversation(options?.conversationHistory ?? []);

  const instructions = `You are an experienced case manager assistant in Philadelphia. You help case managers execute 30/60/90 day plans for families facing housing instability and related challenges.

GEOGRAPHIC CONTEXT: ${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS}

You have full context about:
- The family (summary, urgency, goals, barriers, household)
- The current plan and steps
- Accepted and suggested resources
- Blockers and progress

Answer questions practically and specifically. Give actionable guidance. Use the family's actual data—refer to real step titles, resource names, and circumstances. Avoid generic advice. If the question is about what to do next, prioritize based on urgency and plan structure.`;

  const input = `## Case context
${context}

${prior}## Question
${question.trim()}

Answer concisely and practically. Use the prior messages only for continuity; rely on the case context as the source of truth for the family's current situation.`;

  const result = await createAiResponse({
    taskType: "case_assistant",
    instructions,
    input,
    temperature: 0.4,
    maxTokens: mode === "fast" ? 900 : 1600,
    aiMode: mode,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, answer: result.text };
}

