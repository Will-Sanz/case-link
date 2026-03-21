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

export type GeneratedStep = {
  phase: PlanPhase;
  title: string;
  description: string;
  sort_order: number;
};
