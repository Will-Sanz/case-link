"use client";

import { useState } from "react";
import { inviteStaff, type StaffInvitationResult } from "@/app/actions/staff-invitations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StaffInvitationForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<StaffInvitationResult | null>(null);
  const [copied, setCopied] = useState(false);
  async function invite(delivery: "email" | "link") {
    if (pending) return;
    setPending(true); setResult(null); setCopied(false);
    try { setResult(await inviteStaff({ email, delivery })); }
    catch { setResult({ ok: false, error: "The invitation could not be confirmed. Please try again." }); }
    finally { setPending(false); }
  }
  return (
    <section aria-labelledby="staff-invitation-heading" className="mt-8 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-5 sm:p-6">
      <h2 id="staff-invitation-heading" className="text-lg font-semibold text-[var(--color-ink)]">Invite a user</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">Invite a case manager to this workspace. Send an email, or create a link to share with them yourself. They will choose their own password.</p>
      <form className="mt-5 max-w-xl space-y-4" onSubmit={event => { event.preventDefault(); void invite("email"); }}>
        <div>
          <Label htmlFor="invite-email">Their email address</Label>
          <Input id="invite-email" type="email" autoComplete="off" required maxLength={254} disabled={pending} value={email} onChange={event => { setEmail(event.target.value); setResult(null); setCopied(false); }} className="mt-1.5 min-h-11" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending || !email.trim()} className="min-h-11">{pending ? "Preparing invitation…" : "Send invitation email"}</Button>
          <Button variant="secondary" disabled={pending || !email.trim()} onClick={() => void invite("link")} className="min-h-11">Create invite link</Button>
        </div>
        {result && !result.ok ? <p role="alert" className="text-sm text-[var(--color-error)]">{result.error}</p> : null}
        {result?.ok && result.status === "sent" ? <p role="status" className="text-sm text-[var(--color-ink)]">Invitation sent. Ask them to check their inbox and spam folder.</p> : null}
        {result?.ok && result.status === "existing" ? <p role="status" className="text-sm text-[var(--color-ink)]">This person already has an account. They can sign in or use Forgot password.</p> : null}
        {result?.ok && result.link ? <div className="space-y-3">
          <Label htmlFor="staff-invite-link">Invite link</Label>
          <Input id="staff-invite-link" readOnly value={result.link} onFocus={event => event.currentTarget.select()} className="min-h-11" aria-describedby="invite-link-help" />
          <p id="invite-link-help" className="text-xs leading-5 text-[var(--color-ink-muted)]">Share privately with the person whose email you entered. The link works once and expires after 15 minutes. Creating another link replaces the previous one.</p>
          <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(result.link!); setCopied(true); } catch { setCopied(false); } }} className="min-h-11">Copy invite link</Button>
          <p role="status" className="text-sm text-[var(--color-ink-muted)]">{copied ? "Link copied. Paste it into your email or message." : "You can also select and copy the link above."}</p>
        </div> : null}
      </form>
    </section>
  );
}
