import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });

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

const nextWorkRowsSchema = z.array(z.object({
  family_id: z.uuid(),
  current_step: z.object({
    id: z.uuid(), title: z.string(), phase: z.string(),
    status: z.enum(["pending", "in_progress", "blocked"]),
    due_date: z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullable(), action_needed_now: z.string(),
    is_blocked: z.boolean(), is_escalated: z.boolean(),
  }).nullable(),
})).max(100);

/** The database returns one summary per visible family, independent of child-row API limits. */
export async function enrichFamiliesWithCurrentStep(
  client: SupabaseClient,
  items: FamilyListItem[],
): Promise<FamilyWithCurrentStep[]> {
  if (items.length === 0) return [];

  const { data, error } = await client.rpc("get_family_next_work", {
    p_family_ids: items.map((item) => item.id),
  });
  if (error) throw new Error(error.message);
  const parsed = nextWorkRowsSchema.safeParse(data);
  if (!parsed.success) throw new Error("Could not load current family work. Refresh and try again.");
  const byFamily = new Map(parsed.data.map((row) => [row.family_id, row.current_step]));
  if (byFamily.size !== items.length || parsed.data.length !== items.length || items.some((item) => !byFamily.has(item.id))) {
    throw new Error("Family access changed while loading. Refresh and try again.");
  }
  return items.map((item) => ({ ...item, current_step: byFamily.get(item.id)! }));
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

  const [goalsRes, membersRes, notesRes, progressRes, matchesRes, planRes] =
    await Promise.all([
    client
      .from("family_goals")
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
          active,
          is_demo,
          updated_at,
          slug,
          program_name,
          office_or_department,
          category,
          description,
          services_select_all,
          additional_info,
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
    client.rpc("get_family_plan_snapshot", { p_family_id: familyId }),
  ]);

  for (const res of [goalsRes, membersRes, notesRes, progressRes, matchesRes, planRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  if (!planRes.data) return null;
  const snapshot = planRes.data as { family: FamilyDetail; barriers: FamilyBarrierRow[]; plan: PlanWithSteps | null };
  const plan = snapshot.plan ? { ...snapshot.plan, presentation: buildPlanPresentation(snapshot.plan) } : null;

  const f = { ...fam, ...snapshot.family } as unknown as FamilyDetail & {
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
    barriers: snapshot.barriers,
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
