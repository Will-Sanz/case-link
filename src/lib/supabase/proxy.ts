import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/dist/server/web/spec-extension/request";
import { NextResponse } from "next/dist/server/web/spec-extension/response";
import { applyRuntimeHsts } from "@/lib/security/response-headers";

// Import NextRequest/NextResponse from spec-extension paths, not `next/server`, so we do not load
// user-agent / ua-parser-js (uses `__dirname`, which is undefined in some proxy bundles).

const PROTECTED_PREFIXES = ["/dashboard", "/families", "/resources", "/admin", "/profile"];

/**
 * Continue to the App Router without overriding request headers.
 *
 * Do not pass `NextResponse.next({ request: { headers } })`: Next.js then sets
 * `x-middleware-override-headers` and resolve-routes **deletes every `req` header not in that set**
 * (see `resolve-routes.js`). A cloned/Headers view can omit keys present on Node’s `req`, breaking
 * routing on Vercel (NOT_FOUND / failed invocations). Session refresh still applies via
 * `response.cookies.set` on the returned `NextResponse`.
 */
function continueToApp() {
  return NextResponse.next();
}

function finalizeResponse(response: NextResponse): NextResponse {
  applyRuntimeHsts(response.headers, {
    productionDeployment:
      process.env.VERCEL_ENV === "production"
      || process.env.CASELINK_ENVIRONMENT === "production",
    enableHsts: process.env.CASELINK_HSTS === "1",
  });
  return response;
}

/**
 * Next.js 16+ `proxy` (Node runtime). Refreshes the Supabase session and guards protected routes.
 * Do not use this file from `middleware.ts`, Edge has stricter limits and caused Vercel failures.
 */
export async function runSupabaseProxy(request: NextRequest) {
  let supabaseResponse = continueToApp();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!supabaseUrl || !supabaseKey) {
    if (isProtected) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname);
      return finalizeResponse(NextResponse.redirect(login));
    }
    return finalizeResponse(supabaseResponse);
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = continueToApp();
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  let claims: unknown = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims) {
      claims = data.claims;
    }
  } catch {
    claims = null;
  }

  if (isProtected && !claims) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return finalizeResponse(NextResponse.redirect(login));
  }

  return finalizeResponse(supabaseResponse);
}
