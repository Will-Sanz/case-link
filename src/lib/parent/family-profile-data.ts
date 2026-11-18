import "server-only";
import { z } from "zod";
import { createParentClient, requireParentSession } from "./auth";
import { getParentDeletionStatus } from "./account-deletion";
import { familyProfileBindingsSchema, familyProfileClearSchema, familyProfileReadSchema, familyProfileWriteSchema } from "./family-profile";
function check(error: unknown) {
  if (!error) return;
  const code = typeof error === "object" && "code" in error ? error.code : null;
  if (code === "40001") throw new Error("This request changed. Reload your family profile before saving.");
  if (code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  if (["23514", "22023"].includes(String(code))) throw new Error("parent_invalid_input");
  throw new Error("CaseLink could not confirm your family profile. Please try again.");
}
export async function getFamilyProfile() {
  const supabase = await createParentClient();
  const identity = await getParentDeletionStatus(supabase);
  const { data, error } = await supabase.rpc("parent_get_family_profile"); check(error);
  const parsed = familyProfileReadSchema.safeParse(data); if (!parsed.success || parsed.data.ownerId !== identity.ownerId) throw new Error("CaseLink could not load your family profile. Please try again."); return parsed.data;
}
export async function getFamilyProfileSources(requestId: string, expectedVersion: number) {
  const request = z.uuid().parse(requestId).toLowerCase(), version = z.number().int().positive().max(2147483647).parse(expectedVersion);
  const client = await createParentClient();
  await getParentDeletionStatus(client);
  const { data, error } = await client.rpc("parent_get_family_profile_sources", { p_request_id: request, p_expected_version: version });
  check(error);
  const parsed = familyProfileBindingsSchema.safeParse(data);
  if (!parsed.success) throw new Error("CaseLink could not load the saved family sources. Please try again.");
  return parsed.data;
}
export async function saveFamilyProfile(input: unknown, idempotencyKey: string): Promise<number> {
  const value = familyProfileWriteSchema.parse(input), key = z.uuid().parse(idempotencyKey);
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_save_family_profile", { p_expected_owner: value.expectedOwnerId, p_expected_revision: value.expectedRevision, p_details: value.details,
    p_notice_version: value.noticeVersion, p_consent_accepted: value.consentAccepted, p_subject_authority_declared: value.subjectAuthorityDeclared, p_confirmed_paths: value.confirmedPaths ?? [], p_idempotency_key: key });
  check(error); return z.number().int().positive().parse(data);
}
export async function clearFamilyProfile(input: unknown, idempotencyKey: string): Promise<number> {
  const value = familyProfileClearSchema.parse(input), key = z.uuid().parse(idempotencyKey);
  const supabase = await createParentClient();
  const identity = await getParentDeletionStatus(supabase);
  if (identity.ownerId !== value.expectedOwnerId) throw new Error("This request is unavailable, or its permission has changed.");
  const { data, error } = await supabase.rpc("parent_clear_family_profile", { p_expected_owner: value.expectedOwnerId, p_expected_revision: value.expectedRevision, p_idempotency_key: key });
  check(error); return z.number().int().nonnegative().parse(data);
}
