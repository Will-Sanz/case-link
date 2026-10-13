"use client";

import { clearLocalActionDrafts } from "@/lib/domain/plan/local-action-draft";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Factor } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass, selectInputClass } from "@/lib/ui/form-classes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function MfaForm({ required, manage, nextPath }: { required: boolean; manage: boolean; nextPath: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [reload, setReload] = useState(0);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [aal2, setAal2] = useState(false);
  const [selected, setSelected] = useState("");
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [removal, setRemoval] = useState<Factor | null>(null);
  const [signOutRequired, setSignOutRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void (async () => {
      try {
        const client = createSupabaseBrowserClient();
        const [listed, assurance] = await Promise.all([client.auth.mfa.listFactors(), client.auth.mfa.getAuthenticatorAssuranceLevel()]);
        if (listed.error || assurance.error || !assurance.data.currentLevel) throw new Error();
        if (!active) return;
        setFactors(listed.data.all);
        setSelected(listed.data.totp[0]?.id ?? "");
        setAal2(assurance.data.currentLevel === "aal2");
        setError(null);
        setStatus("ready");
      } catch {
        if (active) {
          setError("We couldn't load account verification. Try again or sign out.");
          setStatus("unavailable");
        }
      }
    })();
    return () => { active = false; mounted.current = false; };
  }, [reload]);

  async function signOut() {
    clearLocalActionDrafts();
    const result = await createSupabaseBrowserClient().auth.signOut({ scope: "global" });
    if (result.error) throw result.error;
    if (mounted.current) { router.replace("/login"); router.refresh(); }
  }

  async function run(operation: () => Promise<void>, failureMessage: string) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try { await operation(); }
    catch { if (mounted.current) setError(failureMessage); }
    finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function startSetup() {
    await run(async () => {
      try {
        const result = await createSupabaseBrowserClient().auth.mfa.enroll({ factorType: "totp", friendlyName: "CaseLink authenticator", issuer: "CaseLink" });
        if (result.error || !result.data.totp.qr_code.startsWith("data:image/svg+xml;")) throw new Error();
        if (mounted.current) setEnrollment({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret });
      } catch {
        if (mounted.current) setStatus("unavailable");
        throw new Error();
      }
    }, "We couldn't start setup. Reload verification methods to recover any unfinished setup, then try again.");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError("Enter the six-digit code from your authenticator app."); return; }
    const factorId = enrollment?.id ?? selected;
    if (!factorId) { setError("Choose an authenticator first."); return; }
    await run(async () => {
      const client = createSupabaseBrowserClient();
      const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (result.error) throw result.error;
      if (!mounted.current) return;
      setEnrollment(null);
      setCode("");
      const access = await client.rpc("has_required_mfa");
      if (access.error || access.data !== true) { setStatus("unavailable"); throw new Error(); }
      if (!mounted.current) return;
      if (manage) { setStatus("loading"); setReload((value) => value + 1); }
      else { router.replace(nextPath); router.refresh(); }
    }, "We couldn't confirm verification. Use a current code and try again, or reload verification methods if you already verified it.");
  }

  async function removeFactor() {
    if (!removal) return;
    await run(async () => {
      const result = await createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: removal.id });
      if (result.error) throw result.error;
      if (!mounted.current) return;
      setRemoval(null);
      setEnrollment(null);
      setCode("");
      setSignOutRequired(true);
      await signOut();
    }, "Removal or sign-out could not be confirmed. Check the current state and try again. If removal succeeded, finish signing out below.");
  }

  const verified = factors.filter((factor) => factor.status === "verified");
  const verifiedTotp = verified.filter((factor) => factor.factor_type === "totp");
  const unfinished = factors.filter((factor) => factor.status === "unverified");
  const canContinue = (!required && verified.length === 0) || (aal2 && verified.length > 0);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Two-step verification</h2>
      {required ? <p className="text-sm">Administrator accounts require an authenticator code before opening casework.</p> : null}
      {error && !removal ? <p role="alert" className={alertErrorClass}>{error}</p> : null}
      {signOutRequired ? <p role="status">The authenticator was removed. Finish signing out before continuing.</p> : <>
        {status === "loading" ? <p role="status">Loading verification methods…</p> : null}
        {status === "ready" ? <>
          {enrollment ? <div className="space-y-3">
            <p className="text-sm">Scan this QR code with your authenticator app, then enter its six-digit code. Keep the setup key private.</p>
            <Image src={enrollment.qr} alt="Authenticator setup QR code" width={200} height={200} unoptimized />
            <details><summary className="cursor-pointer text-sm underline">Enter the setup key manually</summary><code className="mt-2 block break-all">{enrollment.secret}</code></details>
          </div> : null}
          {!enrollment && verified.length === 0 && unfinished.length === 0 ? <Button disabled={pending} onClick={() => void startSetup()}>Set up an authenticator</Button> : null}
          {verified.length > 0 && verifiedTotp.length === 0 && !aal2 ? <p role="alert">This account uses a verification method that the pilot does not support. Contact your school administrator for recovery.</p> : null}
          {enrollment || (verifiedTotp.length > 0 && !aal2) ? <form onSubmit={verify} className="space-y-3">
            {!enrollment && verifiedTotp.length > 1 ? <div>
              <Label htmlFor="mfa-method">Authenticator</Label>
              <select id="mfa-method" className={selectInputClass} value={selected} onChange={(event) => setSelected(event.target.value)}>{verifiedTotp.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendly_name || `Authenticator ${index + 1}`}</option>)}</select>
            </div> : null}
            <div><Label htmlFor="mfa-code">Authenticator code</Label><Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} /></div>
            <Button type="submit" disabled={pending}>{pending ? "Verifying…" : "Verify code"}</Button>
          </form> : null}
          {!enrollment && canContinue ? <Button disabled={pending} onClick={() => { router.replace(nextPath); router.refresh(); }}>Continue</Button> : null}
          {manage && aal2 ? verified.map((factor, index) => <div key={factor.id} className="flex items-center justify-between gap-2 text-sm"><span>{factor.friendly_name || `Authenticator ${index + 1}`}</span><Button variant="outline" disabled={pending} onClick={() => setRemoval(factor)}>Remove authenticator</Button></div>) : null}
          {!enrollment ? unfinished.map((factor) => <div key={factor.id} className="space-y-2 text-sm"><p>An earlier setup was not finished. Discard it before starting again.</p><Button variant="outline" disabled={pending} onClick={() => setRemoval(factor)}>Discard unfinished setup</Button></div>) : null}
        </> : null}
        {!enrollment && status !== "loading" ? <Button variant="outline" disabled={pending} onClick={() => { setStatus("loading"); setReload((value) => value + 1); }}>Reload verification methods</Button> : null}
        <p className="text-sm text-[var(--public-ink-muted)]">Lost your authenticator? Contact your school administrator. Account recovery requires an identity check; an email reset alone does not remove two-step verification.</p>
      </>}
      <Button variant="outline" disabled={pending} onClick={() => void run(signOut, "Sign-out could not be confirmed. Please try again.")}>{signOutRequired ? "Finish signing out" : "Sign out"}</Button>
      <ConfirmDialog open={removal !== null} onClose={() => setRemoval(null)} onConfirm={() => void removeFactor()} title="Remove this authenticator?" description="This removes the selected setup and signs you out on all devices. Administrators must set up an authenticator again before opening casework." confirmLabel="Remove and sign out" pending={pending} error={error} danger />
    </div>
  );
}
