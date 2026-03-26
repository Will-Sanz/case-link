import "server-only";

import { headers } from "next/headers";

/**
 * Canonical browser-facing origin for auth redirect URLs (`redirectTo`, `emailRedirectTo`).
 *
 * **Production:** set `NEXT_PUBLIC_SITE_URL` (e.g. `https://app.example.com`) so password reset
 * and signup links never depend on proxy headers (which can be wrong or missing in some server
 * action / cron contexts).
 *
 * Falls back to `Host` / `X-Forwarded-Host` + `X-Forwarded-Proto` when unset (typical local dev).
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

  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host")?.trim();
  if (!host) return null;

  let proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!proto) {
    proto = process.env.NODE_ENV === "production" ? "https" : "http";
  }

  return `${proto}://${host}`;
}
