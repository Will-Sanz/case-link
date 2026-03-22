export type PlanPhase = "30" | "60" | "90";

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export type StepTemplate = {
  phase: PlanPhase;
  title: string;
  description: string;
};

export type PlanGeneratorInput = {
  goals: { preset_key: string | null; label: string }[];
  barriers: { preset_key: string | null; label: string }[];
};

/** Smaller scheduled action item for a step (weekly cadence, calendar-facing) */
export type GeneratedActionItem = {
  title: string;
  /** Optional "how to do it" / prep guidance */
  description?: string;
  week_index: number;
  /** Optional ISO date; if omitted, derived from plan start + week_index */
  target_date?: string;
};

/** Rich content for generated plan steps */
export type GeneratedStepDetails = {
  /** Short, concrete next action (e.g. "Call PECO and ask about CAP enrollment") */
  action_needed_now: string;
  rationale: string;
  detailed_instructions: string;
  checklist: string[];
  required_documents: string[];
  contact_script?: string;
  materials_needed?: string[];
  contacts: Array<{
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
  }>;
  blockers: string[];
  fallback_options: string[];
  expected_outcome: string;
  timing_guidance: string;
  priority: "low" | "medium" | "high";
  stage_goal: string;
  why_now: string;
  depends_on?: string;
  milestone_type?: string;
  success_marker: string;
};

export type GeneratedStep = {
  phase: PlanPhase;
  title: string;
  description: string;
  sort_order: number;
  details: GeneratedStepDetails;
  /** Smaller weekly action items; if absent, derived from checklist for rules fallback */
  action_items?: GeneratedActionItem[];
};
