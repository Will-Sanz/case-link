/** Step-level AI helper kinds (shared type; prompts live server-side). */
export type StepHelperType =
  | "call_script"
  | "email_draft"
  | "prep_checklist"
  | "fallback_options"
  | "family_explanation"
  | "break_into_actions"
  | "what_happens_next"
  | "troubleshoot_blocker";
