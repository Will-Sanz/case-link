import { z } from "zod";

/** Trim; empty / whitespace-only → null for optional DB fields. */
function emptyToNull(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
}

export const profileUpdateSchema = z.object({
  display_name: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(120, "Max 120 characters")]),
  ),
  job_title: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(120, "Max 120 characters")]),
  ),
  organization: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(200, "Max 200 characters")]),
  ),
  phone: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(40, "Max 40 characters")]),
  ),
  pronouns: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(60, "Max 60 characters")]),
  ),
  service_area: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(200, "Max 200 characters")]),
  ),
  bio: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(4000, "Max 4000 characters")]),
  ),
  preferred_contact_method: z.preprocess(emptyToNull, z.union([z.null(), z.enum(["email", "phone", "either"])])),
  notes_signature: z.preprocess(
    emptyToNull,
    z.union([z.null(), z.string().trim().max(500, "Max 500 characters")]),
  ),
});

export type ProfileUpdatePayload = z.infer<typeof profileUpdateSchema>;

export function parseProfileFormData(formData: FormData): unknown {
  const rawContact = String(formData.get("preferred_contact_method") ?? "").trim();
  return {
    display_name: formData.get("display_name"),
    job_title: formData.get("job_title"),
    organization: formData.get("organization"),
    phone: formData.get("phone"),
    pronouns: formData.get("pronouns"),
    service_area: formData.get("service_area"),
    bio: formData.get("bio"),
    preferred_contact_method: rawContact === "" ? null : rawContact,
    notes_signature: formData.get("notes_signature"),
  };
}
