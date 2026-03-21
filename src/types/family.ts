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

export type ActivityLogRow = {
  id: string;
  family_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: unknown;
  created_at: string;
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
  activity: ActivityLogRow[];
};
