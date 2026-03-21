/** Calendar event types derived from case workflow data */
export type CalendarEventType =
  | "follow_up_due"
  | "step_due"
  | "overdue"
  | "blocked_review"
  | "escalation_review"
  | "stale_case_check"
  | "new_plan_review"
  | "stage_milestone";

/** Internal calendar event structure for display */
export type CalendarEvent = {
  id: string;
  family_id: string;
  family_name: string;
  step_id: string | null;
  step_title: string | null;
  /** Action item id when event comes from a smaller scheduled task */
  action_item_id?: string | null;
  stage: "30" | "60" | "90" | null;
  event_type: CalendarEventType;
  date: string; // ISO date YYYY-MM-DD
  /** For multi-day or timed display if needed */
  end_date?: string | null;
  status: string;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  urgency: "low" | "medium" | "high" | "crisis" | null;
  blocked_flag: boolean;
  escalated_flag: boolean;
  /** True when underlying action item is completed */
  completed_flag?: boolean;
  action_needed_now: string;
  source_type: "follow_up" | "due_date" | "blocked" | "escalation" | "stale" | "new_plan" | "stage";
  days_overdue?: number;
  days_since_activity?: number;
};

export type CalendarFilters = {
  eventTypes?: CalendarEventType[];
  familyIds?: string[];
  stages?: ("30" | "60" | "90")[];
  overdueOnly?: boolean;
  blockedOnly?: boolean;
  escalatedOnly?: boolean;
};
