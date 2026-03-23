import "server-only";

import type { FamilyDetail } from "@/types/family";
import type { PlanStepRow } from "@/types/family";
import type { StepHelperType } from "@/types/step-helper";
import { createAiResponse } from "@/lib/ai/client";
import type { AiTaskType } from "@/lib/ai/models";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";

export type { StepHelperType } from "@/types/step-helper";

export type StepHelperResult =
  | { ok: true; content: string; listContent?: string[] }
  | { ok: false; error: string };

function buildStepContext(detail: FamilyDetail, step: PlanStepRow): string {
  const d = step.details as {
    rationale?: string;
    detailed_instructions?: string;
    contact_script?: string;
    required_documents?: string[];
    contacts?: Array<{ name?: string; phone?: string; email?: string }>;
    fallback_options?: string[];
    blockers?: string[];
    expected_outcome?: string;
    action_needed_now?: string;
  } | null;

  const linkedMatches = detail.resourceMatches.filter(
    (m) => m.plan_step_id === step.id && m.status === "accepted" && m.resource,
  );
  const resourceBlock =
    linkedMatches.length > 0
      ? formatMatchesForAiPrompt(
          detail.resourceMatches.filter((m) => m.plan_step_id === step.id),
          5,
        )
      : formatMatchesForAiPrompt(detail.resourceMatches, 5);

  const lines = [
    `Family: ${detail.name}`,
    detail.summary ? `Summary: ${detail.summary}` : null,
    detail.urgency ? `Urgency: ${detail.urgency}` : null,
    detail.household_notes ? `Circumstances: ${detail.household_notes}` : null,
    detail.goals.length ? `Goals: ${detail.goals.map((g) => g.label).join("; ")}` : null,
    detail.barriers.length ? `Barriers: ${detail.barriers.map((b) => b.label).join("; ")}` : null,
    `---`,
    `Step (${step.phase}-day phase): ${step.title}`,
    step.description ? `Description: ${step.description}` : null,
    d?.action_needed_now ? `Action needed now: ${d.action_needed_now}` : null,
    d?.rationale ? `Why: ${d.rationale}` : null,
    d?.detailed_instructions ? `Instructions: ${d.detailed_instructions}` : null,
    d?.contact_script ? `Existing script: ${d.contact_script}` : null,
    d?.required_documents?.length
      ? `Documents: ${d.required_documents.join(", ")}`
      : null,
    d?.contacts?.length
      ? `Contacts: ${d.contacts.map((c) => c.name || c.phone || c.email).filter(Boolean).join("; ")}`
      : null,
    d?.fallback_options?.length
      ? `Known fallbacks: ${d.fallback_options.join("; ")}`
      : null,
    d?.blockers?.length ? `Common blockers: ${d.blockers.join("; ")}` : null,
    `---`,
    resourceBlock,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}

const HELPER_PROMPTS: Record<
  StepHelperType,
  { system: string; userPrefix: string }
> = {
  call_script: {
    system: `You are an experienced case manager assistant in Philadelphia. Generate a realistic, usable PHONE SCRIPT for the case manager to use when calling. The script must be tailored to the family's situation, the specific step, and any linked organization. Include: (1) how to introduce the situation, (2) key questions to ask, (3) what info to have ready, (4) how to close the call, (5) what to write down. Be specific and practical. Use the organization name if linked. Output plain text only, no markdown.`,
    userPrefix: "Generate a call script for this step:\n\n",
  },
  email_draft: {
    system: `You are an experienced case manager assistant. Generate a USABLE outreach EMAIL for this step. Include: context, reason for outreach, clear request for next action, polite close. Use placeholders like [FAMILY NAME] or [ACCOUNT NUMBER] where the case manager would fill in. If a contact/organization is linked, address it appropriately. Output plain text only, no markdown.`,
    userPrefix: "Draft an outreach email for this step:\n\n",
  },
  prep_checklist: {
    system: `You are an experienced case manager assistant. Generate a "before you do this" prep checklist. Include: documents to gather, info to confirm with the family, account numbers or IDs to have ready, questions to ask before calling/visiting. If language/translation might be relevant, mention it. Output a JSON object with a single key "items" whose value is an array of strings. Each string is one checklist item. No markdown.`,
    userPrefix: "Generate a prep checklist for this step:\n\n",
  },
  fallback_options: {
    system: `You are an experienced case manager assistant. The first attempt may fail. Generate 4–6 PRACTICAL fallback options such as: call a different number, send an email, visit in person, try an alternate organization, ask supervisor for escalation, request missing documents from family first, break the step into smaller actions. Use linked resources when relevant. Output a JSON object with a single key "options" whose value is an array of strings. No markdown.`,
    userPrefix: "Generate fallback options if the first attempt fails:\n\n",
  },
  family_explanation: {
    system: `You are an experienced case manager assistant. Generate an explanation the case manager can use when talking to the family. Include: why this step matters, what the family needs to do, what to expect next, what documents to bring. Use plain language, avoid jargon. Output plain text only, no markdown.`,
    userPrefix: "Generate a family-friendly explanation for this step:\n\n",
  },
  break_into_actions: {
    system: `You are an experienced case manager assistant. Break this broad step into 4–8 smaller, same-day or near-term IMMEDIATE actions. Examples: check eligibility page, call main line, write down rep name, upload proof of income, set follow-up reminder. Each must be concrete and completable. Output a JSON object with a single key "actions" whose value is an array of strings. No markdown.`,
    userPrefix: "Break this step into smaller immediate actions:\n\n",
  },
  what_happens_next: {
    system: `You are an experienced case manager assistant. Generate a "after this step" guide. Include: what success looks like, what to do if approved, what to do if denied, what follow-up step should happen next. Be specific. Output plain text only, no markdown.`,
    userPrefix: "Generate a 'what happens next' guide for this step:\n\n",
  },
  troubleshoot_blocker: {
    system: `You are an experienced case manager assistant. This step is BLOCKED. Generate 4–6 practical suggestions: workarounds, alternative outreach, smaller first step, another linked resource, escalation path, what information is missing. If the blocker reason is known, address it directly (e.g. "no transportation" → suggest phone/remote options, transit assistance). Output a JSON object with a single key "suggestions" whose value is an array of strings. No markdown.`,
    userPrefix: "This step is blocked. Generate troubleshooting suggestions:\n\n",
  },
};

const HELPER_TO_TASK: Record<StepHelperType, AiTaskType> = {
  call_script: "call_script",
  email_draft: "email_draft",
  prep_checklist: "prep_checklist",
  fallback_options: "fallback_options",
  family_explanation: "family_explanation",
  break_into_actions: "break_into_actions",
  what_happens_next: "what_happens_next",
  troubleshoot_blocker: "troubleshoot_blocker",
};

/**
 * Generate step helper content. Uses gpt-5.4-mini via Chat Completions for low latency.
 */
export async function generateStepHelper(
  detail: FamilyDetail,
  step: PlanStepRow,
  helperType: StepHelperType,
): Promise<StepHelperResult> {
  const context = buildStepContext(detail, step);
  const blockerReason = (step.workflow_data as { blocker_reason?: string })?.blocker_reason;
  const prompts = HELPER_PROMPTS[helperType];
  const userContent =
    helperType === "troubleshoot_blocker" && blockerReason
      ? `${prompts.userPrefix}${context}\n\nBLOCKER REASON: ${blockerReason}\n\nGenerate troubleshooting suggestions.`
      : `${prompts.userPrefix}${context}`;

  const needsJson =
    helperType === "prep_checklist" ||
    helperType === "fallback_options" ||
    helperType === "break_into_actions" ||
    helperType === "troubleshoot_blocker";

  const result = await createAiResponse({
    taskType: HELPER_TO_TASK[helperType],
    instructions: prompts.system,
    input: userContent,
    responseFormat: needsJson ? "json_object" : undefined,
    temperature: 0.4,
    maxTokens: 1500,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const raw = result.text;

  try {

    if (
      helperType === "prep_checklist" ||
      helperType === "fallback_options" ||
      helperType === "break_into_actions" ||
      helperType === "troubleshoot_blocker"
    ) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key =
        helperType === "prep_checklist"
          ? "items"
          : helperType === "fallback_options"
            ? "options"
            : helperType === "break_into_actions"
              ? "actions"
              : "suggestions";
      const arr = parsed[key];
      const list = Array.isArray(arr)
        ? arr.filter((x): x is string => typeof x === "string").slice(0, 12)
        : [];
      return {
        ok: true,
        content: list.join("\n"),
        listContent: list,
      };
    }

    return { ok: true, content: raw.trim() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Request failed",
    };
  }
}
