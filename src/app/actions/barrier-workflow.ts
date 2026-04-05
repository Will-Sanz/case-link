"use server";

import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { runResourceMatching } from "@/app/actions/resource-matches";
import { startStagedLeanPlanGeneration, updatePlanStepActionItem } from "@/app/actions/plans";
import { getFamilyDetail } from "@/lib/services/families";
import {
  maxRawMatchScore,
  rawMatchScoreToPercent,
} from "@/lib/matching/normalize-display-score";
import {
  publicMessageFromCaughtError,
  publicMessageFromSupabaseError,
} from "@/lib/errors/public-action-error";
import {
  type BarrierPresetLabel,
  type BarrierWorkflowInput,
  type BarrierWorkflowPlanSection,
  type BarrierWorkflowRecentRecord,
  type BarrierWorkflowResource,
  type BarrierWorkflowResult,
} from "@/types/barrier-workflow";

const BARRIER_KEY_BY_LABEL: Record<BarrierPresetLabel, string> = {
  Housing: "housing_instability",
  Employment: "unemployment",
  "Food access": "food_insecurity",
  Transportation: "no_transportation",
  Childcare: "childcare_barrier",
  "Mental health": "health_barrier",
  "Physical health": "health_barrier",
  "Substance use": "health_barrier",
  "Legal issues": "legal_matter",
  "Benefits / ID documents": "immigration_documentation",
  Education: "education_workforce_training",
  "Domestic violence": "legal_matter",
  "Financial hardship": "utility_debt",
};

function toClientError(error: unknown): string {
  return publicMessageFromCaughtError("barrier-workflow", error);
}

function formatDateRange(start: Date, daysFrom: number, daysTo: number): string {
  const s = new Date(start);
  s.setDate(s.getDate() + daysFrom);
  const e = new Date(start);
  e.setDate(e.getDate() + daysTo);
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", fmt)} - ${e.toLocaleDateString("en-US", fmt)}`;
}

function parseAdditionalBarriers(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/\r?\n|,|;/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function mapFamilyToWorkflowResult(
  referenceId: string,
  familyId: string,
  selectedBarriers: string[],
  additionalBarriers: string,
  additionalDetails: string,
  lastSavedAt: string | null,
  detail: NonNullable<Awaited<ReturnType<typeof getFamilyDetail>>>,
): BarrierWorkflowResult {
  const createdAt = detail.plan?.created_at ? new Date(detail.plan.created_at) : new Date();
  const phaseSummaries = detail.plan?.client_display?.phaseSummaries;
  const sections: BarrierWorkflowPlanSection[] = [
    {
      phase: "30",
      dueRangeLabel: formatDateRange(createdAt, 0, 29),
      summary:
        phaseSummaries?.["30"] ??
        "Immediate stabilization and first outreach actions.",
      steps: [],
    },
    {
      phase: "60",
      dueRangeLabel: formatDateRange(createdAt, 30, 59),
      summary:
        phaseSummaries?.["60"] ??
        "Follow-through on submissions, appointments, and follow-ups.",
      steps: [],
    },
    {
      phase: "90",
      dueRangeLabel: formatDateRange(createdAt, 60, 89),
      summary:
        phaseSummaries?.["90"] ??
        "Sustain progress, handle renewals, and close remaining blockers.",
      steps: [],
    },
  ];

  const byPhase = new Map(sections.map((s) => [s.phase, s]));
  for (const step of detail.plan?.steps ?? []) {
    const section = byPhase.get(step.phase);
    if (!section) continue;
    const checklist = (step.details?.checklist ?? []).filter(Boolean);
    section.steps.push({
      id: step.id,
      title: step.title,
      description: step.description,
      checklist,
      actionItems: (step.action_items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.status,
      })),
    });
  }

  const resourceMatchRows = detail.resourceMatches
    .filter((m) => m.status !== "dismissed" && m.resource)
    .sort((a, b) => {
      const pri = (x: "accepted" | "suggested" | "dismissed") =>
        x === "accepted" ? 0 : x === "suggested" ? 1 : 2;
      const p = pri(a.status) - pri(b.status);
      if (p !== 0) return p;
      return b.score - a.score;
    })
    .slice(0, 12);
  const maxMatchScore = maxRawMatchScore(resourceMatchRows.map((m) => m.score));
  const resources: BarrierWorkflowResource[] = resourceMatchRows.map((m) => ({
      id: m.id,
      name: m.resource!.program_name,
      programName: m.resource!.office_or_department || m.resource!.program_name,
      similarityScore: rawMatchScoreToPercent(m.score, maxMatchScore),
      description: m.resource!.office_or_department || m.resource!.category,
      category: m.resource!.category,
      contactName: m.resource!.primary_contact_name,
      contactTitle: m.resource!.primary_contact_title,
      primaryEmail: m.resource!.primary_contact_email,
      primaryPhone: m.resource!.primary_contact_phone,
      secondaryEmail: m.resource!.secondary_contact_email,
      secondaryPhone: m.resource!.secondary_contact_phone,
      website: null,
      address: null,
      whyMatched: m.match_reason,
    }));

  return {
    referenceId,
    familyId,
    selectedBarriers,
    additionalBarriers,
    additionalDetails,
    sections,
    resources,
    lastSavedAt,
    planDisplayTitle: detail.plan?.client_display?.title?.trim() || null,
  };
}

async function upsertBarrierPlanRecord(
  userId: string,
  referenceId: string,
  familyId: string,
  selectedBarriers: string[],
  additionalDetails: string,
  sections: BarrierWorkflowPlanSection[],
  resources: BarrierWorkflowResource[],
  supabase: Awaited<ReturnType<typeof requireAppUserWithClient>>["supabase"],
): Promise<string | null> {
  const now = new Date().toISOString();
  const payload = {
    owner_user_id: userId,
    reference_id: referenceId,
    family_id: familyId,
    selected_barriers: selectedBarriers,
    additional_details: additionalDetails || null,
    generated_plan_json: sections,
    matched_resources_json: resources,
    status: "active",
    updated_at: now,
  };
  const { data, error } = await supabase
    .from("barrier_plan_records")
    .upsert(payload, { onConflict: "owner_user_id,reference_id" })
    .select("updated_at")
    .maybeSingle();
  if (error) throw new Error(publicMessageFromSupabaseError(error, "Could not save plan data."));
  return (data?.updated_at as string | undefined) ?? now;
}

export async function generateBarrierWorkflowAction(
  input: BarrierWorkflowInput,
): Promise<
  | { ok: true; result: BarrierWorkflowResult; stagedPolling?: boolean }
  | { ok: false; error: string }
> {
  const referenceId = input.referenceId?.trim() ?? "";
  const selected = Array.from(new Set((input.selectedBarriers ?? []).map((s) => s.trim()).filter(Boolean)));
  const additionalBarriers = input.additionalBarriers?.trim() ?? "";
  const parsedAdditionalBarriers = parseAdditionalBarriers(additionalBarriers);
  const details = input.additionalDetails?.trim() ?? "";
  if (referenceId.length > 200) {
    return { ok: false, error: "Family/Case ID is too long (max 200 characters)." };
  }
  if (additionalBarriers.length > 2000) {
    return { ok: false, error: "Additional barriers text is too long (max 2000 characters)." };
  }
  if (details.length > 8000) {
    return { ok: false, error: "Additional details are too long (max 8000 characters)." };
  }
  if (selected.length > 40) {
    return { ok: false, error: "Too many barrier selections." };
  }
  if (!referenceId) {
    return { ok: false, error: "Enter a Family/Case ID to save and track this plan." };
  }
  if (selected.length === 0 && parsedAdditionalBarriers.length === 0 && !details) {
    return {
      ok: false,
      error: "Select at least one barrier or add supporting details below.",
    };
  }

  try {
    const { supabase, user } = await requireAppUserWithClient();
    const now = new Date();
    const { data: existingRecord } = await supabase
      .from("barrier_plan_records")
      .select("family_id")
      .eq("owner_user_id", user.id)
      .eq("reference_id", referenceId)
      .maybeSingle();

    let familyId: string;
    if (existingRecord?.family_id) {
      familyId = existingRecord.family_id as string;
      await supabase
        .from("families")
        .update({
          name: referenceId,
          summary: details || null,
          household_notes: details || null,
          urgency: "medium",
          status: "active",
        })
        .eq("id", familyId);
      await supabase.from("family_barriers").delete().eq("family_id", familyId);
    } else {
      const { data: familyIdRaw, error: familyErr } = await supabase.rpc("create_family_intake_row", {
        p_name: referenceId,
        p_summary: details || null,
        p_urgency: "medium",
        p_household_notes: details || null,
        p_status: "active",
      });
      if (familyErr || !familyIdRaw) {
        return {
          ok: false,
          error: publicMessageFromSupabaseError(familyErr, "Could not create workflow session."),
        };
      }
      familyId = String(familyIdRaw);
    }

    const barrierRows = selected.map((label, idx) => ({
      family_id: familyId,
      preset_key: BARRIER_KEY_BY_LABEL[label as BarrierPresetLabel] ?? null,
      label,
      sort_order: idx,
    }));
    for (const barrier of parsedAdditionalBarriers) {
      barrierRows.push({
        family_id: familyId,
        preset_key: "other",
        label: barrier.length > 200 ? `${barrier.slice(0, 197)}...` : barrier,
        sort_order: barrierRows.length,
      });
    }
    if (barrierRows.length > 0) {
      const { error: barrierErr } = await supabase.from("family_barriers").insert(barrierRows);
      if (barrierErr) return { ok: false, error: publicMessageFromSupabaseError(barrierErr) };
    }

    const matchRes = await runResourceMatching({ familyId });
    if (!matchRes.ok) return { ok: false, error: matchRes.error };

    const planRes = await startStagedLeanPlanGeneration({
      familyId,
      regenerationFeedback:
        [parsedAdditionalBarriers.join("; "), details].filter(Boolean).join("\n") || undefined,
      aiMode: input.aiMode,
    });
    if (!planRes.ok) return { ok: false, error: planRes.error };

    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Could not load generated workflow." };

    const mapped = mapFamilyToWorkflowResult(
      referenceId,
      familyId,
      selected,
      additionalBarriers,
      details,
      null,
      detail,
    );
    const savedAt = await upsertBarrierPlanRecord(
      user.id,
      referenceId,
      familyId,
      mapped.selectedBarriers,
      mapped.additionalDetails,
      mapped.sections,
      mapped.resources,
      supabase,
    );

    revalidatePath("/families");
    revalidatePath("/calendar");
    return {
      ok: true,
      result: { ...mapped, lastSavedAt: savedAt },
      stagedPolling: true,
    };
  } catch (error) {
    console.error("[barrier-workflow] generateBarrierWorkflowAction failed", error);
    return { ok: false, error: toClientError(error) };
  }
}

export async function toggleBarrierWorkflowActionItemAction(
  familyId: string,
  actionItemId: string,
  completed: boolean,
): Promise<{ ok: true; result: BarrierWorkflowResult } | { ok: false; error: string }> {
  const update = await updatePlanStepActionItem({
    familyId,
    actionItemId,
    status: completed ? "completed" : "pending",
  });
  if (!update.ok) return { ok: false, error: update.error };

  try {
    const { supabase, user } = await requireAppUserWithClient();
    const { data: record } = await supabase
      .from("barrier_plan_records")
      .select("reference_id")
      .eq("owner_user_id", user.id)
      .eq("family_id", familyId)
      .maybeSingle();
    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Workflow session not found." };

    const selectedBarriers = detail.barriers
      .filter((b) => b.preset_key !== "other")
      .map((b) => b.label);
    const additionalBarriers = detail.barriers
      .filter((b) => b.preset_key === "other")
      .map((b) => b.label)
      .join("; ");
    const details = detail.summary ?? detail.household_notes ?? "";
    const referenceId = (record?.reference_id as string | undefined) ?? familyId;
    const mapped = mapFamilyToWorkflowResult(
      referenceId,
      familyId,
      selectedBarriers,
      additionalBarriers,
      details,
      null,
      detail,
    );
    const savedAt = await upsertBarrierPlanRecord(
      user.id,
      referenceId,
      familyId,
      mapped.selectedBarriers,
      mapped.additionalDetails,
      mapped.sections,
      mapped.resources,
      supabase,
    );

    revalidatePath("/families");
    revalidatePath("/calendar");
    return {
      ok: true,
      result: { ...mapped, lastSavedAt: savedAt },
    };
  } catch (error) {
    console.error("[barrier-workflow] toggleBarrierWorkflowActionItemAction failed", error);
    return { ok: false, error: toClientError(error) };
  }
}

export async function loadBarrierWorkflowByReferenceAction(
  referenceId: string,
): Promise<{ ok: true; result: BarrierWorkflowResult } | { ok: false; error: string }> {
  const ref = referenceId.trim();
  if (!ref) return { ok: false, error: "Enter a Family/Case ID." };
  try {
    const { supabase, user } = await requireAppUserWithClient();
    const { data: record, error } = await supabase
      .from("barrier_plan_records")
      .select("family_id, selected_barriers, additional_details, updated_at")
      .eq("owner_user_id", user.id)
      .eq("reference_id", ref)
      .maybeSingle();
    if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
    if (!record?.family_id) return { ok: false, error: "No saved plan for this ID yet." };

    const detail = await getFamilyDetail(supabase, record.family_id as string);
    if (!detail) return { ok: false, error: "Saved plan record could not be loaded." };

    const selected = Array.isArray(record.selected_barriers)
      ? (record.selected_barriers as string[])
      : detail.barriers.filter((b) => b.preset_key !== "other").map((b) => b.label);
    const additionalBarriers = detail.barriers
      .filter((b) => b.preset_key === "other")
      .map((b) => b.label)
      .join("; ");
    const details =
      (record.additional_details as string | null | undefined) ??
      detail.summary ??
      detail.household_notes ??
      "";

    return {
      ok: true,
      result: mapFamilyToWorkflowResult(
        ref,
        record.family_id as string,
        selected,
        additionalBarriers,
        details,
        (record.updated_at as string | null | undefined) ?? null,
        detail,
      ),
    };
  } catch (error) {
    console.error("[barrier-workflow] loadBarrierWorkflowByReferenceAction failed", error);
    return { ok: false, error: toClientError(error) };
  }
}

export async function listRecentBarrierPlanRecordsAction(
  limit = 8,
): Promise<{ ok: true; records: BarrierWorkflowRecentRecord[] } | { ok: false; error: string }> {
  try {
    const { supabase, user } = await requireAppUserWithClient();
    const { data, error } = await supabase
      .from("barrier_plan_records")
      .select("reference_id, family_id, updated_at")
      .eq("owner_user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 20)));
    if (error) return { ok: false, error: publicMessageFromSupabaseError(error) };
    const records = (data ?? []).map((r) => ({
      referenceId: r.reference_id as string,
      familyId: r.family_id as string,
      updatedAt: r.updated_at as string,
    }));
    return { ok: true, records };
  } catch (error) {
    console.error("[barrier-workflow] listRecentBarrierPlanRecordsAction failed", error);
    return { ok: false, error: toClientError(error) };
  }
}

export async function generateBarrierWorkflowForFamilyAction(
  familyId: string,
  input: Omit<BarrierWorkflowInput, "referenceId">,
): Promise<
  | { ok: true; result: BarrierWorkflowResult; stagedPolling?: boolean }
  | { ok: false; error: string }
> {
  const selected = Array.from(new Set((input.selectedBarriers ?? []).map((s) => s.trim()).filter(Boolean)));
  const additionalBarriers = input.additionalBarriers?.trim() ?? "";
  const parsedAdditionalBarriers = parseAdditionalBarriers(additionalBarriers);
  const details = input.additionalDetails?.trim() ?? "";
  if (selected.length === 0 && parsedAdditionalBarriers.length === 0 && !details) {
    return {
      ok: false,
      error: "Select at least one barrier or add supporting details below.",
    };
  }
  try {
    const { supabase, user } = await requireAppUserWithClient();
    const { data: fam } = await supabase
      .from("families")
      .select("id, name")
      .eq("id", familyId)
      .maybeSingle();
    if (!fam) return { ok: false, error: "Family not found." };

    await supabase.from("family_barriers").delete().eq("family_id", familyId);
    const barrierRows = selected.map((label, idx) => ({
      family_id: familyId,
      preset_key: BARRIER_KEY_BY_LABEL[label as BarrierPresetLabel] ?? null,
      label,
      sort_order: idx,
    }));
    for (const barrier of parsedAdditionalBarriers) {
      barrierRows.push({
        family_id: familyId,
        preset_key: "other",
        label: barrier.length > 200 ? `${barrier.slice(0, 197)}...` : barrier,
        sort_order: barrierRows.length,
      });
    }
    if (barrierRows.length > 0) {
      const { error: barrierErr } = await supabase.from("family_barriers").insert(barrierRows);
      if (barrierErr) return { ok: false, error: publicMessageFromSupabaseError(barrierErr) };
    }

    await supabase
      .from("families")
      .update({ summary: details || null, household_notes: details || null })
      .eq("id", familyId);

    const matchRes = await runResourceMatching({ familyId });
    if (!matchRes.ok) return { ok: false, error: matchRes.error };

    const planRes = await startStagedLeanPlanGeneration({
      familyId,
      regenerationFeedback:
        [parsedAdditionalBarriers.join("; "), details].filter(Boolean).join("\n") || undefined,
      aiMode: input.aiMode,
    });
    if (!planRes.ok) return { ok: false, error: planRes.error };

    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Could not load generated family workflow." };

    const mapped = mapFamilyToWorkflowResult(
      detail.name,
      familyId,
      selected,
      additionalBarriers,
      details,
      null,
      detail,
    );
    const savedAt = await upsertBarrierPlanRecord(
      user.id,
      familyId,
      familyId,
      mapped.selectedBarriers,
      mapped.additionalDetails,
      mapped.sections,
      mapped.resources,
      supabase,
    );
    revalidatePath(`/families/${familyId}`);
    revalidatePath("/families");
    return { ok: true, result: { ...mapped, lastSavedAt: savedAt }, stagedPolling: true };
  } catch (error) {
    console.error("[barrier-workflow] generateBarrierWorkflowForFamilyAction failed", error);
    return { ok: false, error: toClientError(error) };
  }
}

export async function loadBarrierWorkflowForFamilyAction(
  familyId: string,
): Promise<{ ok: true; result: BarrierWorkflowResult } | { ok: false; error: string }> {
  try {
    const { supabase, user } = await requireAppUserWithClient();
    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Family not found." };
    const { data: record } = await supabase
      .from("barrier_plan_records")
      .select("updated_at, additional_details, selected_barriers")
      .eq("owner_user_id", user.id)
      .eq("family_id", familyId)
      .maybeSingle();
    const selected = Array.isArray(record?.selected_barriers)
      ? (record?.selected_barriers as string[])
      : detail.barriers.filter((b) => b.preset_key !== "other").map((b) => b.label);
    const additionalBarriers = detail.barriers
      .filter((b) => b.preset_key === "other")
      .map((b) => b.label)
      .join("; ");
    const details = (record?.additional_details as string | null | undefined) ?? detail.summary ?? "";
    return {
      ok: true,
      result: mapFamilyToWorkflowResult(
        detail.name,
        familyId,
        selected,
        additionalBarriers,
        details,
        (record?.updated_at as string | null | undefined) ?? null,
        detail,
      ),
    };
  } catch (error) {
    console.error("[barrier-workflow] loadBarrierWorkflowForFamilyAction failed", error);
    return { ok: false, error: toClientError(error) };
  }
}

