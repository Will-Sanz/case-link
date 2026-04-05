import "server-only";

import { getEnv } from "@/lib/env";
import { createMemorySlidingWindow } from "@/lib/rate-limit/memory-bucket";

let bucket: ReturnType<typeof createMemorySlidingWindow> | null = null;
let ipBucket: ReturnType<typeof createMemorySlidingWindow> | null = null;

function windowMsFromEnv(): number {
  const env = getEnv();
  const windowRaw = env.OPENAI_RATE_LIMIT_WINDOW_MS;
  return typeof windowRaw === "number" && Number.isFinite(windowRaw) && windowRaw >= 10_000
    ? Math.min(3_600_000, Math.floor(windowRaw))
    : 60_000;
}

function getBucket() {
  if (!bucket) {
    const env = getEnv();
    const maxRaw = env.OPENAI_RATE_LIMIT_MAX_PER_MINUTE;
    const max =
      typeof maxRaw === "number" && Number.isFinite(maxRaw) && maxRaw >= 1
        ? Math.min(500, Math.floor(maxRaw))
        : 30;
    bucket = createMemorySlidingWindow({ max, windowMs: windowMsFromEnv() });
  }
  return bucket;
}

function getIpBucket(): ReturnType<typeof createMemorySlidingWindow> | null {
  const env = getEnv();
  const maxRaw = env.OPENAI_RATE_LIMIT_PER_IP_MAX;
  if (typeof maxRaw !== "number" || !Number.isFinite(maxRaw) || maxRaw < 1) {
    return null;
  }
  if (!ipBucket) {
    ipBucket = createMemorySlidingWindow({
      max: Math.min(2000, Math.floor(maxRaw)),
      windowMs: windowMsFromEnv(),
    });
  }
  return ipBucket;
}

/**
 * Returns false if this user exceeded the AI request budget for the current window.
 * Counts all OpenAI-backed actions together per user (stronger cost control than per-route).
 */
export function takeOpenAiRateSlot(userId: string): boolean {
  return getBucket().take(userId);
}

/**
 * Secondary limit when `OPENAI_RATE_LIMIT_PER_IP_MAX` is set and `clientIp` is known.
 * Returns true when IP limiting is disabled or the IP is within budget.
 */
export function takeOpenAiRateSlotForIp(ip: string): boolean {
  const b = getIpBucket();
  if (!b) return true;
  const key = ip.trim().slice(0, 64);
  if (!key) return true;
  return b.take(`ip:${key}`);
}
