"use server";

import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { publicSessionError } from "@/lib/auth/session-errors";
import { rankResourcesForFamily } from "@/lib/matching/engine";
import type { FamilyMatchInput, MatchableResource } from "@/lib/matching/types";
import { publicMessageFromCaughtError, publicMessageFromSupabaseError } from "@/lib/errors/public-action-error";
import { getFamilyDetail } from "@/lib/services/families";
import { searchResourcesForPicker } from "@/lib/services/resources-picker";
import { linkResourceToStepSchema } from "@/lib/validations/plans";
import {
  addManualMatchSchema,
  runMatchingSchema,
  searchResourcesSchema,
  updateMatchStatusSchema,
} from "@/lib/validations/resource-matches";
import type { ResourcePickerRow } from "@/lib/services/resources-picker";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function runResourceMatching(input: unknown): Promise<ActionResult> {
  const parsed = runMatchingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
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
    return { ok: false, error: publicMessageFromSupabaseError(resErr) };
  }

  const resources = (resourceRows ?? []) as MatchableResource[];
  const ranked = rankResourcesForFamily(matchInput, resources);

  const { error: replaceError } = await supabase.rpc("replace_suggested_resource_matches", {
    p_family_id: familyId,
    p_matches: ranked.map((match) => ({
      resource_id: match.resourceId,
      match_reason: match.matchReason,
      score: match.score,
    })),
    p_evaluated: resources.length,
  });
  if (replaceError) {
    return { ok: false, error: publicMessageFromSupabaseError(replaceError) };
  }

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

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { matchId, familyId, status } = parsed.data;

  const { data: updated, error } = await supabase.rpc("update_resource_match", {
    p_family_id: familyId,
    p_match_id: matchId,
    p_operation: "status",
    p_status: status,
    p_plan_step_id: null,
  });

  if (error || updated !== true) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function addManualResourceMatch(input: unknown): Promise<ActionResult> {
  const parsed = addManualMatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { familyId, resourceId } = parsed.data;

  const { data: matchId, error } = await supabase.rpc("add_manual_resource_match", {
    p_family_id: familyId,
    p_resource_id: resourceId,
  });

  if (error || typeof matchId !== "string") {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function linkResourceToStep(input: unknown): Promise<ActionResult> {
  const parsed = linkResourceToStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { matchId, familyId, stepId } = parsed.data;

  const { data: step } = await supabase
    .from("plan_steps")
    .select("plan_id")
    .eq("id", stepId)
    .maybeSingle();
  if (!step) return { ok: false, error: "Step not found" };
  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("id", step.plan_id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (!plan) return { ok: false, error: "Step not found" };

  const { data: updated, error } = await supabase.rpc("update_resource_match", {
    p_family_id: familyId,
    p_match_id: matchId,
    p_operation: "link",
    p_status: null,
    p_plan_step_id: stepId,
  });

  if (error || updated !== true) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function unlinkResourceFromStep(input: unknown): Promise<ActionResult> {
  const parsed = linkResourceToStepSchema.pick({ matchId: true, familyId: true }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { matchId, familyId } = parsed.data;

  const { data: updated, error } = await supabase.rpc("update_resource_match", {
    p_family_id: familyId,
    p_match_id: matchId,
    p_operation: "unlink",
    p_status: null,
    p_plan_step_id: null,
  });

  if (error || updated !== true) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
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
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }
  try {
    const items = await searchResourcesForPicker(supabase, parsed.data.q);
    return { ok: true, items };
  } catch (e) {
    return {
      ok: false,
      error: publicMessageFromCaughtError("searchResourcesAction", e, "Search failed."),
    };
  }
}
