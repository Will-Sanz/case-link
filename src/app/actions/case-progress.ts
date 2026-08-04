"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { logServerError } from "@/lib/logger/server-error";
import { validateNoPii, type PrivacyFieldInput } from "@/lib/privacy/no-pii";

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()));

const progressChangeSchema = z.object({
  actionItemId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  targetDate: dateOnlySchema.nullable(),
  followUpDate: dateOnlySchema.nullable(),
  notes: z.string().max(4000).nullable(),
  outcome: z.string().max(4000).nullable(),
});

const captureProgressSchema = z.object({
  familyId: z.string().uuid(),
  planId: z.string().uuid(),
  occurredOn: dateOnlySchema,
  summary: z.string().trim().min(1).max(12000),
  changes: z.array(progressChangeSchema).max(25),
});

export type CaptureProgressUpdateInput = z.infer<typeof captureProgressSchema>;
export type CaptureProgressUpdateResult =
  | { ok: true; updateId: string }
  | { ok: false; error: string; conflict?: boolean };

function publicProgressError(message: string | undefined): CaptureProgressUpdateResult {
  const normalized = message?.toLowerCase() ?? "";
  if (normalized.includes("changed in another tab")) {
    return {
      ok: false,
      conflict: true,
      error:
        "One of these actions changed in another tab. Your meeting note was not saved. Refresh, review the latest plan, and save again.",
    };
  }
  if (normalized.includes("future")) {
    return { ok: false, error: "Meeting date cannot be in the future." };
  }
  if (normalized.includes("target date")) {
    return { ok: false, error: "Choose a target date for each open action." };
  }
  if (normalized.includes("reason and follow-up")) {
    return { ok: false, error: "Waiting actions need a short reason and a follow-up date." };
  }
  if (
    normalized.includes("access denied") ||
    normalized.includes("permission denied") ||
    normalized.includes("row-level security")
  ) {
    return { ok: false, error: "You do not have permission to update this family." };
  }
  return { ok: false, error: "The progress update could not be saved. Nothing was changed; try again." };
}

export async function captureCaseProgressUpdate(
  input: unknown,
): Promise<CaptureProgressUpdateResult> {
  const parsed = captureProgressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the meeting note and selected action updates." };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (parsed.data.occurredOn > today) {
    return { ok: false, error: "Meeting date cannot be in the future." };
  }
  for (const change of parsed.data.changes) {
    if (["pending", "in_progress"].includes(change.status) && !change.targetDate) {
      return { ok: false, error: "Choose a target date for each open action." };
    }
    if (change.status === "blocked" && (!change.followUpDate || !change.notes?.trim())) {
      return { ok: false, error: "Waiting actions need a short reason and a follow-up date." };
    }
  }

  const privacyFields: PrivacyFieldInput[] = [
    { field: "summary", label: "Progress note", value: parsed.data.summary },
    ...parsed.data.changes.flatMap((change, index) => [
      {
        field: `changes.${index}.notes`,
        label: "Action progress note",
        value: change.notes,
      },
      {
        field: `changes.${index}.outcome`,
        label: "Action outcome",
        value: change.outcome,
      },
    ]),
  ];
  const privacy = validateNoPii(privacyFields);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before saving." };
  }

  let supabase;
  try {
    ({ supabase } = await requireAppUserWithClient());
  } catch {
    return { ok: false, error: "Your session expired. Sign in again and retry." };
  }

  const { data, error } = await supabase.rpc("capture_case_progress_update", {
    p_family_id: parsed.data.familyId,
    p_plan_id: parsed.data.planId,
    p_occurred_on: parsed.data.occurredOn,
    p_summary: parsed.data.summary,
    p_changes: parsed.data.changes.map((change) => ({
      action_item_id: change.actionItemId,
      expected_updated_at: change.expectedUpdatedAt,
      status: change.status,
      target_date: change.targetDate,
      follow_up_date: change.followUpDate,
      notes: change.notes?.trim() || null,
      outcome: change.outcome?.trim() || null,
    })),
  });

  if (error || typeof data !== "string") {
    logServerError("captureCaseProgressUpdate", error ?? new Error("Missing update id"));
    return publicProgressError(error?.message);
  }

  revalidatePath(`/families/${parsed.data.familyId}`);
  revalidatePath(`/families/${parsed.data.familyId}/plan`);
  revalidatePath(`/families/${parsed.data.familyId}/profile`);
  revalidatePath(`/families/${parsed.data.familyId}/paperwork`);
  revalidatePath("/families");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  return { ok: true, updateId: data };
}
