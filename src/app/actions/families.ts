"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser, requireAppUserWithClient } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addCaseNoteSchema,
  familyIntakeFormSchema,
  normalizeIntakeForDb,
  updateFamilySchema,
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
    if (process.env.NODE_ENV === "development") {
      console.info("[createFamilyIntake] rpc error:", {
        message: famErr?.message,
        code: famErr?.code,
        details: famErr?.details,
        hint: famErr?.hint,
      });
    }
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
  return { ok: true };
}
