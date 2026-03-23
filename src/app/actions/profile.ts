"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { parseProfileFormData, profileUpdateSchema } from "@/lib/validation/profile";

export type ProfileSaveState = {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
};

export async function updateCaseManagerProfile(
  _prev: ProfileSaveState,
  formData: FormData,
): Promise<ProfileSaveState> {
  const parsed = profileUpdateSchema.safeParse(parseProfileFormData(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      ok: false,
      message: "Fix the highlighted fields and try again.",
      fieldErrors,
    };
  }

  try {
    const { user, supabase } = await requireAppUserWithClient();
    const payload = parsed.data;
    const { error } = await supabase
      .from("app_users")
      .update({
        display_name: payload.display_name,
        job_title: payload.job_title,
        organization: payload.organization,
        phone: payload.phone,
        pronouns: payload.pronouns,
        service_area: payload.service_area,
        bio: payload.bio,
        preferred_contact_method: payload.preferred_contact_method,
        notes_signature: payload.notes_signature,
      })
      .eq("id", user.id);

    if (error) {
      return {
        ok: false,
        message: error.message || "Could not save profile. Try again.",
      };
    }

    revalidatePath("/profile");
    return { ok: true, message: "Profile saved." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    return { ok: false, message: msg };
  }
}

export type PasswordResetState = { ok: boolean; message: string };

/**
 * Sends Supabase password recovery email for the signed-in user's address.
 * Requires the redirect URL to be allowed in Supabase Auth → URL configuration.
 */
export async function requestPasswordResetEmail(): Promise<PasswordResetState> {
  try {
    const { supabase, user } = await requireAppUserWithClient();
    const email = user.email?.trim();
    if (!email) {
      return { ok: false, message: "No email on file for this account." };
    }

    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) {
      return {
        ok: false,
        message: "Could not determine site URL for the reset link. Contact support.",
      };
    }
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = `${proto}://${host}`;
    const next = "/profile";
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return {
      ok: true,
      message: `Check ${email} for a link to reset your password.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not send reset email.";
    return { ok: false, message: msg };
  }
}
