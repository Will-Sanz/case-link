/** Synthetic, non-identifying examples for offline and opt-in provider contract checks. */
export const generatedCompactPlanStep = {
  goal: "Prepare for intake", title: "Prepare documents", summary: "Gather the agreed documents for the next intake.",
  action_items: [{ title: "Review the checklist", description: null, target_date: "2026-10-20" }],
  timing: null, required_documents: [], resource_ids: [], expected_outcome: "The agreed checklist is ready.", priority: "medium" as const, additional_guidance: null,
};
export const generatedPlanStep = {
  ...generatedCompactPlanStep,
  phase: "30" as const,
  action_items: generatedCompactPlanStep.action_items.map(action => ({ ...action, week_index: 1 })),
};
export const refinedPlanStep = {
  id: "30000000-0000-4000-8000-000000000003", phase: "30" as const, title: "Prepare documents", description: "Review the agreed checklist.",
  required_documents: null, resource_ids: null, expected_outcome: "Checklist reviewed.", timing_guidance: "", priority: null,
  action_items: [{ id: "40000000-0000-4000-8000-000000000004", title: "Review checklist", description: null, week_index: 1, target_date: "2026-10-20" }],
};
