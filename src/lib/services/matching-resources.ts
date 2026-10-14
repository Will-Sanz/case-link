import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchableResource } from "@/lib/matching/types";

/** Keyset pages avoid the API row limit and keep evaluation counts honest. */
export async function loadMatchingResources(client: SupabaseClient): Promise<MatchableResource[]> {
  const resources: MatchableResource[] = [];
  let after: string | undefined;
  for (;;) {
    let query = client.from("resources").select("id,program_name,office_or_department,description,category,search_text,tags,recruit_for_grocery_giveaways,tabling_at_events,promotional_materials,educational_workshops,volunteer_recruitment_support")
      .eq("active", true).eq("is_demo", false).order("id").limit(200);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error("The resource directory could not be loaded. Try again.");
    if (!Array.isArray(data)) throw new Error("The resource directory returned incomplete data. Try again.");
    resources.push(...data as MatchableResource[]);
    if (resources.length > 10_000) throw new Error("This directory exceeds the matching limit. Ask the resource owner to narrow the active directory.");
    if (data.length < 200) return resources;
    const lastId = data[data.length - 1].id;
    if (typeof lastId !== "string" || (after && lastId <= after)) throw new Error("The resource directory could not be paged safely. Try again.");
    after = lastId;
  }
}
