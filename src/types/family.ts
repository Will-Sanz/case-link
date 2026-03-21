export type FamilyListItem = {
  id: string;
  name: string;
  summary: string | null;
  urgency: "low" | "medium" | "high" | "crisis" | null;
  status: "active" | "on_hold" | "closed";
  created_at: string;
  updated_at: string;
  created_by_id: string;
  creator: { email: string } | null;
};

export type FamilyGoalRow = {
  id: string;
  family_id: string;
  preset_key: string | null;
  label: string;
  sort_order: number;
  created_at: string;
};

export type FamilyBarrierRow = {
  id: string;
  family_id: string;
  preset_key: string | null;
  label: string;
  sort_order: number;
  created_at: string;
};

export type FamilyMemberRow = {
  id: string;
  family_id: string;
  display_name: string;
  relationship: string | null;
  notes: string | null;
  age_approx: number | null;
  created_at: string;
};

export type CaseNoteRow = {
  id: string;
  family_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: { email: string } | null;
};

export type MatchedResourceSummary = {
  id: string;
  slug: string;
  program_name: string;
  office_or_department: string;
  category: string | null;
  primary_contact_name: string | null;
  primary_contact_title: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  secondary_contact_name: string | null;
  secondary_contact_email: string | null;
  secondary_contact_phone: string | null;
  recruit_for_grocery_giveaways: boolean | null;
  tabling_at_events: boolean;
  promotional_materials: boolean;
  educational_workshops: boolean;
  volunteer_recruitment_support: boolean;
};

export type ResourceMatchRow = {
  id: string;
  family_id: string;
  resource_id: string;
  match_reason: string;
  score: number;
  status: "suggested" | "accepted" | "dismissed";
  created_at: string;
  updated_at: string;
  resource: MatchedResourceSummary | null;
};

export type PlanStepRow = {
  id: string;
  plan_id: string;
  phase: "30" | "60" | "90";
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  due_date: string | null;
  assigned_to_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PlanRow = {
  id: string;
  family_id: string;
  version: number;
  summary: string | null;
  generation_source: string;
  ai_model: string | null;
  created_at: string;
};

export type PlanWithSteps = PlanRow & {
  steps: PlanStepRow[];
};

export type FamilyDetail = {
  id: string;
  name: string;
  summary: string | null;
  urgency: "low" | "medium" | "high" | "crisis" | null;
  household_notes: string | null;
  status: "active" | "on_hold" | "closed";
  created_by_id: string;
  created_at: string;
  updated_at: string;
  creator: { email: string } | null;
  goals: FamilyGoalRow[];
  barriers: FamilyBarrierRow[];
  members: FamilyMemberRow[];
  caseNotes: CaseNoteRow[];
  resourceMatches: ResourceMatchRow[];
  plan: PlanWithSteps | null;
};
