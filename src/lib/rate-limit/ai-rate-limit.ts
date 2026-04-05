import "server-only";

import { getEnv } from "@/lib/env";
import { createMemorySlidingWindow } from "@/lib/rate-limit/memory-bucket";

let bucket: ReturnType<typeof createMemorySlidingWindow> | null = null;

function getBucket() {
  if (!bucket) {
    const env = getEnv();
    const maxRaw = env.OPENAI_RATE_LIMIT_MAX_PER_MINUTE;
    const windowRaw = env.OPENAI_RATE_LIMIT_WINDOW_MS;
    const max =
      typeof maxRaw === "number" && Number.isFinite(maxRaw) && maxRaw >= 1
        ? Math.min(500, Math.floor(maxRaw))
        : 30;
    const windowMs =
      typeof windowRaw === "number" && Number.isFinite(windowRaw) && windowRaw >= 10_000
        ? Math.min(3_600_000, Math.floor(windowRaw))
        : 60_000;
    bucket = createMemorySlidingWindow({ max, windowMs });
  }
  return bucket;
}

/**
 * Returns false if this user exceeded the AI request budget for the current window.
 * Counts all OpenAI-backed actions together per user (stronger cost control than per-route).
 */
export function takeOpenAiRateSlot(userId: string): boolean {
  return getBucket().take(userId);
}
