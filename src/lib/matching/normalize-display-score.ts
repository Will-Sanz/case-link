/**
 * Raw matching-engine scores are rule points, not 0 to 100. Normalize relative to the
 * strongest match in the same list so the UI can show a meaningful percentage.
 */
export function maxRawMatchScore(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return Math.max(...scores);
}

export function rawMatchScoreToPercent(score: number, maxScoreInSet: number): number {
  if (maxScoreInSet <= 0) return 0;
  return Math.min(100, Math.round((score / maxScoreInSet) * 100));
}
