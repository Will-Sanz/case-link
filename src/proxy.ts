import { type NextRequest } from "next/server";
import { runSupabaseProxy } from "@/lib/supabase/proxy";

/**
 * Next.js 16+ convention: `proxy` runs on the Node.js runtime (not Edge).
 * Lives next to `src/app`. Supabase session refresh on Vercel Edge middleware was failing (MIDDLEWARE_INVOCATION_FAILED).
 */
export async function proxy(request: NextRequest) {
  return runSupabaseProxy(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
