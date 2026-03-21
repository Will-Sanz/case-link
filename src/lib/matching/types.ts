/** Minimal resource row needed for deterministic matching (no UI). */
export type MatchableResource = {
  id: string;
  program_name: string;
  office_or_department: string;
  description: string | null;
  category: string | null;
  search_text: string | null;
  tags: string[];
  recruit_for_grocery_giveaways: boolean | null;
  tabling_at_events: boolean;
  promotional_materials: boolean;
  educational_workshops: boolean;
  volunteer_recruitment_support: boolean;
};

export type FamilyMatchInput = {
  goals: { preset_key: string | null; label: string }[];
  barriers: { preset_key: string | null; label: string }[];
  summary: string | null;
  household_notes: string | null;
};

export type RankedMatch = {
  resourceId: string;
  score: number;
  matchReason: string;
};
