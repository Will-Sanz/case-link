"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass, alertInfoClass } from "@/lib/ui/form-classes";
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

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
      // Use production URL for email confirmation so the link always lands on production dashboard
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
      const redirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent(nextPath.startsWith("/") ? nextPath : "/dashboard")}`;

      const { data, error: signError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (signError) {
        setError(signError.message);
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
            className="font-medium text-teal-900 underline-offset-2 hover:underline"
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
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
