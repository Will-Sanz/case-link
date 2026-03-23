import "server-only";

import { ACTIVITY_TYPES } from "@/lib/validations/plans";
import type { FamilyWorkspaceUiConfig } from "@/types/family-workspace-ui";
import type { StepHelperType } from "@/types/step-helper";

/** Case-assistant suggested questions (user-facing copy; assembled server-side). */
const CASE_ASSISTANT_QUICK_PROMPTS = [
  "What should I prioritize today for this family?",
  "What is the best next step for this family?",
  "Which accepted resources seem most relevant right now?",
  "How can I explain this plan to the family simply?",
  "What should I do if the family misses a deadline?",
  "What are the biggest risks in this case right now?",
  "What documents should I gather first?",
  "What should I say when I call the main contact for the current step?",
] as const;

const PLAN_STEP_OUTREACH_RESULTS = [
  "",
  "No answer",
  "Left voicemail",
  "Appointment scheduled",
  "Documents requested",
  "Application submitted",
  "Ineligible / closed",
  "Other",
] as const;

function humanizeActivityType(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const STEP_HELPER_MENU: ReadonlyArray<{ type: StepHelperType; label: string }> = [
  { type: "call_script", label: "Call script" },
  { type: "email_draft", label: "Draft email" },
  { type: "prep_checklist", label: "Prep checklist" },
  { type: "fallback_options", label: "Fallback options" },
  { type: "family_explanation", label: "Explain to family" },
  { type: "break_into_actions", label: "Break into actions" },
  { type: "what_happens_next", label: "What happens next" },
  { type: "troubleshoot_blocker", label: "Troubleshoot blocker" },
];

/**
 * All static labels / options for the family workspace client shell.
 * Import only from Server Components or other server-only modules.
 */
export function getFamilyWorkspaceUiConfig(): FamilyWorkspaceUiConfig {
  return {
    caseAssistantQuickPrompts: CASE_ASSISTANT_QUICK_PROMPTS,
    planStep: {
      outreachResults: PLAN_STEP_OUTREACH_RESULTS,
      activityLogTypes: ACTIVITY_TYPES.map((value) => ({
        value,
        label: humanizeActivityType(value),
      })),
      stepHelperMenu: STEP_HELPER_MENU.map(({ type, label }) => ({ type, label })),
    },
  };
}
