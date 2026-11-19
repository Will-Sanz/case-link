import type { FamilyDetail } from "@/types/family";

/** Share factual context across AI features; never clip the end of a restriction. */
export function buildCaseFacts(detail: FamilyDetail) {
  const meetings = [...(detail.progressUpdates ?? [])].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
  const notes = [...(detail.caseNotes ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    case_updated_at: detail.updated_at,
    summary: detail.summary,
    household_context: detail.household_notes,
    urgency: detail.urgency,
    barriers: (detail.barriers ?? []).map(barrier => barrier.label.trim()),
    stated_goals: (detail.goals ?? []).map(goal => goal.label.trim()),
    recent_meetings: meetings.slice(0, 5).map(meeting => ({ occurred_on: meeting.occurred_on, recorded_at: meeting.created_at, summary: meeting.summary })),
    recent_notes: notes.slice(0, 5).map(note => ({ recorded_at: note.created_at, text: note.body })),
    history_limits: {
      older_meetings_omitted: Math.max(0, meetings.length - 5),
      older_notes_omitted: Math.max(0, notes.length - 5),
      complete_history: false,
    },
  };
}

export function serializeCaseContext(context: unknown, maxChars = 80_000): string {
  const text = JSON.stringify(context);
  if (text.length > maxChars) throw new Error("This case has too much context for one AI request. Use the plan editor; no instructions were discarded.");
  return text;
}
