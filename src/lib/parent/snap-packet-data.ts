import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import {
  snapPacketAuthorizationInputSchema, snapPacketAuthorizationResultSchema, snapPacketAuthorizationScopeSchema,
  type SnapPacketAuthorizationInput, type SnapPacketAuthorizationResult, type SnapPacketAuthorizationScope,
} from "./snap-packet-contract";

const uuid = z.uuid().transform(value => value.toLowerCase());
const unavailable = "This request is unavailable, or its permission has changed.";
const unconfirmed = "CaseLink could not confirm this packet authorization. Refresh to check the latest saved permission.";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new Error("parent_invalid_input");
  return value.data;
}
function check(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new Error(unavailable);
  if (error.code === "23514") throw new Error("parent_invalid_input");
  throw new Error(unconfirmed);
}
async function call(action: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<unknown> {
  let result;
  try { result = await action(); } catch { throw new Error(unconfirmed); }
  check(result.error);
  return result.data;
}
function reply(input: unknown, ownerId: string, requestId: string, scope: SnapPacketAuthorizationScope, posted?: SnapPacketAuthorizationInput): SnapPacketAuthorizationResult {
  const value = snapPacketAuthorizationResultSchema.safeParse(input);
  if (!value.success) throw new Error(unconfirmed);
  const result = value.data, intent = result.intent;
  if (intent.ownerId !== ownerId || intent.requestId !== requestId || intent.requestVersion !== scope.expectedVersion
    || intent.packetId !== scope.packetId || intent.snapshotId !== scope.snapshotId || intent.snapshotHash !== scope.snapshotHash
    || Date.parse(result.consentedAt) > Date.now() || Date.parse(result.authorizationExpiresAt) <= Date.now()
    || (posted && (intent.contentSha256 !== posted.contentSha256 || intent.byteLength !== posted.byteLength
      || intent.policyVersion !== posted.policyVersion || intent.retentionPolicyVersion !== posted.retentionPolicyVersion
      || [...result.subjectIds].sort().join() !== [...posted.subjectIds].sort().join()))) throw new Error(unconfirmed);
  return result;
}

/** Metadata permission only. The caller-known packetId is the immutable idempotency key. */
export async function authorizeSnapPacket(requestId: string, input: unknown): Promise<SnapPacketAuthorizationResult> {
  const id = parse(uuid, requestId), value = parse(snapPacketAuthorizationInputSchema, input);
  const { supabase, user } = await requireParentSession();
  const data = await call(() => supabase.rpc("parent_authorize_snap_final_packet", {
    p_request_id: id, p_expected_version: value.expectedVersion, p_snapshot_id: value.snapshotId, p_snapshot_hash: value.snapshotHash,
    p_packet_id: value.packetId, p_content_sha256: value.contentSha256, p_byte_length: value.byteLength,
    p_policy_version: value.policyVersion, p_retention_policy_version: value.retentionPolicyVersion,
    p_subject_ids: value.subjectIds, p_authority_declared: value.authorityDeclared,
  }));
  return reply(data, user.id, id, value, value);
}

/** Recover exact owned metadata; this cannot prove absence, decrypt bytes or authorize a retry. */
export async function getSnapPacketAuthorization(requestId: string, input: unknown): Promise<SnapPacketAuthorizationResult> {
  const id = parse(uuid, requestId), scope = parse(snapPacketAuthorizationScopeSchema, input);
  const { supabase, user } = await requireParentSession();
  const data = await call(() => supabase.rpc("parent_get_snap_final_packet_authorization", {
    p_request_id: id, p_packet_id: scope.packetId, p_expected_version: scope.expectedVersion,
  }));
  return reply(data, user.id, id, scope);
}
