import "server-only";
import { z } from "zod";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
import { requireParentSession } from "./auth";
import { snapDirectAcquisitionScopeSchema, snapDirectPacketInputSchema, snapDirectPacketScopeSchema, type SnapDirectPacketInput, type SnapDirectPacketReadScope } from "./snap-direct-acquisition-contract";
import { snapPacketAuthorizationResultSchema, type SnapPacketAuthorizationResult } from "./snap-packet-contract";

const uuid = z.uuid().transform(value => value.toLowerCase());
const unavailable = "This request is unavailable, or its permission has changed.";
const unconfirmed = "CaseLink could not confirm this packet authorization. Refresh to check the latest saved permission.";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new Error("parent_invalid_input");
  return value.data;
}
function sessionFailure(error: unknown): never {
  if (error instanceof AuthenticationRequiredError) throw error;
  throw new Error("Parent service is not available.");
}
async function call(action: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<unknown> {
  let result;
  try { result = await action(); } catch { throw new Error(unconfirmed); }
  if (!result || typeof result !== "object") throw new Error(unconfirmed);
  if (result.error?.code === "42501") throw new Error(unavailable);
  if (result.error?.code === "23514") throw new Error("parent_invalid_input");
  if (result.error?.code === "40001") throw new Error("This request changed. Reload the saved packet metadata before continuing.");
  if (result.error) throw new Error(unconfirmed);
  return result.data;
}
function reply(input: unknown, ownerId: string, requestId: string, scope: SnapDirectPacketReadScope, posted?: SnapDirectPacketInput): SnapPacketAuthorizationResult {
  const parsed = snapPacketAuthorizationResultSchema.safeParse(input);
  if (!parsed.success) throw new Error(unconfirmed);
  const value = parsed.data, intent = value.intent, now = Date.now();
  if (intent.ownerId !== ownerId || intent.requestId !== requestId || intent.requestVersion !== scope.expectedVersion
    || (scope.packetId !== undefined && intent.packetId !== scope.packetId) || intent.snapshotId !== scope.snapshotId || intent.snapshotHash !== scope.snapshotHash
    || Date.parse(value.consentedAt) > now || Date.parse(value.authorizationExpiresAt) <= now
    || (posted && (intent.contentSha256 !== posted.contentSha256 || intent.byteLength !== posted.byteLength))) throw new Error(unconfirmed);
  return value;
}

/** The database derives scope, consent and expiry from the existing acquisition; no new declaration is made. */
export async function authorizeSnapDirectPacket(requestId: string, input: unknown): Promise<SnapPacketAuthorizationResult> {
  const id = parse(uuid, requestId), value = parse(snapDirectPacketInputSchema, input);
  const { supabase, user } = await requireParentSession().catch(sessionFailure);
  const data = await call(() => supabase.rpc("parent_authorize_snap_direct_packet", {
    p_request_id: id, p_expected_version: value.expectedVersion, p_snapshot_id: value.snapshotId, p_snapshot_hash: value.snapshotHash,
    p_packet_id: value.packetId, p_content_sha256: value.contentSha256, p_byte_length: value.byteLength, p_acquisition_id: value.acquisitionId,
  }));
  return reply(data, user.id, id, value, value);
}

/** Known-ID metadata recovery only. This cannot discover an unknown intent or establish storage absence. */
export async function getSnapDirectPacketAuthorization(requestId: string, input: unknown): Promise<SnapPacketAuthorizationResult> {
  const id = parse(uuid, requestId), scope = parse(snapDirectPacketScopeSchema, input);
  const { supabase, user } = await requireParentSession().catch(sessionFailure);
  const data = await call(() => supabase.rpc("parent_get_snap_direct_packet_authorization", {
    p_request_id: id, p_packet_id: scope.packetId, p_expected_version: scope.expectedVersion,
  }));
  return reply(data, user.id, id, scope);
}

/** NULL means no registered current linked intent; it never proves no delivery or grants a new construction. */
export async function getCurrentSnapDirectPacketAuthorization(requestId: string, input: unknown): Promise<SnapPacketAuthorizationResult | null> {
  const id = parse(uuid, requestId), scope = parse(snapDirectAcquisitionScopeSchema, input);
  const { supabase, user } = await requireParentSession().catch(sessionFailure);
  const data = await call(() => supabase.rpc("parent_get_snap_current_direct_packet", {
    p_request_id: id, p_expected_version: scope.expectedVersion, p_snapshot_id: scope.snapshotId, p_snapshot_hash: scope.snapshotHash,
  }));
  return data === null ? null : reply(data, user.id, id, scope);
}
