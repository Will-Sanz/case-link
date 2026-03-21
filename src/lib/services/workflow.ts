import type { SupabaseClient } from "@supabase/supabase-js";

export type NeedsAttentionItem = {
  type: "overdue" | "blocked" | "follow_up_today" | "follow_up_soon" | "escalation" | "no_activity" | "new_plan";
  family_id: string;
  family_name: string;
  step_id?: string;
  step_title?: string;
  step_phase?: string;
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

      if (s.due_date) {
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
