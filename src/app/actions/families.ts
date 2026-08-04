"use server";

import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { publicSessionError } from "@/lib/auth/session-errors";
import { z } from "zod";
import { publicMessageFromSupabaseError } from "@/lib/errors/public-action-error";
import { validateNoPii, type PrivacyFieldInput } from "@/lib/privacy/no-pii";
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

const workflowEventSchema = z.object({
  familyId: z.string().uuid(),
  planId: z.string().uuid(),
  event: z.enum(["plan_viewed", "first_action_visible", "paperwork_viewed"]),
});

/** Privacy-safe product telemetry. No family label, narrative, plan prose, or form value is accepted. */
export async function recordCaseWorkflowEvent(input: unknown): Promise<ActionResult> {
  const parsed = workflowEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid workflow event" };

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("id, version")
    .eq("id", parsed.data.planId)
    .eq("family_id", parsed.data.familyId)
    .maybeSingle();
  if (!plan) return { ok: false, error: "Family workflow not found" };

  const action =
    parsed.data.event === "first_action_visible"
      ? "plan.first_action_visible"
      : "family.workflow_step_viewed";
  const workflowStep = parsed.data.event === "paperwork_viewed" ? "paperwork" : "plan";
  const { error } = await supabase.rpc("record_activity_event", {
    p_family_id: parsed.data.familyId,
    p_action: action,
    p_entity_type: "plan",
    p_entity_id: plan.id,
    p_details: {
      plan_version: plan.version,
      ...(action === "family.workflow_step_viewed" ? { workflow_step: workflowStep } : {}),
    },
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
  return { ok: true };
}

function privacyError(fields: PrivacyFieldInput[]): ActionResult | null {
  const result = validateNoPii(fields);
  return result.ok ? null : { ok: false, error: result.error ?? "Remove identifying text." };
}

export async function createFamilyIntake(
  input: FamilyIntakeFormValues,
): Promise<ActionResult> {
  const parsed = familyIntakeFormSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return { ok: false, error: msg || "Invalid form data" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const v = normalizeIntakeForDb(parsed.data);
  const privacyFailure = privacyError([
    { field: "name", label: "Family label", value: v.name, mode: "label" },
    { field: "summary", label: "Short description", value: v.summary },
    { field: "householdNotes", label: "Current circumstances", value: v.householdNotes },
    { field: "initialCaseNote", label: "Initial note", value: v.initialCaseNote },
    ...v.goals.map((goal, index) => ({
      field: `goals.${index}.label`,
      label: "Goal",
      value: goal.label,
    })),
    ...v.barriers.map((barrier, index) => ({
      field: `barriers.${index}.label`,
      label: "Barrier",
      value: barrier.label,
    })),
    ...v.members.flatMap((member, index) => [
      {
        field: `members.${index}.displayName`,
        label: "Household member label",
        value: member.displayName,
        mode: "label" as const,
      },
      {
        field: `members.${index}.notes`,
        label: "Household member notes",
        value: member.notes,
      },
    ]),
  ]);
  if (privacyFailure) return privacyFailure;

  const { data: familyIdRaw, error } = await supabase.rpc("create_family_intake", {
    p_name: v.name,
    p_summary: v.summary,
    p_urgency: v.urgency,
    p_household_notes: v.householdNotes,
    p_goals: v.goals,
    p_barriers: v.barriers,
    p_members: v.members,
    p_initial_case_note: v.initialCaseNote,
  });
  if (error || familyIdRaw == null) {
    return {
      ok: false,
      error: publicMessageFromSupabaseError(error, "Could not create family"),
    };
  }
  const familyId = familyIdRaw as string;

  revalidatePath("/families");
  revalidatePath(`/families/${familyId}`);
  return { ok: true, familyId };
}

export async function addCaseNote(input: unknown): Promise<ActionResult> {
  const parsed = addCaseNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid note" };
  }
  const privacyFailure = privacyError([
    { field: "body", label: "Case note", value: parsed.data.body },
  ]);
  if (privacyFailure) return privacyFailure;

  const { supabase } = await requireAppUserWithClient();
  const { error } = await supabase.rpc("add_case_note", {
    p_family_id: parsed.data.familyId,
    p_body: parsed.data.body.trim(),
  });

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  revalidatePath(`/families/${parsed.data.familyId}`);
  return { ok: true };
}

export async function updateFamilyMeta(input: unknown): Promise<ActionResult> {
  const parsed = updateFamilySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid update" };
  }
  const privacyFailure = privacyError([
    { field: "summary", label: "Summary", value: parsed.data.summary },
    {
      field: "householdNotes",
      label: "Current circumstances",
      value: parsed.data.householdNotes,
    },
  ]);
  if (privacyFailure) return privacyFailure;

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

  const { supabase } = await requireAppUserWithClient();
  const { data: updated, error } = await supabase.rpc("update_family_meta", {
    p_family_id: familyId,
    p_patch: patch,
  });

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }

  if (!updated) return { ok: false, error: "Family not found" };

  revalidatePath("/families");
  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

/** Archives the shared family record. Only its owner or an administrator may do this. */
export async function archiveFamilyFromWorkspace(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ familyId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid family ID" };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch (error) {
    return { ok: false, error: publicSessionError(error) };
  }

  const { data: archived, error } = await supabase.rpc("archive_family", {
    p_family_id: parsed.data.familyId,
  });

  if (error) {
    return { ok: false, error: publicMessageFromSupabaseError(error) };
  }
  if (!archived) return { ok: false, error: "Only the family owner can archive this record." };

  revalidatePath("/families");
  revalidatePath(`/families/${parsed.data.familyId}`);
  return { ok: true };
}

export async function updateFamilyGoals(input: unknown): Promise<ActionResult> {
  const parsed = updateGoalsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid goals data" };
  }
  const { familyId, goals } = parsed.data;
  const privacyFailure = privacyError(
    goals.map((goal, index) => ({
      field: `goals.${index}.label`,
      label: "Goal",
      value: goal.label,
    })),
  );
  if (privacyFailure) return privacyFailure;
  const { supabase } = await requireAppUserWithClient();
  const { error } = await supabase.rpc("replace_family_goals", {
    p_family_id: familyId,
    p_rows: goals,
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updateFamilyBarriers(input: unknown): Promise<ActionResult> {
  const parsed = updateBarriersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid barriers data" };
  }
  const { familyId, barriers } = parsed.data;
  const privacyFailure = privacyError(
    barriers.map((barrier, index) => ({
      field: `barriers.${index}.label`,
      label: "Barrier",
      value: barrier.label,
    })),
  );
  if (privacyFailure) return privacyFailure;
  const { supabase } = await requireAppUserWithClient();
  const { error } = await supabase.rpc("replace_family_barriers", {
    p_family_id: familyId,
    p_barriers: barriers.map((barrier, sortOrder) => ({
      id: barrier.id,
      label: barrier.label,
      sort_order: sortOrder,
    })),
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}

export async function updateFamilyMembers(input: unknown): Promise<ActionResult> {
  const parsed = updateMembersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { familyId, members } = parsed.data;
  const privacyFailure = privacyError(
    members.flatMap((member, index) => [
      {
        field: `members.${index}.display_name`,
        label: "Household member label",
        value: member.display_name,
        mode: "label" as const,
      },
      {
        field: `members.${index}.notes`,
        label: "Household member notes",
        value: member.notes,
      },
    ]),
  );
  if (privacyFailure) return privacyFailure;
  const { supabase } = await requireAppUserWithClient();
  const { error } = await supabase.rpc("replace_family_members", {
    p_family_id: familyId,
    p_rows: members,
  });
  if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };

  revalidatePath(`/families/${familyId}`);
  return { ok: true };
}
