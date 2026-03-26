import "server-only";

import { headers } from "next/headers";

/** When `NEXT_PUBLIC_SITE_URL` is unset on Vercel production, use this origin for auth emails. Set the env var if the app uses a different domain. */
const CASELINK_PRODUCTION_ORIGIN = "https://www.thecaselink.com";

/**
 * Canonical browser-facing origin for auth redirect URLs (`redirectTo`, `emailRedirectTo`).
 *
 * **Production:** set `NEXT_PUBLIC_SITE_URL` (e.g. `https://www.thecaselink.com`) so signup and other
 * auth `redirectTo` URLs never use localhost, preview URLs, or wrong hosts from server actions.
 *
 * Order: explicit env → Vercel production fallback → request Host headers (typical local dev).
 */
export async function getPublicSiteOrigin(): Promise<string | null> {
  const explicitRaw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicitRaw) {
    try {
      const u = new URL(explicitRaw.includes("://") ? explicitRaw : `https://${explicitRaw}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }

  if (process.env.VERCEL_ENV === "production") {
    return CASELINK_PRODUCTION_ORIGIN;
  }

  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host")?.trim();
  if (!host) return null;

  let proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!proto) {
    proto = process.env.NODE_ENV === "production" ? "https" : "http";
  }

  return `${proto}://${host}`;
}
