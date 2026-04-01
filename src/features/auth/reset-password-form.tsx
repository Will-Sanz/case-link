"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass, alertInfoClass } from "@/lib/ui/form-classes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 6;

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    const isRecoveryMode = searchParams.get("mode") === "recovery";
    const callbackError = searchParams.get("error");

    void (async () => {
      if (callbackError) {
        if (!active) return;
        setError("This reset link is invalid or expired. Request a new one to continue.");
        setStatus("invalid");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();

      if (!active) return;
      if (isRecoveryMode && data.session) {
        setStatus("ready");
        return;
      }

      setStatus("invalid");
    })();

    return () => {
      active = false;
    };
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("We couldn't update your password. Request a new reset link and try again.");
        return;
      }

      setInfo("Your password has been updated successfully.");
      setTimeout(() => {
        router.replace("/login?message=password-reset-success");
        router.refresh();
      }, 900);
    } finally {
      setPending(false);
    }
  }

  if (status === "checking") {
    return <p className="text-sm text-slate-500">Loading reset session…</p>;
  }

  if (status === "invalid") {
    return (
      <div className="space-y-4">
        <p className={alertErrorClass} role="alert">
          {error ??
            "This reset link is invalid or expired. Request a new password reset email to continue."}
        </p>
        <div className="flex justify-center">
          <Link
            href="/forgot-password"
            className="font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
          >
            Request a new reset link
          </Link>
        </div>
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
      {info ? (
        <p className={alertInfoClass} role="status">
          {info}
        </p>
      ) : null}
      <div>
        <Label htmlFor="reset-password">New password</Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1"
        />
        <p className="mt-1 text-xs text-slate-500">At least 6 characters.</p>
      </div>
      <div>
        <Label htmlFor="reset-confirm-password">Confirm new password</Label>
        <Input
          id="reset-confirm-password"
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
        {pending ? "Updating password…" : "Update password"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        Return to{" "}
        <Link
          href="/login"
          className="font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
        >
          sign in
        </Link>
      </p>
    </form>
  );
}
