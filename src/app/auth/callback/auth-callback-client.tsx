"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AUTH_CALLBACK_ERROR_PATH, completeAuthCallback } from "@/lib/auth/complete-auth-callback";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Share only the current operation across Strict Mode and route remounts; never persist tokens.
let inFlight: Promise<string> | null = null;

export function AuthCallbackClient() {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    void (async () => {
      let path = AUTH_CALLBACK_ERROR_PATH;
      try {
        const url = new URL(window.location.href);
        // Clear query credentials as well as fragment credentials before Supabase auto-detection.
        window.history.replaceState(window.history.state, "", url.pathname);
        if (!inFlight) {
          const operation = completeAuthCallback(url, createSupabaseBrowserClient);
          inFlight = operation;
          void operation.finally(() => { if (inFlight === operation) inFlight = null; });
        }
        path = await inFlight;
      } catch {
        // Cookie/history restrictions and provider failures use the same safe recovery destination.
      }
      if (active) {
        router.replace(path);
        router.refresh();
      }
    })();
    return () => { active = false; };
  }, [router]);

  return <p className="text-center text-sm text-[var(--public-ink-muted)]" role="status">Confirming sign-in…</p>;
}
