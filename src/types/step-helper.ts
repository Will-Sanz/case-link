/** Step-level AI helper kinds (shared type; prompts live server-side). */
export const STEP_HELPER_TYPES = [
  "call_script",
  "email_draft",
  "prep_checklist",
  "fallback_options",
  "family_explanation",
  "break_into_actions",
  "what_happens_next",
  "troubleshoot_blocker",
] as const;

export type StepHelperType = (typeof STEP_HELPER_TYPES)[number];
