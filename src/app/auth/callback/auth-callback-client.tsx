"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function safeInternalPath(nextRaw: string | null): string {
  const fallback = "/dashboard";
  if (!nextRaw || !nextRaw.startsWith("/") || nextRaw.startsWith("//")) return fallback;
  return nextRaw;
}

/**
 * Supabase may complete auth via:
 * - PKCE: `?code=...`
 * - Implicit / many recovery links: `#access_token=...&refresh_token=...` (hash never hits the server)
 * - Email link: `?token_hash=...&type=recovery` (verifyOtp)
 * - Failure: `?error=...&error_description=...`
 */
export function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Confirming sign-in…");

  useEffect(() => {
    let cancelled = false;

    const next = safeInternalPath(searchParams.get("next"));
    const oauthError = searchParams.get("error");
    const oauthDesc = searchParams.get("error_description");
    const code = searchParams.get("code");
    const token_hash = searchParams.get("token_hash");
    const type = searchParams.get("type");

    void (async () => {
      if (oauthError) {
        const msg = oauthDesc?.replace(/\+/g, " ") ?? oauthError;
        if (!cancelled) {
          router.replace(`/login?error=${encodeURIComponent(msg)}`);
        }
        return;
      }

      const supabase = createSupabaseBrowserClient();

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({
          type: type as "recovery" | "signup" | "invite" | "magiclink" | "email_change" | "email",
          token_hash,
        });
        if (cancelled) return;
        if (error) {
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      if (typeof window !== "undefined" && window.location.hash?.length > 1) {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const hashError = params.get("error");
        const hashErrorDesc = params.get("error_description");
        if (hashError) {
          const msg = hashErrorDesc?.replace(/\+/g, " ") ?? hashError;
          if (!cancelled) router.replace(`/login?error=${encodeURIComponent(msg)}`);
          return;
        }
        if (access_token && refresh_token) {
          setStatus("Setting up your session…");
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (cancelled) return;
          if (error) {
            router.replace(`/login?error=${encodeURIComponent(error.message)}`);
            return;
          }
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
          router.replace(next);
          router.refresh();
          return;
        }
      }

      if (!cancelled) {
        router.replace(
          `/login?error=${encodeURIComponent("reset_invalid")}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <p className="text-center text-sm text-slate-600" role="status">
      {status}
    </p>
  );
}
