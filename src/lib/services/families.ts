import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityLogRow,
  CaseNoteRow,
  FamilyBarrierRow,
  FamilyDetail,
  FamilyGoalRow,
  FamilyListItem,
  FamilyMemberRow,
  MatchedResourceSummary,
  PlanRow,
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
    .order("updated_at", { ascending: false });

  const q = filters.q?.trim();
  if (q) {
    const e = escapeIlike(q);
    qb = qb.or(`name.ilike.%${e}%,summary.ilike.%${e}%`);
  }

  if (filters.status) {
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

  const [
    goalsRes,
    barriersRes,
    membersRes,
    notesRes,
    activityRes,
    matchesRes,
    planRes,
  ] = await Promise.all([
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
      .from("activity_log")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
      .limit(30),
    client.from("resource_matches").select(
      `
        id,
        family_id,
        resource_id,
        match_reason,
        score,
        status,
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
      .select("id, family_id, version, summary, generation_source, ai_model, created_at")
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
    plan = {
      ...p,
      steps: (stepsData ?? []) as PlanStepRow[],
    };
  }

  for (const res of [
    goalsRes,
    barriersRes,
    membersRes,
    notesRes,
    activityRes,
    matchesRes,
  ]) {
    if (res.error) {
      throw new Error(res.error.message);
    }
  }

  const f = fam as FamilyDetail & {
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
    activity: (activityRes.data ?? []) as ActivityLogRow[],
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
    };
    return {
      id: row.id,
      family_id: row.family_id,
      resource_id: row.resource_id,
      match_reason: row.match_reason,
      score: row.score,
      status: row.status,
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
