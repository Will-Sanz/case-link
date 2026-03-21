import type { SupabaseClient } from "@supabase/supabase-js";

function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

export type ResourcePickerRow = {
  id: string;
  program_name: string;
  office_or_department: string;
  category: string | null;
};

export async function searchResourcesForPicker(
  client: SupabaseClient,
  q: string,
  limit = 15,
): Promise<ResourcePickerRow[]> {
  const t = q.trim();
  let qb = client
    .from("resources")
    .select("id, program_name, office_or_department, category")
    .eq("active", true)
    .order("program_name", { ascending: true })
    .limit(limit);

  if (t.length > 0) {
    const e = escapeIlike(t);
    qb = qb.or(
      `program_name.ilike.%${e}%,office_or_department.ilike.%${e}%,category.ilike.%${e}%`,
    );
  }

  const { data, error } = await qb;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ResourcePickerRow[];
}
