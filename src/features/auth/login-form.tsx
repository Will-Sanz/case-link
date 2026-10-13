"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { LegalDocumentModal } from "@/components/legal/legal-document-modal";
import type { LegalModalDocument } from "@/components/legal/legal-document-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass } from "@/lib/ui/form-classes";
import {
  AUTH_LINK_ERROR_MESSAGE,
  safeSignInPasswordMessage,
} from "@/lib/auth/safe-client-auth-message";
import { safeInternalPath } from "@/lib/auth/safe-internal-path";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeInternalPath(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const urlError = searchParams.get("error");
  const [error, setError] = useState<string | null>(() => {
    if (urlError === "auth") {
      return "This sign-in link is invalid, expired, or was already used.";
    }
    if (urlError && urlError.length > 0) {
      return AUTH_LINK_ERROR_MESSAGE;
    }
    return null;
  });
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [legalModal, setLegalModal] = useState<LegalModalDocument | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    submitting.current = true;
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signError) {
        setError(safeSignInPasswordMessage(signError.message));
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <LegalDocumentModal
        open={legalModal !== null}
        document={legalModal}
        onClose={() => setLegalModal(null)}
        onChangeDocument={(doc) => setLegalModal(doc)}
      />
      {error ? (
        <p className={alertErrorClass} role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1"
        />
        <div className="mt-2 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-[var(--color-positive)] underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
          >
            Forgot Password?
          </Link>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-[11px] leading-relaxed text-[var(--public-ink-3)]">
        By continuing, you agree to our{" "}
        <button
          type="button"
          className="inline font-medium text-[var(--public-accent)] underline-offset-2 hover:text-[var(--public-accent-hover)] hover:underline"
          onClick={() => setLegalModal("terms")}
        >
          Terms of Service
        </button>{" "}
        and{" "}
        <button
          type="button"
          className="inline font-medium text-[var(--public-accent)] underline-offset-2 hover:text-[var(--public-accent-hover)] hover:underline"
          onClick={() => setLegalModal("privacy")}
        >
          Privacy Policy
        </button>
        .
      </p>
    </form>
  );
}
