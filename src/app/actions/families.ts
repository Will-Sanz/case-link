"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser, requireAppUserWithClient } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";
import {
  addCaseNoteSchema,
  familyIntakeFormSchema,
  normalizeIntakeForDb,
  updateBarriersSchema,
  updateFamilySchema,
  updateGoalsSchema,
  updateMembersSchema,
  type FamilyIntakeFormValues,
} from "@/lib/validations/family-intake";

export type ActionResult =
  | { ok: true; familyId?: string }
  | { ok: false; error: string };

export async function createFamilyIntake(
  input: FamilyIntakeFormValues,
): Promise<ActionResult> {
  const parsed = familyIntakeFormSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return { ok: false, error: msg || "Invalid form data" };
  }

  let user;
  let supabase;
  try {
    ({ user, supabase } = await requireAppUserWithClient());
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized") {
      return { ok: false, error: "Unauthorized" };
    }
    throw e;
  }

  const v = normalizeIntakeForDb(parsed.data);

  // Ownership is set in the DB from auth.uid() (RPC is SECURITY DEFINER, bypasses RLS on
  // families INSERT while still binding created_by_id to the JWT — avoids client/PostgREST
  // WITH CHECK mismatches).
  const { data: familyIdRaw, error: famErr } = await supabase.rpc(
    "create_family_intake_row",
    {
      p_name: v.name,
      p_summary: v.summary,
      p_urgency: v.urgency,
      p_household_notes: v.householdNotes,
      p_status: "active",
    },
  );

  if (famErr || familyIdRaw == null) {
    return { ok: false, error: famErr?.message ?? "Could not create family" };
  }

  const familyId = familyIdRaw as string;

  const rollback = async () => {
    await supabase.from("families").delete().eq("id", familyId);
  };

  try {
    if (v.goals.length > 0) {
      const { error } = await supabase.from("family_goals").insert(
        v.goals.map((g, i) => ({
          family_id: familyId,
          preset_key: g.presetKey,
          label: g.label,
          sort_order: i,
        })),
      );
      if (error) throw new Error(error.message);
    }

    if (v.barriers.length > 0) {
      const { error } = await supabase.from("family_barriers").insert(
        v.barriers.map((b, i) => ({
          family_id: familyId,
          preset_key: b.presetKey,
          label: b.label,
          sort_order: i,
        })),
      );
      if (error) throw new Error(error.message);
    }

    if (v.members.length > 0) {
      const { error } = await supabase.from("family_members").insert(
        v.members.map((m) => ({
          family_id: familyId,
          display_name: m.displayName,
          relationship: m.relationship,
          notes: m.notes,
          age_approx: m.ageApprox,
        })),
      );
      if (error) throw new Error(error.message);
    }

    if (v.initialCaseNote) {
      const { error } = await supabase.from("case_notes").insert({
        family_id: familyId,
        author_id: user.id,
        body: v.initialCaseNote,
      });
      if (error) throw new Error(error.message);
    }

    const { error: logErr } = await supabase.from("activity_log").insert({
      family_id: familyId,
      actor_user_id: user.id,
      action: "family.created",
      entity_type: "family",
      entity_id: familyId,
      details: { name: v.name },
    });
    if (logErr) throw new Error(logErr.message);
  } catch (e) {
    await rollback();
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Save failed",
    };
  }

  revalidatePath("/families");
  revalidatePath("/dashboard");
  revalidatePath(`/families/${familyId}`);
  return { ok: true, familyId };
}

export async function addCaseNote(input: unknown): Promise<ActionResult> {
  const user = await requireAppUser();
  const parsed = addCaseNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid note" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: note, error } = await supabase
    .from("case_notes")
    .insert({
      family_id: parsed.data.familyId,
      author_id: user.id,
      body: parsed.data.body.trim(),
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  await supabase.from("activity_log").insert({
    family_id: parsed.data.familyId,
    actor_user_id: user.id,
    action: "note.added",
    entity_type: "case_note",
    entity_id: note?.id ?? null,
  });

  revalidatePath(`/families/${parsed.data.familyId}`);
  return { ok: true };
}

export async function updateFamilyMeta(input: unknown): Promise<ActionResult> {
  const user = await requireAppUser();
  const parsed = updateFamilySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid update" };
  }

  const { familyId, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (rest.summary !== undefined) {
    patch.summary = rest.summary?.trim() || null;
  }
  if (rest.householdNotes !== undefined) {
    patch.household_notes = rest.householdNotes?.trim() || null;
  }
  if (rest.urgency !== undefined) {
    patch.urgency = rest.urgency;
  }
  if (rest.status !== undefined) {
    patch.status = rest.status;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("families")
    .update(patch)
    .eq("id", familyId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await supabase.from("activity_log").insert({
    family_id: familyId,
    actor_user_id: user.id,
    action: "context.updated",
    entity_type: "family",
    entity_id: familyId,
    details: patch,
  });

  revalidatePath("/families");
  revalidatePath(`/families/${familyId}`);
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteFamily(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ familyId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid family ID" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("families")
    .delete()
    .eq("id", parsed.data.familyId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/families");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function updateFamilyGoals(input: unknown): Promise<ActionResult> {
  await requireAppUser();
  const parsed = updateGoalsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid goals data" };
  }
  const { familyId, goals } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const existing = await supabase.from("family_goals").select("id").eq("family_id", familyId);
  const existingIds = new Set((existing.data ?? []).map((r) => r.id));
  const incomingIds = new Set(goals.map((g) => g.id).filter(Boolean) as string[]);

  for (const g of goals) {
    if (g.id && existingIds.has(g.id)) {
      const { error } = await supabase
        .from("family_goals")
        .update({ label: g.label, sort_order: goals.indexOf(g) })
        .eq("id", g.id);
      if (error) return { ok: false, error: error.message };
    } else if (!g.id) {
      const { error } = await supabase.from("family_goals").insert({
        family_id: familyId,
        label: g.label,
        sort_order: goals.indexOf(g),
      });
      if (error) return { ok: false, error: error.message };
    }
  }
  for (const id of existingIds) {
    if (!incomingIds.has(id)) {
      const { error } = await supabase.from("family_goals").delete().eq("id", id);
      if (error) return { ok: false, error: error.message };
    }
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updateFamilyBarriers(input: unknown): Promise<ActionResult> {
  await requireAppUser();
  const parsed = updateBarriersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid barriers data" };
  }
  const { familyId, barriers } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const existing = await supabase.from("family_barriers").select("id").eq("family_id", familyId);
  const existingIds = new Set((existing.data ?? []).map((r) => r.id));
  const incomingIds = new Set(barriers.map((b) => b.id).filter(Boolean) as string[]);

  for (const b of barriers) {
    if (b.id && existingIds.has(b.id)) {
      const { error } = await supabase
        .from("family_barriers")
        .update({ label: b.label, sort_order: barriers.indexOf(b) })
        .eq("id", b.id);
      if (error) return { ok: false, error: error.message };
    } else if (!b.id) {
      const { error } = await supabase.from("family_barriers").insert({
        family_id: familyId,
        label: b.label,
        sort_order: barriers.indexOf(b),
      });
      if (error) return { ok: false, error: error.message };
    }
  }
  for (const id of existingIds) {
    if (!incomingIds.has(id)) {
      const { error } = await supabase.from("family_barriers").delete().eq("id", id);
      if (error) return { ok: false, error: error.message };
    }
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updateFamilyMembers(input: unknown): Promise<ActionResult> {
  await requireAppUser();
  const parsed = updateMembersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { familyId, members } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const existing = await supabase.from("family_members").select("id").eq("family_id", familyId);
  const existingIds = new Set((existing.data ?? []).map((r) => r.id));
  const incomingIds = new Set(members.map((m) => m.id).filter(Boolean) as string[]);

  for (const m of members) {
    const row = {
      display_name: m.display_name,
      relationship: m.relationship ?? null,
      notes: m.notes ?? null,
      age_approx: m.age_approx ?? null,
    };
    if (m.id && existingIds.has(m.id)) {
      const { error } = await supabase.from("family_members").update(row).eq("id", m.id);
      if (error) return { ok: false, error: error.message };
    } else if (!m.id) {
      const { error } = await supabase
        .from("family_members")
        .insert({ family_id: familyId, ...row });
      if (error) return { ok: false, error: error.message };
    }
  }
  for (const id of existingIds) {
    if (!incomingIds.has(id)) {
      const { error } = await supabase.from("family_members").delete().eq("id", id);
      if (error) return { ok: false, error: error.message };
    }
  }

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}
