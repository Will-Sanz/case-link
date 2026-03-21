import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityLogRow,
  CaseNoteRow,
  FamilyBarrierRow,
  FamilyDetail,
  FamilyGoalRow,
  FamilyListItem,
  FamilyMemberRow,
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
  ]);

  for (const res of [goalsRes, barriersRes, membersRes, notesRes, activityRes]) {
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
  };
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
