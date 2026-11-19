import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { SNAP_PARENT_CERTIFICATION_ACTS, snapProtectedOperationSchema, type SnapProtectedOperation } from "./snap-protected-operation";
import { snapCaptureProgressScopeSchema } from "./snap-capture-progress";

const uuid = z.uuid().transform(value => value.toLowerCase());
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const snapSubmissionAuthorizationSchema = z.object({
  operationId: uuid,
  expectedVersion: z.number().int().min(1).max(2147483647),
  packetHash: digest,
  artifactId: uuid,
  contentSha256: digest,
}).strict();
export const snapProtectedSubmissionAuthorizationSchema = snapSubmissionAuthorizationSchema.omit({ artifactId: true }).extend({
  packetId: uuid,
  completedActs: z.array(z.enum(SNAP_PARENT_CERTIFICATION_ACTS)).length(2).refine(value => new Set(value).size === 2),
}).strict();
export const snapSubmissionDecisionSchema = z.union([snapSubmissionAuthorizationSchema, snapProtectedSubmissionAuthorizationSchema]);

/** Exact current owned review metadata only. No operator lookup, PDF bytes or new submission permission. */
export async function getSnapSubmissionReview(requestId: string, input: unknown): Promise<SnapProtectedOperation | null> {
  const id = uuid.parse(requestId), scope = snapCaptureProgressScopeSchema.parse(input);
  const { supabase } = await requireParentSession();
  const unconfirmed = "CaseLink could not confirm the current application review. Refresh before choosing Submit.";
  let result;
  try { result = await supabase.rpc("parent_get_snap_review", { p_request: id, p_version: scope.expectedVersion }); }
  catch { throw new Error(unconfirmed); }
  if (result.error?.code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  if (result.error) throw new Error(unconfirmed);
  if (result.data === null) return null;
  const parsed = snapProtectedOperationSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.requestId !== id || parsed.data.requestVersion !== scope.expectedVersion) throw new Error(unconfirmed);
  return parsed.data;
}

/** Record exact Submit and explicitly reported personal steps; this does not verify handwriting or establish filing. */
export async function authorizeSnapSubmission(requestId: string, input: unknown): Promise<string> {
  const id = uuid.safeParse(requestId);
  const value = snapSubmissionDecisionSchema.safeParse(input);
  if (!id.success || !value.success) throw new Error("parent_invalid_input");
  const { supabase } = await requireParentSession();
  const common = {
    p_request_id: id.data,
    p_operation_id: value.data.operationId,
    p_expected_version: value.data.expectedVersion,
    p_packet_hash: value.data.packetHash,
    p_content_sha256: value.data.contentSha256,
  };
  const { data, error } = "packetId" in value.data
    ? await supabase.rpc("parent_authorize_snap_protected_submission", { ...common, p_packet_id: value.data.packetId, p_completed_acts: value.data.completedActs })
    : await supabase.rpc("parent_authorize_snap_submission", { ...common, p_artifact_id: value.data.artifactId });
  if (error?.code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  if (error?.code === "23514") throw new Error("parent_snap_submission_not_ready");
  const recorded = uuid.safeParse(data);
  if (error || !recorded.success || recorded.data !== value.data.operationId)
    throw new Error("CaseLink could not confirm this submission decision. Refresh to check the latest status.");
  return recorded.data;
}
