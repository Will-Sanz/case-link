"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { requestPasswordResetForEmail } from "@/app/actions/password-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass } from "@/lib/ui/form-classes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotOk, setForgotOk] = useState(false);
  const [forgotPending, setForgotPending] = useState(false);
  const urlErrorRaw = searchParams.get("error");
  const urlError =
    urlErrorRaw ?
      (() => {
        try {
          return decodeURIComponent(urlErrorRaw);
        } catch {
          return urlErrorRaw;
        }
      })()
    : null;
  const [error, setError] = useState<string | null>(
    urlError === "auth" || urlError === "reset_invalid" ?
      "This sign-in or reset link is invalid, expired, or was already used. Request a new password reset from the login page."
    : urlError,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signError) {
        setError(signError.message);
        return;
      }
      router.push(nextPath.startsWith("/") ? nextPath : "/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function onForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotMessage(null);
    setForgotOk(false);
    setForgotPending(true);
    try {
      const res = await requestPasswordResetForEmail(email);
      setForgotMessage(res.message);
      setForgotOk(res.ok);
    } finally {
      setForgotPending(false);
    }
  }

  if (showForgot) {
    return (
      <form onSubmit={onForgotSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          {`Enter your email. We will send a message with a `}
          <strong className="font-medium">Reset password</strong>
          {` button (that is different from the "password changed" confirmation you get later).`}
        </p>
        {forgotMessage ? (
          <p
            className={forgotOk ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" : alertErrorClass}
            role="status"
          >
            {forgotMessage}
          </p>
        ) : null}
        <div>
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            name="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={forgotPending}
            onClick={() => {
              setShowForgot(false);
              setForgotMessage(null);
              setForgotOk(false);
            }}
          >
            Back to sign in
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={forgotPending}>
            {forgotPending ? "Sending…" : "Send reset email"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="password">Password</Label>
          <button
            type="button"
            className="text-xs font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
            onClick={() => {
              setError(null);
              setShowForgot(true);
            }}
          >
            Forgot password?
          </button>
        </div>
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
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
