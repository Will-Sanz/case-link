import "server-only";

type HeaderBag = { get(name: string): string | null };

/**
 * Best-effort client IP for rate limiting (Vercel / proxies). Not used for security-critical auth.
 */
export function getClientIpFromHeaders(headers: HeaderBag): string | null {
  const forwarded = headers.get("x-forwarded-for")?.trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return null;
}
