import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { intakeSchema, mandateSchema, reusedZipSourceSchema, type ServiceMandate, type SupportIntake } from "./domain";
import { pecoApplicationWriteSchema, pecoApplicationSnapshotSchema, pecoApplicationCollectionSchema, type PecoApplicationSnapshot } from "./peco-application-snapshot";

export { pecoApplicationWriteSchema, pecoApplicationSnapshotSchema } from "./peco-application-snapshot";
export const pecoInitialIntakeSchema = intakeSchema.superRefine((value, context) => {
  if (value.needs.length !== 1 || value.needs[0] !== "electricity" || value.householdSize !== null || value.incomeAmount !== null ||
    value.incomeFrequency !== "unknown" || value.utilityProviders.length !== 1 || value.utilityProviders[0] !== "peco" ||
    !["self", "authorized_caregiver"].includes(value.accountAuthority))
    context.addIssue({ code: "custom", message: "Start PECO preparation with only its current routing and account authority." });
});
const initialMandateSchema = mandateSchema.superRefine((value, context) => {
  if (value.mode !== "prepare_only" || value.recipientIds.length !== 1 || value.recipientIds[0] !== "peco-cap" ||
    !value.allowedActions.includes("prepare") || value.allowedData.length !== 3 || !["household", "income", "utility"].every(category => value.allowedData.includes(category as "household" | "income" | "utility")))
    context.addIssue({ code: "custom", message: "Use PECO-specific preparation permission for household, income and utility information." });
});
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
  if (code === "P0001" && typeof error === "object" && error && "message" in error && error.message === "parent_reuse_source_changed") throw new Error("parent_reuse_source_changed");
  throw new Error("CaseLink could not save or load this information. Please try again.");
}
export async function getPecoApplicationCollection() {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_peco_application_collection");
  const parsed = pecoApplicationCollectionSchema.safeParse(error ? null : data);
  return parsed.success ? parsed.data : { collectionEnabled: false as const, noticeVersion: null, expiresAt: null };
}
export async function getPecoApplicationDetails(requestId: string, revisionId?: string): Promise<PecoApplicationSnapshot | null> {
  parse(z.uuid(), requestId); if (revisionId) parse(z.uuid(), revisionId);
  const { supabase } = await requireParentSession();
  let query = supabase.from("parent_peco_application_details").select(columns).eq("request_id", requestId);
  if (revisionId) query = query.eq("id", revisionId);
  const { data, error } = await query.order("revision", { ascending: false }).limit(1).maybeSingle();
  check(error); if (!data) return null;
  const parsed = pecoApplicationSnapshotSchema.safeParse(data);
  if (!parsed.success) throw new Error("CaseLink could not load this information. Please try again.");
  return parsed.data;
}
export async function savePecoApplicationDetails(requestId: string, input: unknown, idempotencyKey: string): Promise<string> {
  const value = parse(pecoApplicationWriteSchema, input);
  parse(z.uuid(), requestId); parse(z.uuid(), idempotencyKey);
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_save_peco_application_details", {
    p_request_id: requestId, p_expected_version: value.expectedVersion, p_details: value.details, p_notice_version: value.noticeVersion,
    p_idempotency_key: idempotencyKey, p_subject_authority_declared: value.subjectAuthorityDeclared, p_account_authority_declared: value.accountAuthorityDeclared,
  });
  check(error); return parse(z.uuid(), data);
}
export async function startPecoApplication(intake: SupportIntake, mandate: ServiceMandate, input: unknown, idempotencyKey: string, reusedZip?: unknown): Promise<string> {
  const value = parse(z.object({ intake: pecoInitialIntakeSchema, mandate: initialMandateSchema,
    application: pecoApplicationWriteSchema.omit({ expectedVersion: true }), idempotencyKey: z.uuid(), reusedZip: reusedZipSourceSchema.optional() }).strict(),
  { intake, mandate, application: input, idempotencyKey, reusedZip });
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_start_peco_application", {
    p_intake: value.intake, p_mandate: value.mandate, p_details: value.application.details, p_notice_version: value.application.noticeVersion,
    p_idempotency_key: value.idempotencyKey, p_subject_authority_declared: value.application.subjectAuthorityDeclared,
    p_account_authority_declared: value.application.accountAuthorityDeclared,
    ...(value.reusedZip ? { p_source_request_id: value.reusedZip.sourceRequestId, p_source_version: value.reusedZip.sourceVersion } : {}),
  });
  check(error); return parse(z.uuid(), data);
}
