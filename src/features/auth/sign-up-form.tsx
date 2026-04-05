"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LegalDocumentModal } from "@/components/legal/legal-document-modal";
import type { LegalModalDocument } from "@/components/legal/legal-document-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass, alertInfoClass } from "@/lib/ui/form-classes";
import { safeSignUpMessage } from "@/lib/auth/safe-client-auth-message";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [legalModal, setLegalModal] = useState<LegalModalDocument | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!agreedToTerms) {
      setError(
        "You must agree to the Terms of Service and Privacy Policy to create an account.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const envOrigin =
        process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
      let baseUrl = window.location.origin;
      if (envOrigin) {
        try {
          const u = new URL(envOrigin.includes("://") ? envOrigin : `https://${envOrigin}`);
          baseUrl = `${u.protocol}//${u.host}`;
        } catch {
          /* keep window.location.origin */
        }
      }
      const redirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent(nextPath.startsWith("/") ? nextPath : "/dashboard")}`;

      const { data, error: signError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (signError) {
        setError(safeSignUpMessage(signError.message));
        return;
      }

      if (data.session) {
        router.push(nextPath.startsWith("/") ? nextPath : "/dashboard");
        router.refresh();
        return;
      }

      setInfo(
        "Check your email for a confirmation link. After confirming, you can sign in.",
      );
    } finally {
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
      {info ? (
        <p className={alertInfoClass} role="status">
          {info}{" "}
          <Link
            href={`/login?next=${encodeURIComponent(nextPath.startsWith("/") ? nextPath : "/dashboard")}`}
            className="font-medium text-blue-900 underline-offset-2 hover:underline"
          >
            Go to sign in
          </Link>
        </p>
      ) : null}
      <div>
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
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
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1"
        />
        <p className="mt-1 text-xs text-slate-500">At least 6 characters.</p>
      </div>
      <div>
        <Label htmlFor="signup-confirm">Confirm password</Label>
        <Input
          id="signup-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="flex items-start gap-2.5 rounded-md border border-slate-200/80 bg-slate-50/50 px-3 py-3">
        <input
          id="signup-accept-legal"
          name="acceptTerms"
          type="checkbox"
          checked={agreedToTerms}
          onChange={(e) => setAgreedToTerms(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-0"
        />
        <label htmlFor="signup-accept-legal" className="text-sm leading-snug text-slate-600">
          By creating an account, you agree to the{" "}
          <button
            type="button"
            className="inline font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
            onClick={() => setLegalModal("terms")}
          >
            Terms of Service
          </button>{" "}
          and{" "}
          <button
            type="button"
            className="inline font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
            onClick={() => setLegalModal("privacy")}
          >
            Privacy Policy
          </button>
          .
        </label>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
