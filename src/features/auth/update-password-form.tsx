"use client";

import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass } from "@/lib/ui/form-classes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();

    function applySession(session: Session | null) {
      if (cancelled) return;
      setHasSession(!!session);
      setSessionChecked(true);
    }

    void supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) {
        const msg = upErr.message.toLowerCase();
        if (msg.includes("session") && msg.includes("expired")) {
          setError("Your reset session expired. Request a new password reset link.");
          return;
        }
        setError(upErr.message);
        return;
      }
      setSuccess(true);
    } finally {
      setPending(false);
    }
  }

  if (!sessionChecked) {
    return <p className="text-sm text-slate-500">Checking your session…</p>;
  }

  if (success) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {`Your password was updated. You're signed in — continue to the app, or sign out and sign in again with your new password if you prefer.`}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="w-full sm:w-auto" onClick={() => router.push("/dashboard")}>
            Continue to dashboard
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => router.push("/login")}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="space-y-3 text-sm text-slate-600">
        <p className={alertErrorClass} role="alert">
          This link is invalid or has expired. Request a new reset from the login page (Forgot password?).
        </p>
        <Button type="button" variant="secondary" className="w-full" onClick={() => router.push("/login")}>
          Back to sign in
        </Button>
      </div>
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
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </Button>
    </form>
  );
}
