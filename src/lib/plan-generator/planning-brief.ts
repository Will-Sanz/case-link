import type { FamilyDetail } from "@/types/family";

const MAX_BRIEF = 1200;

/**
 * Stage A: compact planning brief (no model call) for lean generation prompts.
 */
export function buildPlanningBrief(detail: FamilyDetail, extraFeedback?: string): string {
  const barriers = detail.barriers.map((b) => b.label.trim()).filter(Boolean);
  const uniqueBarriers = [...new Set(barriers)];
  const goals = detail.goals.map((g) => g.label.trim()).filter(Boolean);
  const notes = [detail.summary?.trim(), detail.household_notes?.trim(), extraFeedback?.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_BRIEF);

  const parts = [
    uniqueBarriers.length ? `Barriers: ${uniqueBarriers.join("; ")}` : null,
    goals.length ? `Goals: ${goals.join("; ")}` : null,
    notes ? `Context:\n${notes}` : null,
  ].filter(Boolean);

  return parts.join("\n\n").slice(0, MAX_BRIEF) || "No additional context; use barriers only.";
}
