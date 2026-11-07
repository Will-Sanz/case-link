import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { intakeSchema, mandateSchema, type ServiceMandate, type SupportIntake } from "./domain";
import { snapApplicationFieldsValueSchema } from "./snap-application-fields";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { snapApplicationLeaves, snapApplicationSnapshotSchema } from "./snap-application-snapshot";
export type { SnapApplicationSnapshot } from "./snap-application-snapshot";
import type { SnapApplicationSnapshot } from "./snap-application-snapshot";

export { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
export const snapApplicationWriteSchema = z.object({
  expectedVersion: z.number().int().positive(),
  details: snapApplicationFieldsValueSchema,
  noticeVersion: z.literal(SNAP_APPLICATION_NOTICE_VERSION),
  confirmedPaths: z.array(z.string().min(1).max(200)).max(2000).refine(paths => new Set(paths).size === paths.length).optional(),
}).strict().superRefine((value, ctx) => {
  const leaves = snapApplicationLeaves(value.details);
  if (value.confirmedPaths?.some(path => !Object.hasOwn(leaves, path)))
    ctx.addIssue({ code: "custom", path: ["confirmedPaths"], message: "Check the current facts to update." });
});
const uuid = z.uuid();
const snapshotColumns = "id,request_id,revision,base_version,request_version,details,provenance,source,notice_version,created_at,idempotency_key,confirmed_paths";

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
  throw new Error("CaseLink could not save or load this information. Please try again.");
}

export async function getSnapApplicationDetails(requestId: string, revisionId?: string): Promise<SnapApplicationSnapshot | null> {
  parse(uuid, requestId);
  if (revisionId) parse(uuid, revisionId);
  const { supabase } = await requireParentSession();
  let query = supabase.from("parent_snap_application_details").select(snapshotColumns).eq("request_id", requestId);
  if (revisionId) query = query.eq("id", revisionId);
  const { data, error } = await query.order("revision", { ascending: false }).limit(1).maybeSingle();
  check(error);
  if (!data) return null;
  const snapshot = snapApplicationSnapshotSchema.safeParse(data);
  if (!snapshot.success) throw new Error("CaseLink could not load this information. Please try again.");
  return snapshot.data;
}

export async function saveSnapApplicationDetails(requestId: string, input: unknown, idempotencyKey: string): Promise<string> {
  const value = parse(snapApplicationWriteSchema, input);
  parse(uuid, requestId); parse(uuid, idempotencyKey);
  const { supabase } = await requireParentSession();
  // The locked database write validates changed dates after checking exact, unsuperseded retries.
  const { data, error } = await supabase.rpc(value.confirmedPaths?.length ? "parent_reaffirm_snap_application_details" : "parent_save_snap_application_details", {
    p_request_id: requestId, p_expected_version: value.expectedVersion, p_details: value.details,
    p_notice_version: value.noticeVersion, p_idempotency_key: idempotencyKey,
    ...(value.confirmedPaths?.length ? { p_confirmed_paths: value.confirmedPaths } : {}),
  });
  check(error);
  return parse(uuid, data);
}

export async function startSnapApplication(intake: SupportIntake, mandate: ServiceMandate, details: unknown, noticeVersion: string, idempotencyKey: string): Promise<string> {
  const value = parse(z.object({ intake: intakeSchema, mandate: mandateSchema, details: snapApplicationFieldsValueSchema,
    noticeVersion: z.literal(SNAP_APPLICATION_NOTICE_VERSION), idempotencyKey: uuid }).strict(), { intake, mandate, details, noticeVersion, idempotencyKey });
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_start_snap_application", {
    p_intake: value.intake, p_mandate: value.mandate, p_details: value.details,
    p_notice_version: value.noticeVersion, p_idempotency_key: value.idempotencyKey,
  });
  check(error);
  return parse(uuid, data);
}
