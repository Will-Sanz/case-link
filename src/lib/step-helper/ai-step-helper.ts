import "server-only";

import type { AiMode } from "@/lib/ai/ai-mode";
import { parseAiMode } from "@/lib/ai/ai-mode";
import type { OpenAiRequestMeta } from "@/lib/ai/openai-request-meta";
import type { FamilyDetail, PlanStepRow, ResourceMatchRow } from "@/types/family";
import { GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS } from "@/lib/ai/prompt-geo";
import type { StepHelperType } from "@/types/step-helper";
import { createAiResponse } from "@/lib/ai/client";
import type { AiTaskType } from "@/lib/ai/models";
import { formatMatchesForAiPrompt } from "@/lib/plan-generator/resource-context";

export type { StepHelperType } from "@/types/step-helper";

export type StepHelperResult =
  | { ok: true; content: string; listContent?: string[] }
  | { ok: false; error: string };

/**
 * Organization this step is about, call scripts and emails must be FROM the case manager TO this audience.
 */
function buildOutreachAudienceBlock(detail: FamilyDetail, step: PlanStepRow): string {
  const stepMatches = detail.resourceMatches
    .filter((m) => m.plan_step_id === step.id && m.resource && m.status !== "dismissed")
    .sort((a, b) => {
      const pri = (x: ResourceMatchRow) =>
        x.status === "accepted" ? 0 : x.status === "suggested" ? 1 : 2;
      const p = pri(a) - pri(b);
      if (p !== 0) return p;
      return b.score - a.score;
    });

  const primary = stepMatches[0]?.resource;
  if (primary) {
    const lines = [
      "OUTREACH_AUDIENCE (required framing, write/speak as the CASE MANAGER, addressing THIS organization):",
      `- Organization / program: ${primary.program_name}`,
      `- Office or department: ${primary.office_or_department}`,
      primary.primary_contact_name
        ? `- Staff contact (if known): ${primary.primary_contact_name}`
        : null,
      primary.primary_contact_email
        ? `- Their email (recipient): ${primary.primary_contact_email}`
        : null,
      primary.primary_contact_phone
        ? `- Their phone: ${primary.primary_contact_phone}`
        : null,
      "",
      "The case manager is the caller/sender. The household is the client you are advocating for, do not write or speak as the family member. Greet and address the program or named staff at this organization.",
    ];
    return lines.filter((l) => l !== null).join("\n");
  }

  const outreachTitle = /^outreach:\s*(.+)$/i.exec(step.title.trim());
  const inferredOrg = outreachTitle?.[1]?.trim() || step.title;
  const d = step.details as { contacts?: Array<{ name?: string; email?: string; phone?: string }> } | null;
  const c0 = d?.contacts?.[0];
  const contactHint = c0
    ? [
        c0.name ? `- Possible contact: ${c0.name}` : null,
        c0.email ? `- Possible email: ${c0.email}` : null,
        c0.phone ? `- Possible phone: ${c0.phone}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return [
    "OUTREACH_AUDIENCE (required framing, write/speak as the CASE MANAGER to the organization this step references):",
    `- Step / program focus: ${inferredOrg}`,
    contactHint ? `${contactHint}\n` : "",
    "No resource row is linked to this step. Still produce content from the case manager to the organization implied above (use MATCHED_COMMUNITY_RESOURCES below if a name matches). Never write as if the family is emailing the case manager.",
  ]
    .filter(Boolean)
    .join("\n");
}

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
    system: `You are an experienced case manager assistant in Philadelphia.

${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS}

Generate a realistic, usable PHONE SCRIPT for the CASE MANAGER to read or follow while on the phone.

VOICE: The speaker is the case manager (use first person as the CM: e.g. "I'm calling from…", "I'm working with a household…"). You are NOT the family member and NOT a generic narrator.

AUDIENCE: The person answering at the ORGANIZATION / PROGRAM named in OUTREACH_AUDIENCE (or implied by the step). Address them directly ("I'd like to speak with…", "I'm calling about a referral…"). Name the program or department when known.

CONTENT: Tailor to the family's situation and this step. Include: (1) brief intro as CM + agency if applicable, (2) reason for call on behalf of the household, (3) key questions for the organization's staff, (4) info the CM should have ready (use placeholders like [CASE ID] only where needed), (5) how to close and what to document.

Output plain text only, no markdown.`,
    userPrefix: "Generate a call script for this step:\n\n",
  },
  email_draft: {
    system: `You are an experienced case manager assistant.

${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS}

Generate a complete, USABLE EMAIL that the CASE MANAGER will send TO the organization or program in OUTREACH_AUDIENCE (To: their email if provided; otherwise use a clear placeholder like [PROGRAM INTAKE EMAIL]).

VOICE: Written in first person as the case manager ("I am writing on behalf of…", "I'm reaching out from…"). The signer is the case manager, NOT the family writing to the case manager.

AUDIENCE: Salutation and body must address the PROGRAM / ORGANIZATION or named staff (e.g. "Dear [Program name] Intake Team" or "Dear Ms. [Contact]"). The email is outbound from the CM to that organization.

CONTENT: Brief context, reason for outreach, specific ask (intake, referral, status, documents, appointment), what you'll follow up with. Use placeholders like [CASE MANAGER NAME], [AGENCY], [CM PHONE], [CM EMAIL], [FAMILY NAME OR INITIALS], [HOUSEHOLD SIZE] where the CM would fill in, not as the family signing.

Close with a professional sign-off from the case manager.

Output plain text only, no markdown.`,
    userPrefix: "Draft an outreach email for this step:\n\n",
  },
  prep_checklist: {
    system: `You are an experienced case manager assistant. Generate a "before you do this" prep checklist. Include: documents to gather, info to confirm with the family, account numbers or IDs to have ready, questions to ask before calling/visiting. If language/translation might be relevant, mention it. Output a JSON object with a single key "items" whose value is an array of strings. Each string is one checklist item. No markdown.`,
    userPrefix: "Generate a prep checklist for this step:\n\n",
  },
  fallback_options: {
    system: `You are an experienced case manager assistant. The first attempt may fail. Generate 4 to 6 PRACTICAL fallback options such as: call a different number, send an email, visit in person, try an alternate organization, ask supervisor for escalation, request missing documents from family first, break the step into smaller actions. Use linked resources when relevant. Output a JSON object with a single key "options" whose value is an array of strings. No markdown.`,
    userPrefix: "Generate fallback options if the first attempt fails:\n\n",
  },
  family_explanation: {
    system: `You are an experienced case manager assistant. Generate an explanation the case manager can use when talking to the family. Include: why this step matters, what the family needs to do, what to expect next, what documents to bring. Use plain language, avoid jargon. Output plain text only, no markdown.`,
    userPrefix: "Generate a family-friendly explanation for this step:\n\n",
  },
  break_into_actions: {
    system: `You are an experienced case manager assistant. Break this broad step into 4 to 8 smaller, same-day or near-term IMMEDIATE actions. Examples: check eligibility page, call main line, write down rep name, upload proof of income, set follow-up reminder. Each must be concrete and completable. Output a JSON object with a single key "actions" whose value is an array of strings. No markdown.`,
    userPrefix: "Break this step into smaller immediate actions:\n\n",
  },
  what_happens_next: {
    system: `You are an experienced case manager assistant. Generate a "after this step" guide. Include: what success looks like, what to do if approved, what to do if denied, what follow-up step should happen next. Be specific. Output plain text only, no markdown.`,
    userPrefix: "Generate a 'what happens next' guide for this step:\n\n",
  },
  troubleshoot_blocker: {
    system: `You are an experienced case manager assistant. This step is BLOCKED. Generate 4 to 6 practical suggestions: workarounds, alternative outreach, smaller first step, another linked resource, escalation path, what information is missing. If the blocker reason is known, address it directly (e.g. "no transportation" → suggest phone/remote options, transit assistance). Output a JSON object with a single key "suggestions" whose value is an array of strings. No markdown.`,
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
  options?: { aiMode?: AiMode; requestMeta?: OpenAiRequestMeta },
): Promise<StepHelperResult> {
  const mode = parseAiMode(options?.aiMode);
  const audiencePrefix =
    helperType === "call_script" || helperType === "email_draft"
      ? `${buildOutreachAudienceBlock(detail, step)}\n\n---\n\n`
      : "";
  const context = `${audiencePrefix}${buildStepContext(detail, step)}`;
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
    maxTokens: mode === "fast" ? 1200 : 2200,
    aiMode: mode,
    requestMeta: options?.requestMeta,
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
