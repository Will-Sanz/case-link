"use client";

import { clearLocalActionDrafts } from "@/lib/domain/plan/local-action-draft";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass, alertInfoClass } from "@/lib/ui/form-classes";
import { PASSWORD_REQUIREMENTS, passwordMeetsPolicy } from "@/lib/auth/password-policy";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const callbackError = searchParams.get("error");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nonce, setNonce] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (callbackError || (mode !== "recovery" && mode !== "setup")) {
          if (active) setStatus("invalid");
          return;
        }
        const supabase = createSupabaseBrowserClient();
        const result = await supabase.auth.getSession();
        if (result.error) throw result.error;
        if (active) setStatus(result.data.session ? "ready" : "invalid");
      } catch {
        if (active) {
          setError("We couldn't verify this link. Reopen your email link to try again.");
          setStatus("invalid");
        }
      }
    })();
    return () => { active = false; };
  }, [mode, callbackError]);

  async function sendVerificationCode() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const { error: sendError } = await createSupabaseBrowserClient().auth.reauthenticate();
      if (sendError) throw sendError;
      setNonce("");
      setInfo("Check your account email for a verification code, then enter it below.");
    } catch {
      setError("We couldn't send a verification code. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function signOutAndRedirect(changed: boolean) {
    clearLocalActionDrafts();
    const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut({ scope: "global" });
    if (signOutError) throw signOutError;
    router.replace(changed ? "/login?message=password-reset-success" : "/login");
    router.refresh();
  }

  async function cancelReset() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await signOutAndRedirect(passwordUpdated);
    } catch {
      setError("Sign-out could not be confirmed. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || status !== "ready") return;
    setError(null);
    setInfo(null);
    if (!passwordUpdated) {
      if (!passwordMeetsPolicy(password)) { setError(PASSWORD_REQUIREMENTS); return; }
      if (password !== confirmPassword) { setError("Passwords do not match."); return; }
      if (needsVerification && !/^\d{6,8}$/.test(nonce)) { setError("Enter the verification code from your email."); return; }
    }
    submitting.current = true;
    setPending(true);
    let changed = passwordUpdated;
    try {
      const supabase = createSupabaseBrowserClient();
      if (!passwordUpdated) {
        const { error: updateError } = await supabase.auth.updateUser({ password, ...(needsVerification ? { nonce } : {}) });
        if (updateError) {
          if (updateError.code === "insufficient_aal") {
            setNeedsMfa(true);
            setError("Verify your authenticator code before changing this password.");
          } else if (updateError.code === "reauthentication_needed") {
            setNeedsVerification(true);
            setError("Confirm your identity before changing this password. Send a verification code below.");
          } else if (updateError.code === "reauthentication_not_valid") {
            setError("That verification code is invalid or expired. Check it or send a new code.");
          } else if (updateError.code === "weak_password") {
            setError(`That password was not accepted. Choose a different password. ${PASSWORD_REQUIREMENTS}`);
          } else if (updateError.code === "same_password") {
            setError("Choose a password different from your current password.");
          } else if (updateError.status === 401 || updateError.status === 403) {
            setStatus("invalid");
            setError("Your sign-in has expired. Request a new reset link to continue.");
          } else {
            setError("We couldn't update your password right now. Please try again.");
          }
          return;
        }
        changed = true;
        setPasswordUpdated(true);
        setPassword("");
        setConfirmPassword("");
        setNonce("");
      }
      await signOutAndRedirect(true);
    } catch {
      setError(changed
        ? "Your password was updated, but sign-out could not be confirmed. Retry signing out below."
        : "We couldn't update your password right now. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (status === "checking") return <p role="status" className="text-sm text-[var(--public-ink-muted)]">Checking your link…</p>;
  if (status === "invalid") return (
    <div className="space-y-4">
      <p className={alertErrorClass} role="alert">{error ?? "This reset link is invalid or expired. Request a new password reset email to continue."}</p>
      <div className="flex justify-center"><Link href="/forgot-password" className="font-medium text-[var(--public-accent)] underline-offset-2 hover:underline">Request a new reset link</Link></div>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <p className={alertErrorClass} role="alert">{error}</p> : null}
      {info ? <p className={alertInfoClass} role="status">{info}</p> : null}
      {needsMfa ? <p><Link className="font-medium underline underline-offset-2" href={`/verify-account?next=${encodeURIComponent(`/reset-password?mode=${mode === "setup" ? "setup" : "recovery"}`)}`}>Verify with your authenticator</Link></p> : null}
      {passwordUpdated ? <p role="status">Your password is updated. Finish signing out, then sign in with your new password.</p> : <>
        <div>
          <Label htmlFor="reset-password">New password</Label>
          <Input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={14} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" aria-describedby="password-requirements" />
          <p id="password-requirements" className="mt-1 text-xs text-[var(--public-ink-3)]">{PASSWORD_REQUIREMENTS}</p>
        </div>
        <div>
          <Label htmlFor="reset-confirm-password">Confirm new password</Label>
          <Input id="reset-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1" />
        </div>
        {needsVerification ? <div className="space-y-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => void sendVerificationCode()}>Send verification code</Button>
          <Label htmlFor="password-verification">Verification code</Label>
          <Input id="password-verification" name="nonce" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={nonce} onChange={(e) => setNonce(e.target.value)} />
        </div> : null}
      </>}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Please wait…" : passwordUpdated ? "Finish signing out" : "Update password"}</Button>
      <Button type="button" variant="outline" disabled={pending} className="w-full" onClick={() => void cancelReset()}>Cancel and return to sign in</Button>
    </form>
  );
}
