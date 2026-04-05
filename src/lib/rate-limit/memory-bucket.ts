/**
 * Simple in-memory sliding-window limiter (per Node process).
 * Suitable for single-instance deploys; for multi-instance use a shared store (e.g. Redis) later.
 */

type BucketOpts = {
  max: number;
  windowMs: number;
};

export function createMemorySlidingWindow(opts: BucketOpts) {
  const { max, windowMs } = opts;
  const hits = new Map<string, number[]>();

  return {
    take(key: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;
      const prev = hits.get(key) ?? [];
      const kept = prev.filter((t) => t > cutoff);
      if (kept.length >= max) {
        hits.set(key, kept);
        return false;
      }
      kept.push(now);
      hits.set(key, kept);
      return true;
    },
  };
}
