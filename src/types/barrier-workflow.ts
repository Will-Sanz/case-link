export const BARRIER_PRESETS = [
  { key: "housing_instability", label: "Housing" },
  { key: "unemployment", label: "Employment" },
  { key: "food_insecurity", label: "Food access" },
  { key: "no_transportation", label: "Transportation" },
  { key: "childcare_barrier", label: "Childcare" },
  { key: "health_barrier", label: "Mental health" },
  { key: "health_barrier", label: "Physical health" },
  { key: "health_barrier", label: "Substance use" },
  { key: "legal_matter", label: "Legal issues" },
  { key: "immigration_documentation", label: "Benefits / ID documents" },
  { key: "education_workforce_training", label: "Education" },
  { key: "legal_matter", label: "Domestic violence" },
  { key: "utility_debt", label: "Financial hardship" },
  { key: "other", label: "Other" },
] as const;

export type BarrierPresetLabel = (typeof BARRIER_PRESETS)[number]["label"];

export type BarrierWorkflowInput = {
  referenceId: string;
  selectedBarriers: BarrierPresetLabel[];
  additionalDetails?: string;
};

export type BarrierWorkflowActionItem = {
  id: string;
  title: string;
  description?: string | null;
  dueDate: string | null;
  status: "pending" | "in_progress" | "completed" | "blocked";
};

export type BarrierWorkflowStep = {
  id: string;
  title: string;
  description: string;
  checklist: string[];
  actionItems: BarrierWorkflowActionItem[];
};

export type BarrierWorkflowPlanSection = {
  phase: "30" | "60" | "90";
  dueRangeLabel: string;
  summary: string;
  steps: BarrierWorkflowStep[];
};

export type BarrierWorkflowResource = {
  id: string;
  name: string;
  programName: string;
  similarityScore: number;
  description: string | null;
  category: string | null;
  contactName: string | null;
  contactTitle: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  secondaryEmail: string | null;
  secondaryPhone: string | null;
  website: string | null;
  address: string | null;
  whyMatched: string;
};

export type BarrierWorkflowRecentRecord = {
  referenceId: string;
  familyId: string;
  updatedAt: string;
};

export type BarrierWorkflowResult = {
  referenceId: string;
  familyId: string;
  selectedBarriers: string[];
  additionalDetails: string;
  sections: BarrierWorkflowPlanSection[];
  resources: BarrierWorkflowResource[];
  lastSavedAt: string | null;
};
