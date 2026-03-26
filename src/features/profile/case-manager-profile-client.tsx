"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect } from "react";
import { signOutAction } from "@/app/actions/auth";
import { updateCaseManagerProfile, type ProfileSaveState } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AppUserRow } from "@/types/database";
import { cn } from "@/lib/utils/cn";

const inputLikeSelect =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition-colors duration-150 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

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
  if (role === "admin") return "Administrator";
  return "Case manager";
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
  return (
    <div className="space-y-8">
      {passwordJustUpdated ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {`Your password was updated. The separate "password changed" email is only a security confirmation; it does not contain a reset link.`}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-500/90 text-lg font-semibold text-white shadow-sm"
          aria-hidden
        >
          {profileInitials(profile)}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-slate-900">
            {profile.display_name?.trim() || profile.email}
          </p>
          <p className="text-sm text-slate-600">{formatWorkspaceRole(profile.role)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Profile last updated{" "}
            {new Date(profile.updated_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-8">
        {saveState.message ?
          <div
            role="status"
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              saveState.ok ?
                "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900",
            )}
          >
            {saveState.message}
          </div>
        : null}

        <Card className="p-5 sm:p-6">
          <CardTitle>Profile information</CardTitle>
          <p className="mt-1 text-sm text-slate-600">
            How you appear in the workspace. Your sign-in email is managed separately (see Account).
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="display_name">Full name</Label>
              <Input
                id="display_name"
                name="display_name"
                defaultValue={profile.display_name ?? ""}
                className="mt-1.5"
                aria-invalid={!!saveState.fieldErrors?.display_name}
              />
              {saveState.fieldErrors?.display_name ?
                <p className="mt-1 text-xs text-red-600">{saveState.fieldErrors.display_name}</p>
              : null}
            </div>
            <div>
              <Label htmlFor="job_title">Job title</Label>
              <Input
                id="job_title"
                name="job_title"
                defaultValue={profile.job_title ?? ""}
                className="mt-1.5"
                aria-invalid={!!saveState.fieldErrors?.job_title}
              />
              {saveState.fieldErrors?.job_title ?
                <p className="mt-1 text-xs text-red-600">{saveState.fieldErrors.job_title}</p>
              : null}
            </div>
            <div>
              <Label htmlFor="organization">Organization</Label>
              <Input
                id="organization"
                name="organization"
                defaultValue={profile.organization ?? ""}
                className="mt-1.5"
                aria-invalid={!!saveState.fieldErrors?.organization}
              />
              {saveState.fieldErrors?.organization ?
                <p className="mt-1 text-xs text-red-600">{saveState.fieldErrors.organization}</p>
              : null}
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={profile.phone ?? ""}
                className="mt-1.5"
                autoComplete="tel"
                aria-invalid={!!saveState.fieldErrors?.phone}
              />
              {saveState.fieldErrors?.phone ?
                <p className="mt-1 text-xs text-red-600">{saveState.fieldErrors.phone}</p>
              : null}
            </div>
            <div>
              <Label htmlFor="pronouns">Pronouns (optional)</Label>
              <Input
                id="pronouns"
                name="pronouns"
                defaultValue={profile.pronouns ?? ""}
                className="mt-1.5"
                aria-invalid={!!saveState.fieldErrors?.pronouns}
              />
              {saveState.fieldErrors?.pronouns ?
                <p className="mt-1 text-xs text-red-600">{saveState.fieldErrors.pronouns}</p>
              : null}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="service_area">Service area / office</Label>
              <Input
                id="service_area"
                name="service_area"
                defaultValue={profile.service_area ?? ""}
                className="mt-1.5"
                aria-invalid={!!saveState.fieldErrors?.service_area}
              />
              {saveState.fieldErrors?.service_area ?
                <p className="mt-1 text-xs text-red-600">{saveState.fieldErrors.service_area}</p>
              : null}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="bio">Short bio or notes (optional)</Label>
              <Textarea
                id="bio"
                name="bio"
                rows={4}
                defaultValue={profile.bio ?? ""}
                className="mt-1.5"
                aria-invalid={!!saveState.fieldErrors?.bio}
              />
              {saveState.fieldErrors?.bio ?
                <p className="mt-1 text-xs text-red-600">{saveState.fieldErrors.bio}</p>
              : null}
            </div>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <CardTitle>Work preferences</CardTitle>
          <p className="mt-1 text-sm text-slate-600">
            Defaults for how you work; these can inform workflows later.
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="preferred_contact_method">Preferred contact method</Label>
              <select
                id="preferred_contact_method"
                name="preferred_contact_method"
                defaultValue={profile.preferred_contact_method ?? ""}
                className={cn("mt-1.5", inputLikeSelect)}
                aria-invalid={!!saveState.fieldErrors?.preferred_contact_method}
              >
                <option value="">No preference</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="either">Either</option>
              </select>
              {saveState.fieldErrors?.preferred_contact_method ?
                <p className="mt-1 text-xs text-red-600">
                  {saveState.fieldErrors.preferred_contact_method}
                </p>
              : null}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes_signature">Default case note sign-off (optional)</Label>
              <Textarea
                id="notes_signature"
                name="notes_signature"
                rows={2}
                defaultValue={profile.notes_signature ?? ""}
                className="mt-1.5"
                aria-invalid={!!saveState.fieldErrors?.notes_signature}
              />
              {saveState.fieldErrors?.notes_signature ?
                <p className="mt-1 text-xs text-red-600">
                  {saveState.fieldErrors.notes_signature}
                </p>
              : null}
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSavePending} className="min-w-[8rem]">
            {isSavePending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <CardTitle>Account</CardTitle>
          <p className="mt-1 text-sm text-slate-600">
            Read-only sign-in details from your account. Email syncs from authentication.
          </p>
          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="font-medium text-slate-700">Email</dt>
              <dd className="mt-0.5 text-slate-600">{profile.email}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Role</dt>
              <dd className="mt-0.5 text-slate-600">{formatWorkspaceRole(profile.role)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">User ID</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-slate-500">{profile.id}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Member since</dt>
              <dd className="mt-0.5 text-slate-600">
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  dateStyle: "long",
                })}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5 sm:p-6">
          <CardTitle>Account actions</CardTitle>
          <div className="mt-6">
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="w-full sm:w-auto">
                Sign out
              </Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Ends your session and returns you to the login page.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
