import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResourceDetailRecord } from "@/types/resource-detail";
import type { ResourceListQuery } from "@/lib/validations/resource-filters";

const LIST_SELECT =
  "id, slug, active, office_or_department, program_name, description, category, primary_contact_name, primary_contact_email, primary_contact_phone, recruit_for_grocery_giveaways, tabling_at_events, promotional_materials, educational_workshops, volunteer_recruitment_support, tags, created_at, updated_at";

const DETAIL_SELECT = "*";

export type ResourceListItem = {
  id: string;
  slug: string;
  active: boolean;
  office_or_department: string;
  program_name: string;
  description: string | null;
  category: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  recruit_for_grocery_giveaways: boolean | null;
  tabling_at_events: boolean;
  promotional_materials: boolean;
  educational_workshops: boolean;
  volunteer_recruitment_support: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export async function listResources(
  client: SupabaseClient,
  filters: ResourceListQuery,
): Promise<{ items: ResourceListItem[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let qb = client
    .from("resources")
    .select(LIST_SELECT, { count: "exact" })
    .eq("active", true)
    .order("program_name", { ascending: true });

  const q = filters.q?.trim();
  if (q) {
    qb = qb.ilike("search_text", `%${escapeIlike(q)}%`);
  }

  if (filters.category?.trim()) {
    qb = qb.ilike("category", `%${escapeIlike(filters.category.trim())}%`);
  }

  if (filters.tabling === true) qb = qb.eq("tabling_at_events", true);
  if (filters.promotional === true) qb = qb.eq("promotional_materials", true);
  if (filters.educational === true) qb = qb.eq("educational_workshops", true);
  if (filters.volunteer === true) {
    qb = qb.eq("volunteer_recruitment_support", true);
  }
  if (filters.grocery === true) {
    qb = qb.eq("recruit_for_grocery_giveaways", true);
  }

  const { data, error, count } = await qb.range(from, to);

  if (error) {
    throw new Error(error.message);
  }

  return {
    items: (data ?? []) as ResourceListItem[],
    total: count ?? 0,
  };
}

export async function getResourceById(
  client: SupabaseClient,
  id: string,
): Promise<ResourceDetailRecord | null> {
  const { data, error } = await client
    .from("resources")
    .select(DETAIL_SELECT)
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data as ResourceDetailRecord | null;
}

export async function countResources(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from("resources")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}
