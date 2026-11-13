import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { intakeSchema, mandateSchema, reusedZipSourceSchema, type ServiceMandate, type SupportIntake } from "./domain";
import { WIC_APPLICATION_NOTICE_VERSION } from "./constants";
import { wicApplicationFieldsValueSchema } from "./wic-application-fields";

export { WIC_APPLICATION_NOTICE_VERSION } from "./constants";
export const wicInitialIntakeSchema = intakeSchema.superRefine((value, context) => {
  if (value.needs.length !== 1 || value.needs[0] !== "wic_new" || value.householdSize !== null ||
    value.incomeAmount !== null || value.incomeFrequency !== "unknown" || value.utilityProviders.length || value.shutoffDate !== null || value.accountAuthority !== "self")
    context.addIssue({ code: "custom", message: "Start WIC preparation with only its current routing information." });
});
export { wicApplicationWriteSchema, wicApplicationSnapshotSchema } from "./wic-application-snapshot";
export type { WicApplicationSnapshot } from "./wic-application-snapshot";
import { wicApplicationWriteSchema, wicApplicationSnapshotSchema, type WicApplicationSnapshot } from "./wic-application-snapshot";
const columns = "id,request_id,revision,base_version,request_version,details,provenance,source,consent_evidence,notice_version,created_at,idempotency_key";
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("parent_invalid_input");
  return result.data;
}
function check(error: unknown) {
  if (!error) return;
  const code = typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "40001") throw new Error("This request changed. Reload it before saving your update.");
  if (code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  if (code === "23514" || code === "22023") throw new Error("parent_invalid_input");
  if (code === "P0001" && typeof error === "object" && error && "message" in error && error.message === "parent_reuse_source_changed")
    throw new Error("parent_reuse_source_changed");
  throw new Error("CaseLink could not save or load this information. Please try again.");
}
export async function getWicApplicationDetails(requestId: string, revisionId?: string): Promise<WicApplicationSnapshot | null> {
  parse(z.uuid(), requestId);
  if (revisionId) parse(z.uuid(), revisionId);
  const { supabase } = await requireParentSession();
  let query = supabase.from("parent_wic_application_details").select(columns).eq("request_id", requestId);
  if (revisionId) query = query.eq("id", revisionId);
  const { data, error } = await query.order("revision", { ascending: false }).limit(1).maybeSingle();
  check(error);
  if (!data) return null;
  const snapshot = wicApplicationSnapshotSchema.safeParse(data);
  if (!snapshot.success) throw new Error("CaseLink could not load this information. Please try again.");
  return snapshot.data;
}
export async function saveWicApplicationDetails(requestId: string, input: unknown, idempotencyKey: string): Promise<string> {
  const value = parse(wicApplicationWriteSchema, input);
  parse(z.uuid(), requestId); parse(z.uuid(), idempotencyKey);
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_save_wic_application_details", {
    p_request_id: requestId, p_expected_version: value.expectedVersion, p_details: value.details,
    p_notice_version: value.noticeVersion, p_idempotency_key: idempotencyKey,
    p_subject_authority_declared: value.subjectAuthorityDeclared,
  });
  check(error);
  return parse(z.uuid(), data);
}
export async function startWicApplication(intake: SupportIntake, mandate: ServiceMandate, details: unknown, noticeVersion: string, subjectAuthorityDeclared: boolean, idempotencyKey: string, reusedZip?: unknown): Promise<string> {
  const value = parse(z.object({ intake: wicInitialIntakeSchema, mandate: mandateSchema, details: wicApplicationFieldsValueSchema,
    noticeVersion: z.literal(WIC_APPLICATION_NOTICE_VERSION), subjectAuthorityDeclared: z.literal(true), idempotencyKey: z.uuid(), reusedZip: reusedZipSourceSchema.optional() }).strict(),
  { intake, mandate, details, noticeVersion, subjectAuthorityDeclared, idempotencyKey, reusedZip });
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_start_wic_application", {
    p_intake: value.intake, p_mandate: value.mandate, p_details: value.details, p_notice_version: value.noticeVersion, p_idempotency_key: value.idempotencyKey,
    p_subject_authority_declared: value.subjectAuthorityDeclared,
    ...(value.reusedZip ? { p_source_request_id: value.reusedZip.sourceRequestId, p_source_version: value.reusedZip.sourceVersion } : {}),
  });
  check(error);
  return parse(z.uuid(), data);
}
