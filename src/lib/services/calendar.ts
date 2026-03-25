import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarEventType } from "@/types/calendar";

const STALE_DAYS = 7;

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getCalendarEvents(
  client: SupabaseClient,
  options: {
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    familyId?: string;
    filters?: {
      eventTypes?: CalendarEventType[];
      familyIds?: string[];
      stages?: ("30" | "60" | "90")[];
      overdueOnly?: boolean;
      blockedOnly?: boolean;
      escalatedOnly?: boolean;
    };
  },
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  const start = new Date(options.startDate);
  const end = new Date(options.endDate);
  end.setHours(23, 59, 59, 999);

  let familyQuery = client
    .from("families")
    .select("id, name, urgency, updated_at")
    .eq("status", "active");

  if (options.familyId) {
    familyQuery = familyQuery.eq("id", options.familyId);
  } else if (options.filters?.familyIds?.length) {
    familyQuery = familyQuery.in("id", options.filters.familyIds);
  }

  const { data: families } = await familyQuery;

  if (!families?.length) return events;

  const familyIds = families.map((f) => f.id);
  const familyMap = new Map(families.map((f) => [f.id, f]));

  const { data: plans } = await client
    .from("plans")
    .select("id, family_id, created_at")
    .in("family_id", familyIds)
    .order("version", { ascending: false });

  const latestPlanByFamily = new Map<string, { id: string; created_at: string }>();
  const familyIdByPlanId = new Map<string, string>();
  for (const p of plans ?? []) {
    if (!latestPlanByFamily.has(p.family_id)) {
      latestPlanByFamily.set(p.family_id, { id: p.id, created_at: p.created_at });
    }
    familyIdByPlanId.set(p.id, p.family_id);
  }

  const planIds = [...latestPlanByFamily.values()].map((v) => v.id);

  const { data: steps } = await client
    .from("plan_steps")
    .select("id, plan_id, title, phase, status, workflow_data")
    .in("plan_id", planIds)
    .order("sort_order", { ascending: true });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);
  const staleCutoff = new Date(today);
  staleCutoff.setDate(staleCutoff.getDate() - STALE_DAYS);

  const filters = options.filters ?? {};

  function addEvent(ev: CalendarEvent) {
    if (filters.eventTypes?.length && !filters.eventTypes.includes(ev.event_type))
      return;
    if (filters.familyIds?.length && !filters.familyIds.includes(ev.family_id))
      return;
    if (filters.stages?.length && ev.stage && !filters.stages.includes(ev.stage))
      return;
    if (filters.overdueOnly && ev.event_type !== "overdue") return;
    if (filters.blockedOnly && !ev.blocked_flag) return;
    if (filters.escalatedOnly && !ev.escalated_flag) return;

    const startKey = options.startDate.slice(0, 10);
    const endKey = options.endDate.slice(0, 10);
    if (ev.date >= startKey && ev.date <= endKey) {
      events.push(ev);
    }
  }

  // Action-item-based events (primary) and step fallback (no action items)
  for (const s of steps ?? []) {
    const familyId = familyIdByPlanId.get(s.plan_id);
    if (!familyId) continue;
    const fam = familyMap.get(familyId);
    const familyName = fam?.name ?? "Unknown";
    const urgency = fam?.urgency ?? null;
    const w = (s.workflow_data as { needs_escalation?: boolean; blocker_reason?: string }) ?? {};
    const isBlocked = s.status === "blocked";
    const isEscalated = !!w.needs_escalation;

    if (isBlocked) {
      addEvent({
        id: `blocked-${s.id}`,
        family_id: familyId,
        family_name: familyName,
        step_id: s.id,
        step_title: s.title,
        stage: s.phase as "30" | "60" | "90",
        event_type: "blocked_review",
        date: todayKey,
        status: s.status,
        urgency,
        blocked_flag: true,
        escalated_flag: false,
        action_needed_now: `Review blocker: ${s.title}`,
        source_type: "blocked",
      });
    }

    if (isEscalated) {
      addEvent({
        id: `escalation-${s.id}`,
        family_id: familyId,
        family_name: familyName,
        step_id: s.id,
        step_title: s.title,
        stage: s.phase as "30" | "60" | "90",
        event_type: "escalation_review",
        date: todayKey,
        status: s.status,
        urgency,
        blocked_flag: false,
        escalated_flag: true,
        action_needed_now: `Escalation: ${s.title}`,
        source_type: "escalation",
      });
    }
  }

  // Stale cases (no activity)
  for (const f of families) {
    const famUpdated = new Date(f.updated_at);
    if (famUpdated < staleCutoff) {
      const daysSince = Math.floor(
        (today.getTime() - famUpdated.getTime()) / (1000 * 60 * 60 * 24),
      );
      addEvent({
        id: `stale-${f.id}`,
        family_id: f.id,
        family_name: f.name,
        step_id: null,
        step_title: null,
        stage: null,
        event_type: "stale_case_check",
        date: todayKey,
        status: "active",
        urgency: f.urgency ?? null,
        blocked_flag: false,
        escalated_flag: false,
        action_needed_now: `Check in: no activity in ${daysSince} days`,
        source_type: "stale",
        days_since_activity: daysSince,
      });
    }
  }

  // New plan review
  for (const f of families) {
    const plan = latestPlanByFamily.get(f.id);
    if (!plan) continue;
    const planCreated = new Date(plan.created_at);
    const daysSince = Math.floor(
      (today.getTime() - planCreated.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSince <= 1) {
      const planKey = toDateKey(planCreated);
      addEvent({
        id: `newplan-${f.id}`,
        family_id: f.id,
        family_name: f.name,
        step_id: null,
        step_title: null,
        stage: null,
        event_type: "new_plan_review",
        date: planKey,
        status: "active",
        urgency: f.urgency ?? null,
        blocked_flag: false,
        escalated_flag: false,
        action_needed_now: "Review new plan",
        source_type: "new_plan",
      });
    }
  }

  events.sort((a, b) => {
    const da = a.date.localeCompare(b.date);
    if (da !== 0) return da;
    const typeOrder: CalendarEventType[] = [
      "overdue",
      "escalation_review",
      "blocked_review",
      "follow_up_due",
      "step_due",
      "stale_case_check",
      "new_plan_review",
      "stage_milestone",
    ];
    return (
      typeOrder.indexOf(a.event_type) - typeOrder.indexOf(b.event_type) ||
      a.family_name.localeCompare(b.family_name)
    );
  });

  return events;
}

export async function getCalendarWorkloadSummary(
  client: SupabaseClient,
  dateRange: { start: string; end: string },
): Promise<{
  dueToday: number;
  overdue: number;
  blocked: number;
  escalated: number;
  dueThisWeek: number;
  activeFamilies: number;
}> {
  const events = await getCalendarEvents(client, {
    startDate: dateRange.start,
    endDate: dateRange.end,
  });

  const today = toDateKey(new Date());
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = toDateKey(weekEnd);

  let dueToday = 0;
  let overdue = 0;
  let blocked = 0;
  let escalated = 0;
  let dueThisWeek = 0;
  const familyIds = new Set<string>();

  for (const e of events) {
    familyIds.add(e.family_id);
    if (e.event_type === "overdue") overdue++;
    if (e.blocked_flag) blocked++;
    if (e.escalated_flag) escalated++;
    if (e.date === today) dueToday++;
    if (e.date >= today && e.date <= weekEndKey) dueThisWeek++;
  }

  return {
    dueToday,
    overdue,
    blocked,
    escalated,
    dueThisWeek,
    activeFamilies: familyIds.size,
  };
}
