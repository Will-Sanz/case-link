import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPlanPresentation } from "@/lib/domain/plan/presentation";
import type {
  CaseNoteRow,
  FamilyBarrierRow,
  FamilyDetail,
  FamilyGoalRow,
  FamilyListItem,
  FamilyMemberRow,
  FamilyWithCurrentStep,
  MatchedResourceSummary,
  PlanRow,
  PlanStepActionItemRow,
  PlanStepRow,
  PlanWithSteps,
  ResourceMatchRow,
} from "@/types/family";
import type { FamilyListQuery } from "@/lib/validations/family-list-query";

function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

export async function listFamilies(
  client: SupabaseClient,
  filters: FamilyListQuery,
): Promise<{ items: FamilyListItem[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let qb = client
    .from("families")
    .select(
      `
      id,
      name,
      summary,
      urgency,
      status,
      created_at,
      updated_at,
      created_by_id,
      creator:app_users!families_created_by_id_fkey ( email )
    `,
      { count: "exact" },
    )
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  const q = filters.q?.trim();
  if (q) {
    const e = escapeIlike(q);
    qb = qb.or(`name.ilike.%${e}%,summary.ilike.%${e}%`);
  }

  if (filters.statusIn && filters.statusIn.length > 0) {
    qb = qb.in("status", filters.statusIn);
  } else if (filters.status) {
    qb = qb.eq("status", filters.status);
  }
  if (filters.urgency) {
    qb = qb.eq("urgency", filters.urgency);
  }

  const { data, error, count } = await qb.range(from, to);

  if (error) {
    throw new Error(error.message);
  }

  const items = (data ?? []).map((row) => {
    const r = row as FamilyListItem & {
      creator: { email: string } | { email: string }[] | null;
    };
    const creatorRaw = r.creator;
    const creator = Array.isArray(creatorRaw)
      ? creatorRaw[0] ?? null
      : creatorRaw;
    return { ...r, creator } as FamilyListItem;
  });

  return { items, total: count ?? 0 };
}

/** Enriches family list items with current active step and action summary */
export async function enrichFamiliesWithCurrentStep(
  client: SupabaseClient,
  items: FamilyListItem[],
): Promise<FamilyWithCurrentStep[]> {
  if (items.length === 0) return [];

  const familyIds = items.map((f) => f.id);
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
    .select("id, plan_id, title, phase, status, workflow_data")
    .in("plan_id", planIds)
    .order("sort_order", { ascending: true });

  const familyIdByPlanId = new Map<string, string>();
  for (const p of plans ?? []) {
    familyIdByPlanId.set(p.id, p.family_id);
  }

  const activeStepByFamily = new Map<
    string,
    { id: string; title: string; phase: string; status: string; workflow_data: unknown }
  >();
  for (const s of steps ?? []) {
    const fid = familyIdByPlanId.get(s.plan_id);
    if (!fid || activeStepByFamily.has(fid)) continue;
    if (["pending", "in_progress", "blocked"].includes(s.status)) {
      activeStepByFamily.set(fid, s);
    }
  }

  return items.map((item) => {
    const step = activeStepByFamily.get(item.id);
    if (!step) {
      return { ...item, current_step: null };
    }
    const w = (step.workflow_data as { needs_escalation?: boolean }) ?? {};

    const actionNeeded =
      step.status === "blocked" ? `Blocked: ${step.title}` : step.title;

    return {
      ...item,
      current_step: {
        id: step.id,
        title: step.title,
        phase: step.phase,
        status: step.status,
        due_date: null,
        action_needed_now: actionNeeded,
        is_blocked: step.status === "blocked",
        is_escalated: !!w.needs_escalation,
      },
    };
  });
}

export async function getFamilyDetail(
  client: SupabaseClient,
  familyId: string,
): Promise<FamilyDetail | null> {
  const { data: fam, error: famErr } = await client
    .from("families")
    .select(
      `
      id,
      name,
      summary,
      urgency,
      household_notes,
      status,
      created_by_id,
      created_at,
      updated_at,
      archived_at,
      creator:app_users!families_created_by_id_fkey ( email )
    `,
    )
    .eq("id", familyId)
    .maybeSingle();

  if (famErr) {
    throw new Error(famErr.message);
  }
  if (!fam) {
    return null;
  }
  const famRow = fam as { archived_at?: string | null };
  if (famRow.archived_at) {
    return null;
  }

  const [goalsRes, barriersRes, membersRes, notesRes, matchesRes, planRes] =
    await Promise.all([
    client
      .from("family_goals")
      .select("*")
      .eq("family_id", familyId)
      .order("sort_order", { ascending: true }),
    client
      .from("family_barriers")
      .select("*")
      .eq("family_id", familyId)
      .order("sort_order", { ascending: true }),
    client
      .from("family_members")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true }),
    client
      .from("case_notes")
      .select(
        `
        id,
        family_id,
        author_id,
        body,
        created_at,
        author:app_users!case_notes_author_id_fkey ( email )
      `,
      )
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
      .limit(50),
    client.from("resource_matches").select(
      `
        id,
        family_id,
        resource_id,
        match_reason,
        score,
        status,
        plan_step_id,
        created_at,
        updated_at,
        resource:resources (
          id,
          slug,
          program_name,
          office_or_department,
          category,
          primary_contact_name,
          primary_contact_title,
          primary_contact_email,
          primary_contact_phone,
          secondary_contact_name,
          secondary_contact_email,
          secondary_contact_phone,
          recruit_for_grocery_giveaways,
          tabling_at_events,
          promotional_materials,
          educational_workshops,
          volunteer_recruitment_support
        )
      `,
    ).eq("family_id", familyId),
    client
      .from("plans")
      .select(
        "id, family_id, version, summary, generation_source, ai_model, created_at, client_display, generation_state",
      )
      .eq("family_id", familyId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let plan: PlanWithSteps | null = null;
  if (planRes.data) {
    const p = planRes.data as PlanRow;
    const { data: stepsData } = await client
      .from("plan_steps")
      .select("*")
      .eq("plan_id", p.id)
      .order("sort_order", { ascending: true });

    const stepIds = (stepsData ?? []).map((s) => s.id);
    let actionItemsByStep = new Map<string, PlanStepActionItemRow[]>();
    if (stepIds.length > 0) {
      const { data: actionItems } = await client
        .from("plan_step_action_items")
        .select("*")
        .in("plan_step_id", stepIds)
        .order("sort_order", { ascending: true });
      for (const ai of actionItems ?? []) {
        const list = actionItemsByStep.get(ai.plan_step_id) ?? [];
        list.push(ai as PlanStepActionItemRow);
        actionItemsByStep.set(ai.plan_step_id, list);
      }
    }

    const stepsWithItems = (stepsData ?? []).map((s) => ({
      ...s,
      action_items: actionItemsByStep.get(s.id) ?? [],
    })) as PlanStepRow[];

    plan = {
      ...p,
      steps: stepsWithItems,
      presentation: buildPlanPresentation(p),
    };
  }

  for (const res of [goalsRes, barriersRes, membersRes, notesRes, matchesRes]) {
    if (res.error) {
      throw new Error(res.error.message);
    }
  }
  if (planRes.error) {
    throw new Error(planRes.error.message);
  }

  const f = fam as unknown as FamilyDetail & {
    creator: { email: string } | { email: string }[] | null;
  };
  const creatorRaw = f.creator;
  const creator = Array.isArray(creatorRaw)
    ? creatorRaw[0] ?? null
    : creatorRaw;

  return {
    id: f.id,
    name: f.name,
    summary: f.summary,
    urgency: f.urgency,
    household_notes: f.household_notes,
    status: f.status,
    created_by_id: f.created_by_id,
    created_at: f.created_at,
    updated_at: f.updated_at,
    creator,
    goals: (goalsRes.data ?? []) as FamilyGoalRow[],
    barriers: (barriersRes.data ?? []) as FamilyBarrierRow[],
    members: (membersRes.data ?? []) as FamilyMemberRow[],
    caseNotes: normalizeCaseNotes(notesRes.data ?? []),
    resourceMatches: sortResourceMatches(
      normalizeResourceMatches(matchesRes.data ?? []),
    ),
    plan,
  };
}

function normalizeResourceEmbed(
  raw: MatchedResourceSummary | MatchedResourceSummary[] | null,
): MatchedResourceSummary | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

function normalizeResourceMatches(rows: unknown[]): ResourceMatchRow[] {
  return rows.map((raw) => {
    const row = raw as ResourceMatchRow & {
      resource?: MatchedResourceSummary | MatchedResourceSummary[] | null;
      plan_step_id?: string | null;
    };
    return {
      id: row.id,
      family_id: row.family_id,
      resource_id: row.resource_id,
      match_reason: row.match_reason,
      score: row.score,
      status: row.status,
      plan_step_id: row.plan_step_id ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      resource: normalizeResourceEmbed(row.resource ?? null),
    };
  });
}

const STATUS_ORDER: Record<ResourceMatchRow["status"], number> = {
  accepted: 0,
  suggested: 1,
  dismissed: 2,
};

function sortResourceMatches(rows: ResourceMatchRow[]): ResourceMatchRow[] {
  return [...rows].sort((a, b) => {
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (so !== 0) return so;
    if (b.score !== a.score) return b.score - a.score;
    return a.created_at.localeCompare(b.created_at);
  });
}

function normalizeCaseNotes(rows: unknown[]): CaseNoteRow[] {
  return rows.map((raw) => {
    const row = raw as CaseNoteRow & {
      author?: { email: string } | { email: string }[] | null;
    };
    const a = row.author;
    const author = Array.isArray(a) ? a[0] ?? null : a ?? null;
    return {
      id: row.id,
      family_id: row.family_id,
      author_id: row.author_id,
      body: row.body,
      created_at: row.created_at,
      author,
    };
  });
}
