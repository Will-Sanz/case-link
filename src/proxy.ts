import type { NextRequest } from "next/dist/server/web/spec-extension/request";
import { runSupabaseProxy } from "@/lib/supabase/proxy";

/**
 * Next.js 16+ convention: `proxy` runs on the Node.js runtime (not Edge).
 * Lives next to `src/app`. Supabase session refresh on Vercel Edge middleware was failing (MIDDLEWARE_INVOCATION_FAILED).
 *
 * Avoid `next/server` here: it eagerly loads `userAgent` → ua-parser-js → `__dirname`, which throws in ESM proxy bundles.
 */
export async function proxy(request: NextRequest) {
  return runSupabaseProxy(request);
}

export const config = {
  matcher: [
    // Skip all `/_next/*` (not only static/image) so internal chunks / RSC never hit proxy.
    "/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
