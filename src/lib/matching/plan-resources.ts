import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanStepDetails, ResourceMatchRow } from "@/types/family";
import { isResourceAvailable } from "./resource-availability";

export const resourceCatalogEntrySchema = z.strictObject({
  id: z.string().uuid(), updated_at: z.string().datetime({ offset: true }),
  program_name: z.string().min(1).max(500), office: z.string().max(500), category: z.string().max(500).nullable(),
  match_reason: z.string().max(2000), phone: z.string().max(200).nullable(), email: z.string().max(320).nullable(),
});
export type ResourceCatalogEntry = z.infer<typeof resourceCatalogEntrySchema>;
export type PlanContact = NonNullable<PlanStepDetails["contacts"]>[number];
export const RESOURCE_CONTACT_NOTICE = "Confirm current availability, eligibility, and contact details before referring.";

export function matchesForPlanContext(matches: ResourceMatchRow[], max: number): ResourceMatchRow[] {
  return matches.filter(match => match.status !== "dismissed" && isResourceAvailable(match.resource))
    .sort((a,b) => Number(b.status === "accepted") - Number(a.status === "accepted") || b.score - a.score || a.id.localeCompare(b.id))
    .slice(0,max);
}

export function planResourceCatalog(matches: ResourceMatchRow[], max = 12): ResourceCatalogEntry[] {
  return matchesForPlanContext(matches,max).map(match => {
    const resource = match.resource!;
    return resourceCatalogEntrySchema.parse({ id: resource.id, updated_at: resource.updated_at,
      program_name: resource.program_name.trim(), office: resource.office_or_department, category: resource.category,
      match_reason: match.match_reason, phone: resource.primary_contact_phone?.trim() || null, email: resource.primary_contact_email?.trim() || null,
    });
  });
}

/** Models choose IDs. Contact facts are copied only from the authorized catalog. */
export function contactsForResourceIds(ids: string[], catalog: ResourceCatalogEntry[]): PlanContact[] {
  if (new Set(ids).size !== ids.length) throw new Error("The AI repeated a directory reference. Nothing was applied.");
  return ids.map(id => {
    const resource = catalog.find(row => row.id === id);
    if (!resource) throw new Error("The resource reference is unavailable. Refresh the directory and try again.");
    return { source_resource_id: resource.id, source_updated_at: resource.updated_at, name: resource.program_name,
      ...(resource.phone ? { phone: resource.phone } : {}), ...(resource.email ? { email: resource.email } : {}), notes: RESOURCE_CONTACT_NOTICE };
  });
}

/** Contact values are intentionally kept out of prompts and browser recovery copies. */
export function contactReferences(contacts: PlanContact[] | undefined): PlanContact[] {
  return (contacts ?? []).flatMap(contact => contact.source_resource_id && contact.source_updated_at
    ? [{ source_resource_id: contact.source_resource_id, source_updated_at: contact.source_updated_at }] : []);
}

export function formatResourceCatalog(catalog: ResourceCatalogEntry[], omitted = 0): string {
  return `MATCHED_RESOURCES (directory references; verify current contacts, eligibility, and availability before use; ${omitted} additional matches omitted; contact details are not included):\n${JSON.stringify(catalog.map(({ id, program_name, office, category, match_reason }) => ({ id, program_name, office, category, match_reason })))}`;
}

export async function assertResourceCatalogCurrent(client: SupabaseClient, familyId: string, catalog: ResourceCatalogEntry[]): Promise<void> {
  if (!catalog.length) return;
  const { data, error } = await client.from("resource_matches")
    .select("resource_id,status,resource:resources(id,updated_at,active,is_demo)")
    .eq("family_id", familyId).in("resource_id", catalog.map(row => row.id));
  if (error || !Array.isArray(data)) throw new Error("The resource directory could not be verified. Try again before using the draft.");
  for (const source of catalog) {
    const match = data.find(row => row.resource_id === source.id && row.status !== "dismissed");
    const resource = Array.isArray(match?.resource) ? match.resource[0] : match?.resource;
    if (!resource || !isResourceAvailable(resource) || resource.updated_at !== source.updated_at) {
      throw new Error("A referenced resource changed or became unavailable. Refresh the directory and generate a new preview or draft.");
    }
  }
}
