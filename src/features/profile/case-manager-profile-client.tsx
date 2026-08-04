"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect } from "react";
import { CheckCircle2, LogOut, Save } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { updateCaseManagerProfile, type ProfileSaveState } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectInputClass } from "@/lib/ui/form-classes";
import { cn } from "@/lib/utils/cn";
import type { AppUserRow } from "@/types/database";

const initialSaveState: ProfileSaveState = { ok: false, message: null };

function profileInitials(profile: AppUserRow): string {
  const name = profile.display_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const email = profile.email?.trim() ?? "";
  return email.slice(0, 2).toUpperCase() || "?";
}

function formatWorkspaceRole(role: string): string {
  return role === "admin" ? "Administrator" : "Case manager";
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="mt-1.5 text-xs font-medium text-[var(--color-error)]">{message}</p> : null;
}

export function CaseManagerProfileClient({ profile }: { profile: AppUserRow }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordJustUpdated = searchParams.get("passwordUpdated") === "1";

  useEffect(() => {
    if (!passwordJustUpdated) return;
    router.replace("/profile", { scroll: false });
  }, [passwordJustUpdated, router]);

  const [saveState, formAction, isSavePending] = useActionState(
    updateCaseManagerProfile,
    initialSaveState,
  );
  const displayName = profile.display_name?.trim() || profile.email;
  const updatedAt = new Date(profile.updated_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="mt-8 space-y-5">
      {passwordJustUpdated ? (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-[var(--color-positive-rule)] bg-[var(--color-positive-bg)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-2)]">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
          Your password was updated. The separate email is a security confirmation and does not contain another reset link.
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)] md:items-start lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-5 md:sticky md:top-8" aria-label="Account summary">
          <div className="grid size-14 place-items-center rounded-xl bg-[var(--color-accent)] text-base font-semibold text-[var(--color-accent-ink)] [box-shadow:var(--shadow-action)]" aria-hidden>
            {profileInitials(profile)}
          </div>
          <h2 className="mt-5 break-words text-lg font-semibold tracking-[-0.02em] text-[var(--color-ink)]">{displayName}</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{formatWorkspaceRole(profile.role)}</p>
          {profile.organization?.trim() ? <p className="mt-1 text-sm text-[var(--color-ink-faint)]">{profile.organization}</p> : null}

          <dl className="mt-6 divide-y divide-[var(--color-rule-soft)] border-y border-[var(--color-rule-soft)] text-sm">
            <div className="py-3.5">
              <dt className="text-xs font-semibold text-[var(--color-ink-faint)]">Sign-in email</dt>
              <dd className="mt-1 break-words text-[var(--color-ink-2)]">{profile.email}</dd>
            </div>
            <div className="py-3.5">
              <dt className="text-xs font-semibold text-[var(--color-ink-faint)]">Member since</dt>
              <dd className="mt-1 text-[var(--color-ink-2)]">
                {new Date(profile.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
              </dd>
            </div>
          </dl>

          <form action={signOutAction} className="mt-5">
            <Button type="submit" variant="outline" className="flex min-h-10 w-full items-center justify-center gap-2">
              <LogOut className="size-4" aria-hidden /> Sign out
            </Button>
          </form>
        </aside>

        <form action={formAction} className="overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] [box-shadow:var(--shadow-surface)]">
          {saveState.message ? (
            <div role="status" className={cn("mx-5 mt-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm sm:mx-6 sm:mt-6", saveState.ok ? "border-[var(--color-positive-rule)] bg-[var(--color-positive-bg)] text-[var(--color-ink-2)]" : "border-[var(--color-error-rule)] bg-[var(--color-error-bg)] text-[var(--color-error)]")}>
              {saveState.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" aria-hidden /> : null}
              {saveState.message}
            </div>
          ) : null}

          <section className="p-5 sm:p-6" aria-labelledby="profile-information-title">
            <h2 id="profile-information-title" className="text-lg font-semibold tracking-[-0.02em] text-[var(--color-ink)]">Profile information</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">The details colleagues see when you work in CaseLink.</p>

            <div className="mt-6 grid gap-x-5 gap-y-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="display_name">Full name</Label>
                <Input id="display_name" name="display_name" defaultValue={profile.display_name ?? ""} className="mt-1.5 min-h-11" aria-invalid={!!saveState.fieldErrors?.display_name} aria-describedby={saveState.fieldErrors?.display_name ? "display-name-error" : undefined} />
                <FieldError id="display-name-error" message={saveState.fieldErrors?.display_name} />
              </div>
              <div>
                <Label htmlFor="job_title">Job title</Label>
                <Input id="job_title" name="job_title" defaultValue={profile.job_title ?? ""} className="mt-1.5 min-h-11" aria-invalid={!!saveState.fieldErrors?.job_title} aria-describedby={saveState.fieldErrors?.job_title ? "job-title-error" : undefined} />
                <FieldError id="job-title-error" message={saveState.fieldErrors?.job_title} />
              </div>
              <div>
                <Label htmlFor="organization">Organization</Label>
                <Input id="organization" name="organization" defaultValue={profile.organization ?? ""} className="mt-1.5 min-h-11" aria-invalid={!!saveState.fieldErrors?.organization} aria-describedby={saveState.fieldErrors?.organization ? "organization-error" : undefined} />
                <FieldError id="organization-error" message={saveState.fieldErrors?.organization} />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} className="mt-1.5 min-h-11" autoComplete="tel" aria-invalid={!!saveState.fieldErrors?.phone} aria-describedby={saveState.fieldErrors?.phone ? "phone-error" : undefined} />
                <FieldError id="phone-error" message={saveState.fieldErrors?.phone} />
              </div>
              <div>
                <Label htmlFor="pronouns">Pronouns <span className="font-normal text-[var(--color-ink-faint)]">(optional)</span></Label>
                <Input id="pronouns" name="pronouns" defaultValue={profile.pronouns ?? ""} className="mt-1.5 min-h-11" aria-invalid={!!saveState.fieldErrors?.pronouns} aria-describedby={saveState.fieldErrors?.pronouns ? "pronouns-error" : undefined} />
                <FieldError id="pronouns-error" message={saveState.fieldErrors?.pronouns} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="service_area">Service area or office</Label>
                <Input id="service_area" name="service_area" defaultValue={profile.service_area ?? ""} className="mt-1.5 min-h-11" aria-invalid={!!saveState.fieldErrors?.service_area} aria-describedby={saveState.fieldErrors?.service_area ? "service-area-error" : undefined} />
                <FieldError id="service-area-error" message={saveState.fieldErrors?.service_area} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="bio">Short bio or notes <span className="font-normal text-[var(--color-ink-faint)]">(optional)</span></Label>
                <Textarea id="bio" name="bio" rows={4} defaultValue={profile.bio ?? ""} className="mt-1.5" aria-invalid={!!saveState.fieldErrors?.bio} aria-describedby={saveState.fieldErrors?.bio ? "bio-error" : undefined} />
                <FieldError id="bio-error" message={saveState.fieldErrors?.bio} />
              </div>
            </div>
          </section>

          <section className="border-t border-[var(--color-rule)] p-5 sm:p-6" aria-labelledby="work-preferences-title">
            <h2 id="work-preferences-title" className="text-lg font-semibold tracking-[-0.02em] text-[var(--color-ink)]">Work preferences</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">Save defaults for contact and case-note workflows.</p>
            <div className="mt-6 grid gap-x-5 gap-y-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="preferred_contact_method">Preferred contact method</Label>
                <select id="preferred_contact_method" name="preferred_contact_method" defaultValue={profile.preferred_contact_method ?? ""} className={cn("mt-1.5 min-h-11", selectInputClass)} aria-invalid={!!saveState.fieldErrors?.preferred_contact_method} aria-describedby={saveState.fieldErrors?.preferred_contact_method ? "contact-method-error" : undefined}>
                  <option value="">No preference</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="either">Either</option>
                </select>
                <FieldError id="contact-method-error" message={saveState.fieldErrors?.preferred_contact_method} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes_signature">Default case-note sign-off <span className="font-normal text-[var(--color-ink-faint)]">(optional)</span></Label>
                <Textarea id="notes_signature" name="notes_signature" rows={2} defaultValue={profile.notes_signature ?? ""} className="mt-1.5" aria-invalid={!!saveState.fieldErrors?.notes_signature} aria-describedby={saveState.fieldErrors?.notes_signature ? "notes-signature-error" : undefined} />
                <FieldError id="notes-signature-error" message={saveState.fieldErrors?.notes_signature} />
              </div>
            </div>
          </section>

          <footer className="flex flex-col gap-4 border-t border-[var(--color-rule)] bg-[var(--color-paper)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs leading-5 text-[var(--color-ink-faint)]">Last updated {updatedAt}</p>
            <Button type="submit" disabled={isSavePending} className="inline-flex min-h-11 items-center justify-center gap-2 sm:min-w-[9rem]">
              <Save className="size-4" aria-hidden /> {isSavePending ? "Saving…" : "Save changes"}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
