import type { ResourceMatchRow } from "@/types/family";
import { formatResourceCatalog, planResourceCatalog, matchesForPlanContext } from "@/lib/matching/plan-resources";
export { matchesForPlanContext } from "@/lib/matching/plan-resources";

export function formatMatchesForPlannerPrompt(matches: ResourceMatchRow[], max = 6): string {
  const catalog = planResourceCatalog(matches, max);
  return formatResourceCatalog(catalog, matchesForPlanContext(matches, matches.length).length - catalog.length);
}

export function formatMatchesForAiPrompt(matches: ResourceMatchRow[], max: number): string {
  return formatMatchesForPlannerPrompt(matches, max);
}
