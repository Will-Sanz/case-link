import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/families", "/resources", "/admin"];

/** NextResponse.next only accepts `request.headers` (not a full NextRequest). Passing the whole request breaks routing on Vercel. */
function continueRequest(request: NextRequest) {
  return NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });
}

/**
 * Next.js 16+ `proxy` (Node runtime). Refreshes the Supabase session and guards protected routes.
 * Do not use this file from `middleware.ts` — Edge has stricter limits and caused Vercel failures.
 */
export async function runSupabaseProxy(request: NextRequest) {
  let supabaseResponse = continueRequest(request);

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
      return NextResponse.redirect(login);
    }
    return supabaseResponse;
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
        supabaseResponse = continueRequest(request);
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
    return NextResponse.redirect(login);
  }

  return supabaseResponse;
}
