"use client";

/**
 * Browser-safe public origin for auth redirect URLs.
 * Prefers configured public URL and falls back to current window origin.
 */
export function getBrowserPublicSiteOrigin(): string {
  const windowOrigin = window.location.origin;
  const host = window.location.hostname.toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1";

  // In local dev, prefer the current origin so auth emails use localhost callbacks.
  if (isLocalHost) {
    return windowOrigin;
  }

  const envOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (envOrigin) {
    try {
      const u = new URL(envOrigin.includes("://") ? envOrigin : `https://${envOrigin}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* keep window.location.origin */
    }
  }

  return windowOrigin;
}
