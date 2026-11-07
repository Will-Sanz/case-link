import "server-only";
import { z } from "zod";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
import { createParentClient, requireParentSession } from "./auth";
import {
  snapDirectAcquisitionInputSchema, snapDirectAcquisitionResultSchema, snapDirectAcquisitionRevokeSchema,
  snapDirectAcquisitionScopeSchema, type SnapDirectAcquisitionInput, type SnapDirectAcquisitionResult,
  type SnapDirectAcquisitionScope,
} from "./snap-direct-acquisition-contract";

const uuid = z.uuid().transform(value => value.toLowerCase());
const unavailable = "This request is unavailable, or its permission has changed.";
const unconfirmed = "CaseLink could not confirm this protected permission. Refresh to check the latest saved permission.";
const serviceUnavailable = "Parent service is not available.";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new Error("parent_invalid_input");
  return value.data;
}
function sessionFailure(error: unknown): never {
  if (error instanceof AuthenticationRequiredError) throw error;
  throw new Error(serviceUnavailable);
}
async function call(action: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<unknown> {
  let result;
  try { result = await action(); } catch { throw new Error(unconfirmed); }
  if (!result || typeof result !== "object") throw new Error(unconfirmed);
  if (result.error?.code === "42501") throw new Error(unavailable);
  if (result.error?.code === "23514") throw new Error("parent_invalid_input");
  if (result.error) throw new Error(unconfirmed);
  return result.data;
}
function reply(input: unknown, ownerId: string, requestId: string, scope: SnapDirectAcquisitionScope, posted?: SnapDirectAcquisitionInput): SnapDirectAcquisitionResult {
  const parsed = snapDirectAcquisitionResultSchema.safeParse(input);
  if (!parsed.success) throw new Error(unconfirmed);
  const value = parsed.data, now = Date.now();
  if (value.ownerId !== ownerId || value.requestId !== requestId || value.requestVersion !== scope.expectedVersion
    || value.snapshotId !== scope.snapshotId || value.snapshotHash !== scope.snapshotHash || Date.parse(value.expiresAt) <= now
    || (value.state === "authorized" && Date.parse(value.consentedAt) > now)
    || (posted && (value.state !== "authorized" || value.policyVersion !== posted.policyVersion
      || value.retentionPolicyVersion !== posted.retentionPolicyVersion
      || [...value.subjectIds].sort().join() !== [...posted.subjectIds].sort().join()
      || Date.parse(value.expiresAt) > Date.parse(posted.acceptedExpiresAt)))) throw new Error(unconfirmed);
  return value;
}

/** Current owned permission metadata only; permission_needed does not authorize entering protected fields. */
export async function getSnapDirectAcquisition(requestId: string, input: unknown): Promise<SnapDirectAcquisitionResult> {
  const id = parse(uuid, requestId), scope = parse(snapDirectAcquisitionScopeSchema, input);
  const { supabase, user } = await requireParentSession().catch(sessionFailure);
  const data = await call(() => supabase.rpc("parent_get_snap_direct_acquisition", {
    p_request_id: id, p_expected_version: scope.expectedVersion, p_snapshot_id: scope.snapshotId, p_snapshot_hash: scope.snapshotHash,
  }));
  return reply(data, user.id, id, scope);
}

/** An equivalent existing grant may be returned; its original consent and expiry remain authoritative. */
export async function authorizeSnapDirectAcquisition(requestId: string, input: unknown): Promise<SnapDirectAcquisitionResult> {
  const id = parse(uuid, requestId), value = parse(snapDirectAcquisitionInputSchema, input);
  if (Date.parse(value.acceptedExpiresAt) <= Date.now()) throw new Error("parent_invalid_input");
  const { supabase, user } = await requireParentSession().catch(sessionFailure);
  const data = await call(() => supabase.rpc("parent_authorize_snap_direct_acquisition", {
    p_request_id: id, p_expected_version: value.expectedVersion, p_snapshot_id: value.snapshotId, p_snapshot_hash: value.snapshotHash,
    p_acquisition_id: value.acquisitionId, p_policy_version: value.policyVersion, p_retention_policy_version: value.retentionPolicyVersion,
    p_subject_ids: value.subjectIds, p_authority_declared: value.authorityDeclared,
    p_accepted_expires_at: value.acceptedExpiresAt,
  }));
  return reply(data, user.id, id, value, value);
}

/** Withdrawal must remain possible after processing closes. SQL independently checks live session/ownership. */
export async function revokeSnapDirectAcquisition(requestId: string, input: unknown): Promise<void> {
  const id = parse(uuid, requestId), value = parse(snapDirectAcquisitionRevokeSchema, input);
  const supabase = await createParentClient().catch(() => { throw new Error(serviceUnavailable); });
  let verified;
  try { verified = await supabase.auth.getUser(); } catch { throw new Error(serviceUnavailable); }
  if (!verified || typeof verified !== "object") throw new Error(serviceUnavailable);
  if (verified.error) {
    if ([400, 401, 403].includes(verified.error.status ?? 0)) throw new AuthenticationRequiredError();
    throw new Error(serviceUnavailable);
  }
  if (!verified.data) throw new Error(serviceUnavailable);
  const user = verified.data.user;
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous || !uuid.safeParse(user.id).success) throw new AuthenticationRequiredError();
  const data = await call(() => supabase.rpc("parent_revoke_snap_direct_acquisition", { p_request_id: id, p_acquisition_id: value.acquisitionId }));
  if (data !== null) throw new Error(unconfirmed);
}
