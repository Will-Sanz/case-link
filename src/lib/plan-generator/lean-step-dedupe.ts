import type { LeanPlanPhaseStep } from "@/lib/plan-generator/lean-plan-schema";

function normalizeBlob(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenJaccard(a: string, b: string): number {
  const words = (t: string) =>
    new Set(
      normalizeBlob(t)
        .split(" ")
        .filter((w) => w.length > 2),
    );
  const A = words(a);
  const B = words(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter++;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function nearDuplicateContent(a: string, b: string): boolean {
  const na = normalizeBlob(a);
  const nb = normalizeBlob(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 18 && nb.length >= 18) {
    if (na.includes(nb.slice(0, Math.min(24, nb.length))) || nb.includes(na.slice(0, Math.min(24, na.length)))) {
      return true;
    }
  }
  return tokenJaccard(a, b) >= 0.58;
}

export function stepsAreNearDuplicate(a: LeanPlanPhaseStep, b: LeanPlanPhaseStep): boolean {
  const bundleA = `${a.title}\n${a.summary}`;
  const bundleB = `${b.title}\n${b.summary}`;
  return nearDuplicateContent(bundleA, bundleB);
}

/**
 * Drops later steps that are near-duplicates of an earlier step in the same array (order preserved).
 */
export function dedupeLeanPhaseStepsInBatch(steps: LeanPlanPhaseStep[]): LeanPlanPhaseStep[] {
  const out: LeanPlanPhaseStep[] = [];
  for (const s of steps) {
    if (out.some((o) => stepsAreNearDuplicate(o, s))) continue;
    out.push(s);
  }
  if (out.length === 0 && steps.length > 0) return [steps[0]!];
  return out;
}

/**
 * Removes steps whose title+summary is very similar to content already present in `priorSummary` text.
 */
export function filterStepsAgainstPriorSummary(
  steps: LeanPlanPhaseStep[],
  priorSummary: string | null | undefined,
): LeanPlanPhaseStep[] {
  const prior = (priorSummary ?? "").trim();
  if (!prior) return steps;

  const priorChunks = prior
    .split(/\n+/)
    .map((line) => line.replace(/^-\s*\[[^\]]+\]\s*/, "").trim())
    .filter((c) => c.length > 12);

  return steps.filter((s) => {
    const blob = `${s.title}\n${s.summary}`;
    for (const chunk of priorChunks) {
      if (nearDuplicateContent(blob, chunk)) return false;
      if (tokenJaccard(blob, chunk) >= 0.62) return false;
    }
    return true;
  });
}

/**
 * In-batch dedupe, then drop steps that largely repeat prior-phase summary (keeps at least one if all filtered).
 */
export function dedupeLeanPhaseSteps(
  steps: LeanPlanPhaseStep[],
  priorSummary?: string | null,
): LeanPlanPhaseStep[] {
  let next = dedupeLeanPhaseStepsInBatch(steps);
  if (priorSummary?.trim()) {
    const filtered = filterStepsAgainstPriorSummary(next, priorSummary);
    if (filtered.length > 0) next = dedupeLeanPhaseStepsInBatch(filtered);
  }
  return next;
}
