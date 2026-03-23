import "server-only";

import type { StepHelperType } from "@/types/step-helper";
import type { PlanStepAiHelperData } from "@/types/family";

/** Maps a step-helper menu id to the `ai_helper_data` field used for persistence. */
export function stepHelperTypeToPersistField(
  helperType: StepHelperType,
): keyof PlanStepAiHelperData {
  switch (helperType) {
    case "call_script":
      return "call_script";
    case "email_draft":
      return "email_draft";
    case "prep_checklist":
    case "break_into_actions":
      return "prep_checklist";
    case "fallback_options":
    case "troubleshoot_blocker":
      return "fallback_options";
    case "family_explanation":
      return "family_explanation";
    case "what_happens_next":
      return "next_step_guidance";
    default:
      return "fallback_options";
  }
}
