"use server";

import { contactsForResourceIds, planResourceCatalog } from "@/lib/matching/plan-resources";
import { addCalendarDays, formatDateOnly, schoolDate } from "@/lib/dates";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { matchesForPlanContext } from "@/lib/plan-generator/resource-context";
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
import { validateNoPii } from "@/lib/privacy/no-pii";
import { logServerError } from "@/lib/logger/server-error";
import { PRESET_BARRIERS } from "@/lib/constants/intake-options";
import {
  BARRIER_PRESETS,
  type BarrierWorkflowPlanSection,
  type BarrierWorkflowResource,
  type BarrierWorkflowResult,
} from "@/types/barrier-workflow";

const BARRIER_KEY_BY_LABEL = new Map<string, string>([
  ...BARRIER_PRESETS.map(({ label, key }) => [label, key] as const),
  ...PRESET_BARRIERS.map(({ label, value }) => [label, value] as const),
]);

const familyIdSchema = z.string().uuid();
const barrierLabelSchema = z.string().refine(
  (value) => BARRIER_PRESETS.some((barrier) => barrier.label === value),
  "Unknown barrier",
);
const familyWorkflowInputSchema = z.object({
  selectedBarriers: z.array(barrierLabelSchema).max(20),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  additionalBarriers: z.string().max(2000).optional(),
  additionalDetails: z.string().max(4000).optional(),
  aiMode: z.enum(["fast", "thinking"]).optional(),
}).strict();

function toClientError(error: unknown): string {
  return publicMessageFromCaughtError("barrier-workflow", error);
}

function formatDateRange(start: Date, daysFrom: number, daysTo: number): string {
  const date = schoolDate(start);
  return `${formatDateOnly(addCalendarDays(date, daysFrom))} - ${formatDateOnly(addCalendarDays(date, daysTo))}`;
}

function parseAdditionalBarriers(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function mapFamilyToWorkflowResult(
  referenceId: string,
  familyId: string,
  additionalDetails: string,
  lastSavedAt: string | null,
  detail: NonNullable<Awaited<ReturnType<typeof getFamilyDetail>>>,
  resourceStatusOverride?: "ready" | "empty" | "unavailable",
  resourceStatusMessage?: string | null,
): BarrierWorkflowResult {
  // Shared preset keys do not imply the same meaning (for example, health categories).
  const isPlanningPreset = (label: string) => BARRIER_PRESETS.some(preset => preset.label === label);
  const selectedBarriers = detail.barriers.filter(barrier => isPlanningPreset(barrier.label)).map(barrier => barrier.label);
  const additionalBarriers = detail.barriers.filter(barrier => !isPlanningPreset(barrier.label)).map(barrier => barrier.label).join("\n");
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

  const resourceMatchRows = matchesForPlanContext(detail.resourceMatches, 12);
  const maxMatchScore = maxRawMatchScore(resourceMatchRows.map((m) => m.score));
  const resources: BarrierWorkflowResource[] = resourceMatchRows.map((m) => ({
      id: m.id,
      directoryUpdatedAt: m.resource!.updated_at,
      planContact: contactsForResourceIds([m.resource!.id], planResourceCatalog([m]))[0],
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
    resourceStatus:
      resourceStatusOverride ?? (resources.length > 0 ? "ready" : "empty"),
    resourceStatusMessage: resourceStatusMessage ?? null,
    lastSavedAt,
    planDisplayTitle: detail.plan?.client_display?.title?.trim() || null,
  };
}

export async function toggleBarrierWorkflowActionItemAction(
  familyId: string,
  actionItemId: string,
  completed: boolean,
  expectedUpdatedAt?: string,
): Promise<{ ok: true; result: BarrierWorkflowResult } | { ok: false; error: string }> {
  const parsed = z.object({
    familyId: familyIdSchema,
    actionItemId: z.string().uuid(),
    completed: z.boolean(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  }).safeParse({ familyId, actionItemId, completed, expectedUpdatedAt });
  if (!parsed.success) return { ok: false, error: "Invalid action-item update." };
  const update = await updatePlanStepActionItem({
    familyId: parsed.data.familyId,
    actionItemId: parsed.data.actionItemId,
    status: parsed.data.completed ? "completed" : "pending",
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
  });
  if (!update.ok) return { ok: false, error: update.error };

  try {
    const { supabase } = await requireAppUserWithClient();
    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Workflow session not found." };

    const details = detail.summary ?? detail.household_notes ?? "";
    const referenceId = detail.name;
    const mapped = mapFamilyToWorkflowResult(
      referenceId,
      familyId,
      details,
      null,
      detail,
    );
    revalidatePath("/families");
    return {
      ok: true,
      result: mapped,
    };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}

export async function generateBarrierWorkflowForFamilyAction(
  familyId: string,
  input: unknown,
): Promise<
  | { ok: true; result: BarrierWorkflowResult; stagedPolling?: boolean; planId?: string; savedContextAt: string }
  | { ok: false; error: string; savedContextAt?: string }
> {
  const parsed = z.object({
    familyId: familyIdSchema,
    input: familyWorkflowInputSchema,
  }).safeParse({ familyId, input });
  if (!parsed.success) return { ok: false, error: "Check the selected barriers and description." };
  familyId = parsed.data.familyId;
  const selected = Array.from(new Set(parsed.data.input.selectedBarriers.map((s) => s.trim()).filter(Boolean)));
  const additionalBarriers = parsed.data.input.additionalBarriers?.trim() ?? "";
  const parsedAdditionalBarriers = parseAdditionalBarriers(additionalBarriers);
  const details = parsed.data.input.additionalDetails?.trim() ?? "";
  if (selected.length + parsedAdditionalBarriers.length === 0) {
    return {
      ok: false,
      error: "Select at least one barrier.",
    };
  }
  if (selected.length + parsedAdditionalBarriers.length > 20) {
    return { ok: false, error: "Choose no more than 20 barriers." };
  }
  if (parsedAdditionalBarriers.some(barrier => barrier.length > 200)) {
    return { ok: false, error: "Keep each barrier to 200 characters or fewer." };
  }
  const privacy = validateNoPii([
    { field: "additionalDetails", label: "Short description", value: details },
    ...parsedAdditionalBarriers.map((barrier, index) => ({
      field: `additionalBarriers.${index}`,
      label: "Barrier",
      value: barrier,
    })),
  ]);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before continuing." };
  }
  let savedContextAt: string | undefined;
  try {
    const { supabase } = await requireAppUserWithClient();
    const { data: fam } = await supabase
      .from("families")
      .select("id, name")
      .eq("id", familyId)
      .maybeSingle();
    if (!fam) return { ok: false, error: "Family not found." };
    const labelPrivacy = validateNoPii([
      { field: "name", label: "Family label", value: fam.name, mode: "label" },
    ]);
    if (!labelPrivacy.ok) {
      return {
        ok: false,
        error: labelPrivacy.error ?? "Replace the family label with a non-identifying label.",
      };
    }

    const barrierRows = selected.map((label, idx) => ({
      preset_key: BARRIER_KEY_BY_LABEL.get(label) ?? "other",
      label,
      sort_order: idx,
    }));
    for (const barrier of parsedAdditionalBarriers) {
      barrierRows.push({
        preset_key: BARRIER_KEY_BY_LABEL.get(barrier) ?? "other",
        label: barrier,
        sort_order: barrierRows.length,
      });
    }

    // Save the case manager's selections first. The saved context remains useful even
    // if AI generation is temporarily unavailable.
    const { data: savedAt, error: contextError } = await supabase.rpc("save_family_planning_context", {
      p_family_id: familyId,
      p_barriers: barrierRows,
      p_summary: details || null,
      p_expected_updated_at: parsed.data.input.expectedUpdatedAt,
    });
    if (contextError) {
      return { ok: false, error: contextError.code === "40001"
        ? "The saved case details have changed. Reload this page and review them before saving your changes."
        : publicMessageFromSupabaseError(contextError) };
    }
    savedContextAt = savedAt as string;
    revalidatePath(`/families/${familyId}`);
    revalidatePath(`/families/${familyId}/profile`);
    revalidatePath("/families");

    // Match before generation so the planner can use current directory facts. A
    // matching outage is explicit in the UI but never blocks the core plan.
    const matchRes = await runResourceMatching({ familyId });
    if (!matchRes.ok) {
      logServerError("barrier-workflow:resource-matching", new Error(matchRes.error));
    }

    const planRes = await startStagedLeanPlanGeneration({
      familyId,
      aiMode: parsed.data.input.aiMode,
    });
    if (!planRes.ok) {
      revalidatePath(`/families/${familyId}`);
      return {
        ok: false,
        error: `Your case details were saved, but the plan could not be prepared. ${planRes.error}`,
        savedContextAt,
      };
    }

    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Could not load generated family workflow.", savedContextAt };

    const mapped = mapFamilyToWorkflowResult(
      detail.name,
      familyId,
      details,
      null,
      detail,
      matchRes.ok ? undefined : "unavailable",
      matchRes.ok ? null : matchRes.error,
    );
    revalidatePath(`/families/${familyId}`);
    revalidatePath("/families");
    return { ok: true, result: mapped, stagedPolling: true, planId: planRes.planId, savedContextAt };
  } catch (error) {
    return { ok: false, error: toClientError(error), savedContextAt };
  }
}

export async function loadBarrierWorkflowForFamilyAction(
  familyId: string,
): Promise<{ ok: true; result: BarrierWorkflowResult } | { ok: false; error: string }> {
  const parsed = familyIdSchema.safeParse(familyId);
  if (!parsed.success) return { ok: false, error: "Invalid family." };
  familyId = parsed.data;
  try {
    const { supabase } = await requireAppUserWithClient();
    const detail = await getFamilyDetail(supabase, familyId);
    if (!detail) return { ok: false, error: "Family not found." };
    const details = detail.summary ?? "";
    return {
      ok: true,
      result: mapFamilyToWorkflowResult(
        detail.name,
        familyId,
        details,
        null,
        detail,
      ),
    };
  } catch (error) {
    return { ok: false, error: toClientError(error) };
  }
}
