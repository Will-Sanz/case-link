import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarEventType } from "@/types/calendar";

const STALE_DAYS = 7;

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Derive target date from plan start + week_index when target_date and follow_up_date are null */
function deriveTargetDateFromWeek(
  planCreatedAt: string,
  weekIndex: number,
  itemIndexInStep: number,
): string {
  const planStart = new Date(planCreatedAt);
  planStart.setHours(0, 0, 0, 0);
  const d = new Date(planStart);
  const daysOffset = (weekIndex - 1) * 7 + Math.min(itemIndexInStep % 5, 4);
  d.setDate(d.getDate() + daysOffset);
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
    .select("id, plan_id, title, phase, status, due_date, workflow_data, details")
    .in("plan_id", planIds)
    .order("sort_order", { ascending: true });

  const stepIds = (steps ?? []).map((s) => s.id);

  let actionItems: Array<{
    id: string;
    plan_step_id: string;
    title: string;
    target_date: string | null;
    follow_up_date: string | null;
    status: string;
    sort_order: number;
    week_index: number;
  }> = [];
  if (stepIds.length > 0) {
    const { data: aiData } = await client
      .from("plan_step_action_items")
      .select("id, plan_step_id, title, target_date, follow_up_date, status, sort_order, week_index")
      .in("plan_step_id", stepIds)
      .neq("status", "completed")
      .order("sort_order", { ascending: true });
    actionItems = (aiData ?? []).map((a) => ({
      ...a,
      week_index: a.week_index ?? 1,
    }));
  }


  const actionItemsByStep = new Map<string, typeof actionItems>();
  for (const ai of actionItems) {
    const list = actionItemsByStep.get(ai.plan_step_id) ?? [];
    list.push(ai);
    actionItemsByStep.set(ai.plan_step_id, list);
  }

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
    const details = (s.details as { priority?: "low" | "medium" | "high" }) ?? {};
    const isBlocked = s.status === "blocked";
    const isEscalated = !!w.needs_escalation;
    const stepActionItems = actionItemsByStep.get(s.id) ?? [];
    const hasActionItems = stepActionItems.length > 0;

    if (hasActionItems) {
      const plan = latestPlanByFamily.get(familyId);
      const planCreatedAt = plan?.created_at ?? new Date().toISOString();

      for (let j = 0; j < stepActionItems.length; j++) {
        const ai = stepActionItems[j];
        const effectiveDate =
          ai.target_date ??
          ai.follow_up_date ??
          deriveTargetDateFromWeek(planCreatedAt, ai.week_index, j);
        if (!effectiveDate) continue;

        const due = new Date(effectiveDate + "T12:00:00");
        const dueKey = toDateKey(due);
        const actionTitle = `${familyName}: ${ai.title}`;
        const baseEv = {
          family_id: familyId,
          family_name: familyName,
          step_id: s.id,
          step_title: s.title,
          action_item_id: ai.id,
          stage: s.phase as "30" | "60" | "90",
          status: ai.status,
          urgency,
          blocked_flag: isBlocked,
          escalated_flag: isEscalated,
          action_needed_now: actionTitle,
          priority: details.priority ?? null,
        };
        if (due < today) {
          addEvent({
            ...baseEv,
            id: `overdue-${ai.id}`,
            event_type: "overdue",
            date: dueKey,
            source_type: "due_date",
            days_overdue: Math.floor(
              (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
            ),
          });
        } else {
          addEvent({
            ...baseEv,
            id: `follow-${ai.id}`,
            event_type: dueKey === todayKey ? "follow_up_due" : "step_due",
            date: dueKey,
            source_type: "follow_up",
          });
        }
      }
    } else if (s.due_date) {
      const due = new Date(s.due_date + "T12:00:00");
      const dueKey = toDateKey(due);
      const stepEv = {
        family_id: familyId,
        family_name: familyName,
        step_id: s.id,
        step_title: s.title,
        stage: s.phase as "30" | "60" | "90",
        status: s.status,
        urgency,
        blocked_flag: isBlocked,
        escalated_flag: isEscalated,
        action_needed_now: `${familyName}: ${s.title}`,
        priority: details.priority ?? null,
      };
      if (due < today) {
        addEvent({
          ...stepEv,
          id: `overdue-${s.id}`,
          event_type: "overdue",
          date: dueKey,
          source_type: "due_date",
          days_overdue: Math.floor(
            (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
          ),
        });
      } else {
        addEvent({
          ...stepEv,
          id: `follow-${s.id}`,
          event_type: dueKey === todayKey ? "follow_up_due" : "step_due",
          date: dueKey,
          source_type: "follow_up",
        });
      }
    }

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
