"use client";
import { useParentLocale } from "@/features/parent/parent-locale";
import { parentRecoveryHref } from "@/lib/parent/locale";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass, alertInfoClass } from "@/lib/ui/form-classes";
import { getBrowserPublicSiteOrigin } from "@/lib/auth/public-site-url-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm() {
  const { t, locale, provided } = useParentLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;

    setError(null);
    setInfo(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const baseUrl = getBrowserPublicSiteOrigin();
      const redirectTo = `${baseUrl}/auth/callback${provided ? `?ui=${locale}&` : "?"}next=${encodeURIComponent(provided ? parentRecoveryHref("/reset-password?mode=recovery", locale) : "/reset-password?mode=recovery")}`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });

      if (resetError) {
        setError("We couldn't send a reset link right now. Please try again.");
        return;
      }

      setInfo("If an account exists for that email, we've sent a secure reset link.");
    } catch {
      setError("We couldn't send a reset link right now. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p className={alertErrorClass} role="alert">
          {t(error)}
        </p>
      ) : null}
      {info ? (
        <p className={alertInfoClass} role="status">
          {t(info)}
        </p>
      ) : null}
      <div>
        <Label htmlFor="forgot-email">{t("Email")}</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button type="submit" className="w-full" style={{ whiteSpace: "normal" }} disabled={pending}>
        {pending ? t("Sending reset link…") : t("Send reset link")}
      </Button>
      <p className="text-center text-sm text-[var(--public-ink-muted)]">
        {t("Remembered your password?")}{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--public-accent)] underline-offset-2 hover:text-[var(--public-accent-hover)] hover:underline"
        >
          {t("Back to sign in")}</Link>
      </p>
    </form>
  );
}
