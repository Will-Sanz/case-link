import { fetchWithTimeout } from "./fetch-with-timeout";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/dist/server/web/spec-extension/request";
import { NextResponse } from "next/dist/server/web/spec-extension/response";
import { applyRuntimeHsts } from "@/lib/security/response-headers";
import { parentConfigurationIssues } from "@/lib/parent/configuration";

// Import NextRequest/NextResponse from spec-extension paths, not `next/server`, so we do not load
// user-agent / ua-parser-js (uses `__dirname`, which is undefined in some proxy bundles).

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/families",
  "/resources",
  "/admin",
  "/profile",
];

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
  if (process.env.CASELINK_PRODUCT === "parent")
    response.headers.set("Cache-Control", "private, no-store");
  applyRuntimeHsts(response.headers, {
    productionDeployment:
      process.env.VERCEL_ENV === "production" ||
      process.env.CASELINK_ENVIRONMENT === "production",
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

  if (process.env.CASELINK_PRODUCT === "parent") {
    if (parentConfigurationIssues(process.env).length)
      return finalizeResponse(supabaseResponse);
    const parent = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      {
        global: { fetch: fetchWithTimeout },
        cookieOptions: {
          name: "caselink-parent-auth",
          httpOnly: true,
          sameSite: "lax",
          secure:
            process.env.NEXT_PUBLIC_SUPABASE_URL!.startsWith("https://") &&
            process.env.CASELINK_ENVIRONMENT !== "connected",
          path: "/",
        },
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(values) {
            for (const { name, value } of values)
              request.cookies.set(name, value);
            supabaseResponse = continueToApp();
            for (const { name, value, options } of values)
              supabaseResponse.cookies.set(name, value, options);
          },
        },
      },
    );
    // Authoritative live-session and household checks remain in each parent server entry point.
    await parent.auth.getUser().catch(() => null);
    return finalizeResponse(supabaseResponse);
  }

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
    global: { fetch: fetchWithTimeout },
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
