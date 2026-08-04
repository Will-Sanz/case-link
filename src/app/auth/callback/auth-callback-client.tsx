"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  safeAuthSessionClientMessage,
  safeOAuthRedirectMessage,
} from "@/lib/auth/safe-client-auth-message";
import { safeInternalPath } from "@/lib/auth/safe-internal-path";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Survives React Strict Mode remount without persisting bearer tokens in browser storage. */
let pendingAuthFragment = "";

function readFragmentForCallback(): string {
  if (typeof window === "undefined") return "";
  const fromUrl = window.location.hash.replace(/^#/, "");
  if (fromUrl) {
    pendingAuthFragment = fromUrl;
    return fromUrl;
  }
  return pendingAuthFragment;
}

function clearStoredAuthFragment() {
  pendingAuthFragment = "";
}

/**
 * Supabase may complete auth via:
 * - PKCE: `?code=...`
 * - Implicit: `#access_token=...&refresh_token=...` (hash never hits the server)
 * - Email link: `?token_hash=...&type=...` (verifyOtp)
 * - Failure: `?error=...&error_description=...`
 */
export function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Confirming sign-in…");
  const navigatedRef = useRef(false);

  useEffect(() => {
    const oauthError = searchParams.get("error");
    const oauthDesc = searchParams.get("error_description");
    const code = searchParams.get("code");
    const token_hash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    const next = safeInternalPath(searchParams.get("next"));

    function finishRedirect(path: string) {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      clearStoredAuthFragment();
      router.replace(path);
      router.refresh();
    }

    function goLoginError(msg: string) {
      finishRedirect(`/login?error=${encodeURIComponent(msg)}`);
    }

    void (async () => {
      if (oauthError) {
        const raw = oauthDesc?.replace(/\+/g, " ") ?? oauthError;
        goLoginError(safeOAuthRedirectMessage(raw));
        return;
      }

      const supabase = createSupabaseBrowserClient();

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          goLoginError(safeAuthSessionClientMessage(error.message));
          return;
        }
        const { data: after } = await supabase.auth.getSession();
        if (!after.session) {
          goLoginError("Could not establish a session. Try opening the link again.");
          return;
        }
        finishRedirect(next);
        return;
      }

      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({
          type: type as "signup" | "invite" | "magiclink" | "email_change" | "email" | "recovery",
          token_hash,
        });
        if (error) {
          goLoginError(safeAuthSessionClientMessage(error.message));
          return;
        }
        const { data: afterOtp } = await supabase.auth.getSession();
        if (!afterOtp.session) {
          goLoginError("Could not establish a session. Try opening the link again.");
          return;
        }
        finishRedirect(next);
        return;
      }

      const fragmentStr = readFragmentForCallback();
      if (fragmentStr.length > 0) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
        const params = new URLSearchParams(fragmentStr);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const hashError = params.get("error");
        const hashErrorDesc = params.get("error_description");
        if (hashError) {
          const raw = hashErrorDesc?.replace(/\+/g, " ") ?? hashError;
          goLoginError(safeOAuthRedirectMessage(raw));
          return;
        }
        if (access_token && refresh_token) {
          setStatus("Setting up your session…");
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) {
            goLoginError(safeAuthSessionClientMessage(error.message));
            return;
          }
          const { data: afterHash } = await supabase.auth.getSession();
          if (!afterHash.session) {
            goLoginError("Could not establish a session. Try opening the link again.");
            return;
          }
          finishRedirect(next);
          return;
        }
      }

      clearStoredAuthFragment();
      finishRedirect(`/login?error=${encodeURIComponent("auth")}`);
    })();
  }, [router, searchParams]);

  return (
    <p className="text-center text-sm text-slate-600" role="status">
      {status}
    </p>
  );
}
