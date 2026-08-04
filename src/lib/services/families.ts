import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPlanPresentation } from "@/lib/domain/plan/presentation";
import type {
  CaseNoteRow,
  CaseProgressPlanChange,
  CaseProgressUpdateRow,
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
import { selectNextFamilyWork } from "@/lib/domain/family-workspace/next-work";

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
  const { data: plans, error: plansError } = await client
    .from("plans")
    .select("id, family_id")
    .in("family_id", familyIds)
    .order("version", { ascending: false });

  if (plansError) throw new Error(plansError.message);

  const latestPlanByFamily = new Map<string, string>();
  for (const p of plans ?? []) {
    if (!latestPlanByFamily.has(p.family_id)) {
      latestPlanByFamily.set(p.family_id, p.id);
    }
  }

  const planIds = [...latestPlanByFamily.values()];
  if (planIds.length === 0) {
    return items.map((item) => ({ ...item, current_step: null }));
  }

  const { data: steps, error: stepsError } = await client
    .from("plan_steps")
    .select("id, plan_id, title, phase, status, due_date, sort_order, details, workflow_data")
    .in("plan_id", planIds)
    .order("sort_order", { ascending: true });

  if (stepsError) throw new Error(stepsError.message);

  const stepIds = (steps ?? []).map((step) => step.id);
  const actionItemsByStep = new Map<string, PlanStepActionItemRow[]>();
  if (stepIds.length > 0) {
    const { data: actionItems, error: actionItemsError } = await client
      .from("plan_step_action_items")
      .select("*")
      .in("plan_step_id", stepIds)
      .order("sort_order", { ascending: true });

    if (actionItemsError) throw new Error(actionItemsError.message);

    for (const actionItem of actionItems ?? []) {
      const current = actionItemsByStep.get(actionItem.plan_step_id) ?? [];
      current.push(actionItem as PlanStepActionItemRow);
      actionItemsByStep.set(actionItem.plan_step_id, current);
    }
  }

  const familyIdByPlanId = new Map<string, string>();
  for (const p of plans ?? []) {
    familyIdByPlanId.set(p.id, p.family_id);
  }

  const stepsByFamily = new Map<string, PlanStepRow[]>();
  for (const s of steps ?? []) {
    const fid = familyIdByPlanId.get(s.plan_id);
    if (!fid) continue;
    const current = stepsByFamily.get(fid) ?? [];
    current.push({
      ...s,
      action_items: actionItemsByStep.get(s.id) ?? [],
    } as PlanStepRow);
    stepsByFamily.set(fid, current);
  }

  return items.map((item) => {
    return {
      ...item,
      current_step: selectNextFamilyWork(stepsByFamily.get(item.id) ?? []),
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

  const [goalsRes, barriersRes, membersRes, notesRes, progressRes, matchesRes, planRes] =
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
    client
      .from("case_progress_updates")
      .select(
        `
        id,
        family_id,
        plan_id,
        author_id,
        occurred_on,
        summary,
        plan_changes,
        created_at,
        author:app_users!case_progress_updates_author_id_fkey ( email )
      `,
      )
      .eq("family_id", familyId)
      .order("occurred_on", { ascending: false })
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
    const actionItemsByStep = new Map<string, PlanStepActionItemRow[]>();
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

  for (const res of [goalsRes, barriersRes, membersRes, notesRes, progressRes, matchesRes]) {
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
    progressUpdates: normalizeProgressUpdates(progressRes.data ?? []),
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

function normalizeProgressUpdates(rows: unknown[]): CaseProgressUpdateRow[] {
  return rows.map((raw) => {
    const row = raw as Omit<CaseProgressUpdateRow, "author" | "plan_changes"> & {
      author?: { email: string } | { email: string }[] | null;
      plan_changes?: unknown;
    };
    const a = row.author;
    const author = Array.isArray(a) ? a[0] ?? null : a ?? null;
    return {
      id: row.id,
      family_id: row.family_id,
      plan_id: row.plan_id,
      author_id: row.author_id,
      occurred_on: row.occurred_on,
      summary: row.summary,
      plan_changes: Array.isArray(row.plan_changes)
        ? (row.plan_changes as CaseProgressPlanChange[])
        : [],
      created_at: row.created_at,
      author,
    };
  });
}
