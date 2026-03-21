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

/** Rich content for generated plan steps */
export type GeneratedStepDetails = {
  rationale?: string;
  detailed_instructions?: string;
  checklist?: string[];
  required_documents?: string[];
  contacts?: Array<{
    name?: string;
    phone?: string;
    email?: string;
    notes?: string;
  }>;
  blockers?: string[];
  fallback_options?: string[];
  expected_outcome?: string;
  timing_guidance?: string;
  priority?: "low" | "medium" | "high";
  stage_goal?: string;
  why_now?: string;
  depends_on?: string;
  milestone_type?: string;
  success_marker?: string;
};

export type GeneratedStep = {
  phase: PlanPhase;
  title: string;
  description: string;
  sort_order: number;
  details?: GeneratedStepDetails;
};
