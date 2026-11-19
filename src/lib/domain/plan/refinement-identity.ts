/** Match only existing records, preserving their order and rejecting duplicate or foreign IDs. */
export function matchPlanRowsById<T extends { id: string }>(baseline: readonly { id: string }[], proposed: readonly T[]): T[] {
  const byId = new Map(proposed.map(row => [row.id, row]));
  if (proposed.length !== baseline.length || byId.size !== baseline.length || baseline.some(row => !byId.has(row.id))) {
    throw new Error("AI refinement changed the plan structure. Keep the existing goals and actions; request wording or date edits instead.");
  }
  return baseline.map(row => byId.get(row.id)!);
}
