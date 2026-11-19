import { contactsForResourceIds, planResourceCatalog } from "@/lib/matching/plan-resources";
import { addCalendarDays, formatDateOnly, schoolDate } from "@/lib/dates";
import { matchesForPlanContext } from "@/lib/plan-generator/resource-context";
import { maxRawMatchScore, rawMatchScoreToPercent } from "@/lib/matching/normalize-display-score";
import { BARRIER_PRESETS, type BarrierWorkflowPlanSection, type BarrierWorkflowResource, type BarrierWorkflowResult } from "@/types/barrier-workflow";
import type { FamilyDetail } from "@/types/family";

function formatDateRange(start: Date, daysFrom: number, daysTo: number): string {
  const date = schoolDate(start);
  return `${formatDateOnly(addCalendarDays(date, daysFrom))} - ${formatDateOnly(addCalendarDays(date, daysTo))}`;
}

export function mapFamilyToWorkflowResult(
  referenceId: string,
  familyId: string,
  additionalDetails: string,
  lastSavedAt: string | null,
  detail: FamilyDetail,
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

