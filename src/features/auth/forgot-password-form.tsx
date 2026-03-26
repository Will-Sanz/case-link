"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass, alertInfoClass } from "@/lib/ui/form-classes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveAuthEmailOrigin() {
  const host = window.location.hostname.toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  if (isLocalHost) {
    return window.location.origin;
  }

  const envOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envOrigin) {
    try {
      const u = new URL(envOrigin.includes("://") ? envOrigin : `https://${envOrigin}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fallback */
    }
  }

  return window.location.origin;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    setError(null);
    setInfo(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const baseUrl = resolveAuthEmailOrigin();
      const emailRedirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent("/dashboard")}`;
      const { error: magicLinkError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo,
        },
      });

      if (magicLinkError) {
        setError("We couldn't send a sign-in link right now. Please try again.");
        return;
      }

      setInfo("If an account exists for that email, we've sent a secure sign-in link.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p className={alertErrorClass} role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className={alertInfoClass} role="status">
          {info}
        </p>
      ) : null}
      <div>
        <Label htmlFor="forgot-email">Email</Label>
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
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending sign-in link…" : "Send sign-in link"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        Remembered your password?{" "}
        <Link
          href="/login"
          className="font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
