"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AUTH_CALLBACK_ERROR_PATH, completeAuthCallback } from "@/lib/auth/complete-auth-callback";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Share only the current operation across Strict Mode and route remounts; never persist tokens.
let inFlight: Promise<string> | null = null;

export function AuthCallbackClient() {
  const router = useRouter();
  const capturedUrl = useRef<URL | null>(null);
  const [status, setStatus] = useState<"initial" | "confirm" | "exchange">("initial");
  useEffect(() => {
    let active = true;
    void (async () => {
      let path = AUTH_CALLBACK_ERROR_PATH;
      try {
        const url = capturedUrl.current ?? new URL(window.location.href);
        capturedUrl.current = url;
        // Clear query credentials as well as fragment credentials before Supabase auto-detection.
        window.history.replaceState(window.history.state, "", url.pathname);
        if (!inFlight && status !== "exchange" && (url.searchParams.has("token_hash") || new URLSearchParams(url.hash.slice(1)).has("token_hash"))) {
          setStatus("confirm");
          return;
        }
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
  }, [router, status]);

  if (status === "confirm") return (
    <div className="max-w-sm space-y-4 text-center">
      <h1 className="text-xl font-semibold">Continue to your account</h1>
      <p className="text-sm text-[var(--public-ink-muted)]">Continue to set or reset your CaseLink password. This link can be used once.</p>
      <Button onClick={() => setStatus("exchange")}>Continue to password setup</Button>
    </div>
  );

  return <p className="text-center text-sm text-[var(--public-ink-muted)]" role="status">Confirming sign-in…</p>;
}
