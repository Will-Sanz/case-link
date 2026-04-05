"use server";

import { revalidatePath } from "next/cache";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { isDev } from "@/lib/env/runtime";
import { publicMessageFromSupabaseError } from "@/lib/errors/public-action-error";
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
        message: publicMessageFromSupabaseError(error, "Could not save profile. Try again."),
      };
    }

    revalidatePath("/profile");
    return { ok: true, message: "Profile saved." };
  } catch (e) {
    if (isDev() && e instanceof Error) {
      return { ok: false, message: e.message };
    }
    return { ok: false, message: "Something went wrong." };
  }
}
