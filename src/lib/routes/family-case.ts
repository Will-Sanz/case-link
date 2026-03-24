/**
 * Canonical URLs for family case pages (section + optional plan hash).
 * Use overview when opening a case from lists; use step href for step-specific CTAs.
 */
export function familyCaseOverviewHref(familyId: string): string {
  return `/families/${familyId}/overview`;
}

export function familyCaseStepHref(familyId: string, stepId: string): string {
  return `/families/${familyId}/plan#step-${stepId}`;
}
