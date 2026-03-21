"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { rankResourcesForFamily } from "@/lib/matching/engine";
import type { FamilyMatchInput, MatchableResource } from "@/lib/matching/types";
import { getFamilyDetail } from "@/lib/services/families";
import { searchResourcesForPicker } from "@/lib/services/resources-picker";
import {
  addManualMatchSchema,
  runMatchingSchema,
  searchResourcesSchema,
  updateMatchStatusSchema,
} from "@/lib/validations/resource-matches";
import type { ResourcePickerRow } from "@/lib/services/resources-picker";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function logActivity(
  supabase: SupabaseClient,
  familyId: string,
  userId: string,
  action: string,
  details?: Record<string, unknown>,
) {
  const { error } = await supabase.from("activity_log").insert({
    family_id: familyId,
    actor_user_id: userId,
    action,
    entity_type: "resource_match",
    details: details ?? null,
  });
  void error;
}

export async function runResourceMatching(input: unknown): Promise<ActionResult> {
  const parsed = runMatchingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let user;
  let supabase;
  try {
    ({ user, supabase } = await requireAppUserWithClient());
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { familyId } = parsed.data;

  const detail = await getFamilyDetail(supabase, familyId);
  if (!detail) {
    return { ok: false, error: "Family not found" };
  }

  const matchInput: FamilyMatchInput = {
    goals: detail.goals.map((g) => ({
      preset_key: g.preset_key,
      label: g.label,
    })),
    barriers: detail.barriers.map((b) => ({
      preset_key: b.preset_key,
      label: b.label,
    })),
    summary: detail.summary,
    household_notes: detail.household_notes,
  };

  const { data: resourceRows, error: resErr } = await supabase
    .from("resources")
    .select(
      `
      id,
      program_name,
      office_or_department,
      description,
      category,
      search_text,
      tags,
      recruit_for_grocery_giveaways,
      tabling_at_events,
      promotional_materials,
      educational_workshops,
      volunteer_recruitment_support
    `,
    )
    .eq("active", true);

  if (resErr) {
    return { ok: false, error: resErr.message };
  }

  const resources = (resourceRows ?? []) as MatchableResource[];
  const ranked = rankResourcesForFamily(matchInput, resources);

  const { data: existing, error: exErr } = await supabase
    .from("resource_matches")
    .select("resource_id, status")
    .eq("family_id", familyId);

  if (exErr) {
    return { ok: false, error: exErr.message };
  }

  const dismissed = new Set<string>();
  const accepted = new Set<string>();
  for (const row of existing ?? []) {
    if (row.status === "dismissed") dismissed.add(row.resource_id as string);
    if (row.status === "accepted") accepted.add(row.resource_id as string);
  }

  const { error: delErr } = await supabase
    .from("resource_matches")
    .delete()
    .eq("family_id", familyId)
    .eq("status", "suggested");

  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  const toInsert = ranked.filter(
    (m) => !dismissed.has(m.resourceId) && !accepted.has(m.resourceId),
  );

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("resource_matches").insert(
      toInsert.map((m) => ({
        family_id: familyId,
        resource_id: m.resourceId,
        match_reason: m.matchReason,
        score: m.score,
        status: "suggested",
      })),
    );
    if (insErr) {
      return { ok: false, error: insErr.message };
    }
  }

  await logActivity(supabase, familyId, user.id, "matching.run", {
    suggestions: toInsert.length,
    evaluated: resources.length,
  });

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updateResourceMatchStatus(
  input: unknown,
): Promise<ActionResult> {
  const parsed = updateMatchStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let user;
  let supabase;
  try {
    ({ user, supabase } = await requireAppUserWithClient());
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { matchId, familyId, status } = parsed.data;

  const { error } = await supabase
    .from("resource_matches")
    .update({ status })
    .eq("id", matchId)
    .eq("family_id", familyId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, familyId, user.id, `matching.${status}`, { matchId });
  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function addManualResourceMatch(input: unknown): Promise<ActionResult> {
  const parsed = addManualMatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let user;
  let supabase;
  try {
    ({ user, supabase } = await requireAppUserWithClient());
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const { familyId, resourceId } = parsed.data;

  const { error } = await supabase.from("resource_matches").upsert(
    {
      family_id: familyId,
      resource_id: resourceId,
      match_reason: "Manually added by case manager",
      score: 100,
      status: "accepted",
    },
    { onConflict: "family_id,resource_id" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, familyId, user.id, "matching.manual_add", { resourceId });
  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function searchResourcesAction(
  input: unknown,
): Promise<{ ok: true; items: ResourcePickerRow[] } | { ok: false; error: string }> {
  const parsed = searchResourcesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid search" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  try {
    const items = await searchResourcesForPicker(supabase, parsed.data.q);
    return { ok: true, items };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Search failed",
    };
  }
}
