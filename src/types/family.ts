import type { AiMode } from "@/lib/ai/ai-mode";

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

/** Enriched family list item with current step and action info */
export type FamilyWithCurrentStep = FamilyListItem & {
  current_step?: {
    id: string;
    title: string;
    phase: string;
    status: string;
    due_date: string | null;
    action_needed_now?: string;
    is_blocked?: boolean;
    is_escalated?: boolean;
    days_overdue?: number;
    days_since_activity?: number;
  } | null;
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
  plan_step_id?: string | null;
  resource: MatchedResourceSummary | null;
};

/** Rich structured content for plan steps (checklist, contacts, blockers, etc.) */
export type PlanStepDetails = {
  /** Short, concrete next action (e.g. "Call PECO and ask about CAP enrollment") */
  action_needed_now?: string;
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
  /** Script for outreach calls (what to say) */
  contact_script?: string;
  /** Materials/documents needed (alias for required_documents when both exist) */
  materials_needed?: string[];
};

/** Saved AI helper content on plan steps */
export type PlanStepAiHelperData = {
  call_script?: string | null;
  email_draft?: string | null;
  prep_checklist?: string[] | null;
  fallback_options?: string[] | null;
  family_explanation?: string | null;
  next_step_guidance?: string | null;
  action_needed_now?: string | null;
  last_assisted_at?: string | null;
};

/** Case manager interaction data stored on plan steps */
export type PlanStepWorkflowData = {
  blocker_reason?: string | null;
  outcome_notes?: string | null;
  contact_attempted_at?: string | null;
  outreach_result?: string | null;
  needs_escalation?: boolean;
  documents_received?: boolean;
  family_understood?: boolean;
  case_manager_assisted?: boolean;
  /** Per-checklist-item completion: index maps to details.checklist */
  checklist_completed?: boolean[];
};

/** Smaller scheduled action items under a plan step (weekly cadence, calendar-facing) */
export type PlanStepActionItemRow = {
  id: string;
  plan_step_id: string;
  title: string;
  description: string | null;
  week_index: number;
  target_date: string | null;
  status: "pending" | "in_progress" | "completed" | "blocked";
  sort_order: number;
  outcome: string | null;
  notes: string | null;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanStepRow = {
  id: string;
  plan_id: string;
  phase: "30" | "60" | "90";
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  /** Step urgency (column on plan_steps). */
  priority?: "low" | "medium" | "high" | "urgent" | null;
  due_date: string | null;
  assigned_to_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  details?: PlanStepDetails | null;
  workflow_data?: PlanStepWorkflowData | null;
  /** Saved AI helper content (call script, email draft, etc.) */
  ai_helper_data?: PlanStepAiHelperData | null;
  /** Child action items (smaller weekly tasks). Populated when fetched with action items. */
  action_items?: PlanStepActionItemRow[];
};

/** Saved in `plans.client_display` — user-facing plan title and section intros. */
export type PlanClientDisplay = {
  title?: string;
  phaseSummaries?: Partial<Record<"30" | "60" | "90", string>>;
};

/** Staged lean generation progress (plans.generation_state JSONB). */
export type PlanGenerationState = {
  v: 1;
  status: "running" | "complete" | "failed";
  pending_phase: "60" | "90" | null;
  planning_brief: string;
  phases_complete: { "30": boolean; "60": boolean; "90": boolean };
  models_used: string[];
  stage_timings_ms: Partial<Record<"30" | "60" | "90", number>>;
  /** Locked for this run so 60/90 match the 30-day preset; missing on older rows. */
  ai_mode?: AiMode;
  error?: string;
};

export type PlanRow = {
  id: string;
  family_id: string;
  version: number;
  summary: string | null;
  generation_source: string;
  ai_model: string | null;
  created_at: string;
  /** Optional display overrides edited in the family workspace. */
  client_display?: PlanClientDisplay | null;
  /** In-progress multi-phase generation; null when idle or complete. */
  generation_state?: PlanGenerationState | null;
};

export type PlanWithSteps = PlanRow & {
  steps: PlanStepRow[];
  /** Derived on the server for UI — avoids branching on raw `generation_source` in components. */
  presentation: {
    sourceKind: "ai" | "manual" | "rules";
  };
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
  needsAttention?: import("@/lib/services/workflow").NeedsAttentionItem[];
  caseActivity?: Array<{
    id: string;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
    actor_email?: string;
  }>;
};
