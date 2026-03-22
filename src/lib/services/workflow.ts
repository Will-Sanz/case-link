import type { SupabaseClient } from "@supabase/supabase-js";

export type NeedsAttentionItem = {
  type: "overdue" | "blocked" | "follow_up_today" | "follow_up_soon" | "escalation" | "in_progress" | "no_activity" | "new_plan";
  family_id: string;
  family_name: string;
  step_id?: string;
  step_title?: string;
  step_phase?: string;
  action_item_id?: string;
  action_item_title?: string;
  due_date?: string;
  days_overdue?: number;
  days_since_activity?: number;
  plan_id?: string;
};

export type CaseActivityItem = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_email?: string;
};

export type StepActivityItem = {
  id: string;
  action: string;
  activity_type: string | null;
  notes: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

const STALE_DAYS = 7;
const SOON_DAYS = 3;

export async function getNeedsAttention(
  client: SupabaseClient,
  options?: { familyId?: string; limit?: number },
): Promise<NeedsAttentionItem[]> {
  const limit = options?.limit ?? 50;
  const items: NeedsAttentionItem[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const soonEnd = new Date(today);
  soonEnd.setDate(soonEnd.getDate() + SOON_DAYS);
  const staleCutoff = new Date(today);
  staleCutoff.setDate(staleCutoff.getDate() - STALE_DAYS);

  const familyFilter = options?.familyId ? { family_id: options.familyId } : {};

  const { data: families } = await client
    .from("families")
    .select("id, name, updated_at")
    .eq("status", "active")
    .match(familyFilter);

  if (!families?.length) return items;

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
    .select("id, plan_id, title, phase, status, due_date, workflow_data")
    .in("plan_id", planIds)
    .in("status", ["pending", "in_progress", "blocked"]);

  const stepIds = (steps ?? []).map((s) => s.id);
  let actionItems: Array<{
    id: string;
    plan_step_id: string;
    title: string;
    target_date: string | null;
    status: string;
  }> = [];
  if (stepIds.length > 0) {
    const { data: aiData } = await client
      .from("plan_step_action_items")
      .select("id, plan_step_id, title, target_date, status")
      .in("plan_step_id", stepIds)
      .neq("status", "completed");
    actionItems = aiData ?? [];
  }
  const actionItemsByStep = new Map<string, typeof actionItems>();
  for (const ai of actionItems) {
    const list = actionItemsByStep.get(ai.plan_step_id) ?? [];
    list.push(ai);
    actionItemsByStep.set(ai.plan_step_id, list);
  }

  if (!steps?.length) {
    for (const f of families) {
      const plan = latestPlanByFamily.get(f.id);
      const famUpdated = new Date(f.updated_at);
      if (famUpdated < staleCutoff) {
        items.push({
          type: "no_activity",
          family_id: f.id,
          family_name: f.name,
          days_since_activity: Math.floor(
            (today.getTime() - famUpdated.getTime()) / (1000 * 60 * 60 * 24),
          ),
        });
      } else if (plan) {
        const planCreated = new Date(plan.created_at);
        const daysSince = Math.floor(
          (today.getTime() - planCreated.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysSince <= 1) {
          items.push({
            type: "new_plan",
            family_id: f.id,
            family_name: f.name,
            plan_id: plan.id,
          });
        }
      }
    }
  } else {
    for (const s of steps) {
      const familyId = familyIdByPlanId.get(s.plan_id);
      if (!familyId) continue;
      const fam = familyMap.get(familyId);
      const familyName = fam?.name ?? "Unknown";
      const stepActionItems = actionItemsByStep.get(s.id) ?? [];
      const hasActionItems = stepActionItems.length > 0;

      const w = (s.workflow_data as { needs_escalation?: boolean }) ?? {};
      if (w.needs_escalation) {
        items.push({
          type: "escalation",
          family_id: familyId,
          family_name: familyName,
          step_id: s.id,
          step_title: s.title,
          step_phase: s.phase,
        });
      }

      if (s.status === "blocked") {
        items.push({
          type: "blocked",
          family_id: familyId,
          family_name: familyName,
          step_id: s.id,
          step_title: s.title,
          step_phase: s.phase,
        });
      }

      if (hasActionItems) {
        for (const ai of stepActionItems) {
          if (!ai.target_date) continue;
          const due = new Date(ai.target_date);
          if (due < today) {
            const daysOverdue = Math.floor(
              (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
            );
            items.push({
              type: "overdue",
              family_id: familyId,
              family_name: familyName,
              step_id: s.id,
              step_title: s.title,
              step_phase: s.phase,
              action_item_id: ai.id,
              action_item_title: ai.title,
              due_date: ai.target_date,
              days_overdue: daysOverdue,
            });
          } else if (due >= today && due < todayEnd) {
            items.push({
              type: "follow_up_today",
              family_id: familyId,
              family_name: familyName,
              step_id: s.id,
              step_title: s.title,
              step_phase: s.phase,
              action_item_id: ai.id,
              action_item_title: ai.title,
              due_date: ai.target_date,
            });
          } else if (due < soonEnd) {
            items.push({
              type: "follow_up_soon",
              family_id: familyId,
              family_name: familyName,
              step_id: s.id,
              step_title: s.title,
              step_phase: s.phase,
              action_item_id: ai.id,
              action_item_title: ai.title,
              due_date: ai.target_date,
            });
          }
        }
      } else if (s.due_date) {
        const due = new Date(s.due_date);
        if (due < today) {
          const daysOverdue = Math.floor(
            (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
          );
          items.push({
            type: "overdue",
            family_id: familyId,
            family_name: familyName,
            step_id: s.id,
            step_title: s.title,
            step_phase: s.phase,
            due_date: s.due_date,
            days_overdue: daysOverdue,
          });
        } else if (due >= today && due < todayEnd) {
          items.push({
            type: "follow_up_today",
            family_id: familyId,
            family_name: familyName,
            step_id: s.id,
            step_title: s.title,
            step_phase: s.phase,
            due_date: s.due_date,
          });
        } else if (due < soonEnd) {
          items.push({
            type: "follow_up_soon",
            family_id: familyId,
            family_name: familyName,
            step_id: s.id,
            step_title: s.title,
            step_phase: s.phase,
            due_date: s.due_date,
          });
        }
      }

      if (s.status === "in_progress") {
        const alreadyAdded = items.some((i) => i.step_id === s.id);
        if (!alreadyAdded) {
          items.push({
            type: "in_progress",
            family_id: familyId,
            family_name: familyName,
            step_id: s.id,
            step_title: s.title,
            step_phase: s.phase,
          });
        }
      }
    }

    for (const f of families) {
      const famUpdated = new Date(f.updated_at);
      if (famUpdated < staleCutoff && !items.some((i) => i.family_id === f.id)) {
        items.push({
          type: "no_activity",
          family_id: f.id,
          family_name: f.name,
          days_since_activity: Math.floor(
            (today.getTime() - famUpdated.getTime()) / (1000 * 60 * 60 * 24),
          ),
        });
      }

      const plan = latestPlanByFamily.get(f.id);
      if (plan) {
        const planCreated = new Date(plan.created_at);
        const daysSince = Math.floor(
          (today.getTime() - planCreated.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (
          daysSince <= 1 &&
          !items.some((i) => i.family_id === f.id && i.type === "new_plan")
        ) {
          const hasInteraction = steps.some(
            (st) =>
              familyIdByPlanId.get(st.plan_id) === f.id &&
              (st.status !== "pending" || st.due_date),
          );
          if (!hasInteraction) {
            items.push({
              type: "new_plan",
              family_id: f.id,
              family_name: f.name,
              plan_id: plan.id,
            });
          }
        }
      }
    }
  }

  const typeOrder: NeedsAttentionItem["type"][] = [
    "overdue",
    "follow_up_today",
    "blocked",
    "escalation",
    "follow_up_soon",
    "in_progress",
    "new_plan",
    "no_activity",
  ];
  items.sort(
    (a, b) =>
      typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) ||
      (a.family_name ?? "").localeCompare(b.family_name ?? ""),
  );

  return items.slice(0, limit);
}

export async function getCaseActivity(
  client: SupabaseClient,
  familyId: string,
  limit = 30,
): Promise<CaseActivityItem[]> {
  const { data, error } = await client
    .from("activity_log")
    .select("id, action, entity_type, entity_id, details, created_at, actor_user_id")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const userIds = [...new Set((data ?? []).map((r: { actor_user_id?: string }) => r.actor_user_id).filter(Boolean))] as string[];
  let userEmails: Map<string, string> = new Map();
  if (userIds.length > 0) {
    const { data: users } = await client
      .from("app_users")
      .select("id, email")
      .in("id", userIds);
    userEmails = new Map((users ?? []).map((u: { id: string; email: string }) => [u.id, u.email]));
  }

  return (data ?? []).map((row: unknown) => {
    const r = row as CaseActivityItem & { actor_user_id?: string };
    return {
      id: r.id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      details: r.details as Record<string, unknown> | null,
      created_at: r.created_at,
      actor_email: r.actor_user_id ? userEmails.get(r.actor_user_id) : undefined,
    };
  });
}

export type ChecklistProgress = {
  completed: number;
  total: number;
};

export type DashboardFamilySummary = {
  family_id: string;
  family_name: string;
  urgency: string | null;
  status: string;
  updated_at: string;
  current_step: {
    id: string;
    title: string;
    phase: string;
    status: string;
    due_date: string | null;
    action_needed_now: string;
    is_blocked: boolean;
    is_escalated: boolean;
    days_overdue?: number;
    days_since_activity?: number;
    checklist_progress?: ChecklistProgress;
  } | null;
};

export type ActionableItem = {
  family_id: string;
  family_name: string;
  step_id: string;
  step_title: string;
  step_phase: string;
  step_status?: string;
  action: string;
  type: "overdue" | "blocked" | "follow_up_today" | "follow_up_soon" | "escalation" | "in_progress" | "no_activity" | "new_plan";
  due_date?: string | null;
  days_overdue?: number;
  checklist_progress?: { completed: number; total: number };
};

export async function getDashboardData(
  client: SupabaseClient,
  options?: { limit?: number },
): Promise<{
  familiesNeedingAttention: DashboardFamilySummary[];
  actionableItems: ActionableItem[];
  summaryCounts: { overdue: number; blocked: number; dueToday: number; escalated: number };
}> {
  const limit = options?.limit ?? 20;
  const needsItems = await getNeedsAttention(client, { limit: 100 });

  const familyIds = [...new Set(needsItems.map((i) => i.family_id))];
  if (familyIds.length === 0) {
    return {
      familiesNeedingAttention: [],
      actionableItems: [],
      summaryCounts: { overdue: 0, blocked: 0, dueToday: 0, escalated: 0 },
    };
  }

  const { data: families } = await client
    .from("families")
    .select("id, name, urgency, status, updated_at")
    .in("id", familyIds);

  const { data: plans } = await client
    .from("plans")
    .select("id, family_id")
    .in("family_id", familyIds)
    .order("version", { ascending: false });

  const latestPlanByFamily = new Map<string, string>();
  for (const p of plans ?? []) {
    if (!latestPlanByFamily.has(p.family_id)) {
      latestPlanByFamily.set(p.family_id, p.id);
    }
  }

  const planIds = [...latestPlanByFamily.values()];
  const { data: steps } = await client
    .from("plan_steps")
    .select("id, plan_id, title, phase, status, due_date, workflow_data, details")
    .in("plan_id", planIds)
    .order("sort_order", { ascending: true });

  const familyIdByPlanId = new Map<string, string>();
  for (const p of plans ?? []) {
    familyIdByPlanId.set(p.id, p.family_id);
  }

  type StepRow = {
    id: string;
    plan_id: string;
    title: string;
    phase: string;
    status: string;
    due_date: string | null;
    workflow_data: unknown;
    details?: { checklist?: string[] } | null;
  };
  const activeStepByFamily = new Map<string, StepRow>();
  for (const s of steps ?? []) {
    const fid = familyIdByPlanId.get(s.plan_id);
    if (!fid || activeStepByFamily.has(fid)) continue;
    if (["pending", "in_progress", "blocked"].includes(s.status)) {
      activeStepByFamily.set(fid, s);
    }
  }

  function getChecklistProgress(step: StepRow): { completed: number; total: number } | undefined {
    const details = (step.details as { checklist?: string[] } | null) ?? {};
    const checklist = details.checklist ?? [];
    if (checklist.length === 0) return undefined;
    const wd = (step.workflow_data as { checklist_completed?: boolean[] }) ?? {};
    const completedArr = wd.checklist_completed ?? [];
    const completed = checklist.filter((_, i) => completedArr[i]).length;
    return { completed, total: checklist.length };
  }

  const stepById = new Map<string, StepRow>();
  for (const s of steps ?? []) {
    stepById.set(s.id, s as StepRow);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const familyMap = new Map((families ?? []).map((f) => [f.id, f]));

  const familiesNeedingAttention: DashboardFamilySummary[] = familyIds
    .slice(0, limit)
    .map((fid) => {
      const fam = familyMap.get(fid);
      const step = activeStepByFamily.get(fid);
      const itemsForFamily = needsItems.filter((i) => i.family_id === fid);

      let actionNeeded = "Open case to continue";
      if (itemsForFamily.length > 0) {
        const first = itemsForFamily[0];
        const title = first.action_item_title ?? first.step_title ?? "";
        if (first.type === "overdue")
          actionNeeded = title
            ? `${first.family_name}: ${title} (${first.days_overdue}d overdue)`
            : `Follow up (${first.days_overdue}d overdue)`;
        else if (first.type === "follow_up_today")
          actionNeeded = title ? `${first.family_name}: ${title}` : `Due today: ${first.step_title ?? ""}`;
        else if (first.type === "blocked")
          actionNeeded = `Blocked: ${first.step_title ?? ""}`;
        else if (first.type === "escalation")
          actionNeeded = `Escalation: ${first.step_title ?? ""}`;
        else if (first.type === "no_activity")
          actionNeeded = `No activity in ${first.days_since_activity ?? 0} days`;
        else if (first.type === "new_plan")
          actionNeeded = "Review new plan";
        else if (first.type === "follow_up_soon")
          actionNeeded = title ? `${first.family_name}: ${title}` : (first.step_title ?? actionNeeded);
        else actionNeeded = (title || first.step_title) ?? actionNeeded;
      }

      const w = (step?.workflow_data as { needs_escalation?: boolean }) ?? {};
      const due = step?.due_date ? new Date(step.due_date) : null;
      const daysOverdue = due && due < today
        ? Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
        : undefined;

      return {
        family_id: fid,
        family_name: fam?.name ?? "Unknown",
        urgency: fam?.urgency ?? null,
        status: fam?.status ?? "active",
        updated_at: fam?.updated_at ?? "",
        current_step: step
          ? {
              id: step.id,
              title: step.title,
              phase: step.phase,
              status: step.status,
              due_date: step.due_date,
              action_needed_now: actionNeeded,
              is_blocked: step.status === "blocked",
              is_escalated: !!w.needs_escalation,
              days_overdue: daysOverdue,
              checklist_progress: getChecklistProgress(step),
            }
          : null,
      };
    });

  const actionableItems: ActionableItem[] = needsItems.slice(0, 25).map((i) => {
    const itemTitle = i.action_item_title ?? i.step_title ?? "";
    let action = itemTitle || "Open case";
    if (i.type === "overdue")
      action = itemTitle
        ? `${i.family_name}: ${itemTitle} (${i.days_overdue}d overdue)`
        : `Follow up: ${i.step_title ?? ""} (${i.days_overdue}d overdue)`;
    else if (i.type === "blocked") action = `Resolve blocker: ${i.step_title ?? ""}`;
    else if (i.type === "follow_up_today")
      action = itemTitle ? `${i.family_name}: ${itemTitle}` : `Due today: ${i.step_title ?? ""}`;
    else if (i.type === "follow_up_soon")
      action = itemTitle ? `${i.family_name}: ${itemTitle}` : `Due soon: ${i.step_title ?? ""}`;
    else if (i.type === "escalation") action = `Escalation: ${i.step_title ?? ""}`;
    else if (i.type === "in_progress") action = itemTitle ? `${i.family_name}: ${itemTitle}` : `Continue: ${i.step_title ?? ""}`;
    else if (i.type === "no_activity") action = `Check in: ${i.family_name} (${i.days_since_activity}d no activity)`;
    else if (i.type === "new_plan") action = `Review plan: ${i.family_name}`;

    const step = i.step_id ? stepById.get(i.step_id) : undefined;
    const checklistProgress = step ? getChecklistProgress(step) : undefined;

    return {
      family_id: i.family_id,
      family_name: i.family_name,
      step_id: i.step_id ?? "",
      step_title: i.step_title ?? "",
      step_phase: i.step_phase ?? "",
      step_status: step?.status,
      action,
      type: i.type,
      due_date: i.due_date ?? null,
      days_overdue: i.days_overdue,
      checklist_progress: checklistProgress,
    };
  });

  const summaryCounts = {
    overdue: needsItems.filter((i) => i.type === "overdue").length,
    blocked: needsItems.filter((i) => i.type === "blocked").length,
    dueToday: needsItems.filter((i) => i.type === "follow_up_today").length,
    escalated: needsItems.filter((i) => i.type === "escalation").length,
  };

  return {
    familiesNeedingAttention,
    actionableItems,
    summaryCounts,
  };
}

export async function getStepActivity(
  client: SupabaseClient,
  stepId: string,
  limit = 50,
): Promise<StepActivityItem[]> {
  const { data, error } = await client
    .from("plan_step_activity")
    .select("id, action, activity_type, notes, details, created_at")
    .eq("plan_step_id", stepId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []) as StepActivityItem[];
}
