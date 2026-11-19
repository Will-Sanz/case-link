import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationRequiredError, SessionUnavailableError } from "@/lib/auth/session-errors";
import { parentError } from "./http";
import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";
import { SNAP_DIRECT_ACQUISITION_FIELDS, SNAP_DIRECT_ACQUISITION_METHOD, type SnapDirectAcquisitionResult } from "./snap-direct-acquisition-contract";

const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session, createParentClient: mocks.client }));
import { authorizeSnapDirectAcquisition, getSnapDirectAcquisition, revokeSnapDirectAcquisition } from "./snap-direct-acquisition-data";

const owner = "11111111-1111-4111-8111-111111111111", requestId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const snapshotId = "bbcdefab-cdef-4abc-8def-abcdefabcdef", acquisitionId = "cccdefab-cdef-4abc-8def-abcdefabcdef";
const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", now = new Date("2026-11-05T20:00:00.000Z");
const scope = () => ({ expectedVersion: 3, snapshotId, snapshotHash: "a".repeat(64) });
const input = () => ({ ...scope(), acquisitionId, policyVersion: "synthetic-policy", retentionPolicyVersion: "synthetic-retention", subjectIds: [owner], acceptedExpiresAt: "2026-11-05T20:05:00.000Z", authorityDeclared: true as const });
const authUser = () => ({ id: owner, email: "synthetic@example.invalid", email_confirmed_at: "2026-11-01T00:00:00.000Z", is_anonymous: false });
function result(): SnapDirectAcquisitionResult {
  return { state: "authorized", acquisitionId, ownerId: owner, requestId, requestVersion: 3, snapshotId, snapshotHash: scope().snapshotHash,
    recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", method: SNAP_DIRECT_ACQUISITION_METHOD,
    fieldScope: [...SNAP_DIRECT_ACQUISITION_FIELDS], source: { ...SNAP_APPLICATION_SOURCE }, subjectIds: [owner],
    policyVersion: input().policyVersion, retentionPolicyVersion: input().retentionPolicyVersion,
    authorityDeclaration: "parent_declared_household_data_authority", consentedAt: "2026-11-05T19:59:00.000Z", expiresAt: "2026-11-05T20:05:00.000Z" };
}
const permissionNeeded = (): SnapDirectAcquisitionResult => ({ ...result(), state: "permission_needed", acquisitionId: null, consentedAt: null, authorityDeclaration: null });
const client = () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  mocks.session.mockResolvedValue({ supabase: client(), user: { id: owner, email: authUser().email } }); mocks.client.mockResolvedValue(client());
  mocks.getUser.mockResolvedValue({ data: { user: authUser() }, error: null }); mocks.rpc.mockResolvedValue({ data: result(), error: null });
});
afterEach(() => vi.useRealTimers());

describe("owned SNAP direct-acquisition metadata SDK", () => {
  it("loads exact current owned permission metadata through four scope parameters only", async () => {
    mocks.rpc.mockResolvedValue({ data: permissionNeeded(), error: null });
    expect(await getSnapDirectAcquisition(requestId, scope())).toEqual(permissionNeeded());
    expect(mocks.session).toHaveBeenCalledExactlyOnceWith(); expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_direct_acquisition", { p_request_id: requestId, p_expected_version: 3, p_snapshot_id: snapshotId, p_snapshot_hash: scope().snapshotHash });
  });
  it("records the exact declared scope and accepted expiry through ten parameters without applicant values", async () => {
    expect(await authorizeSnapDirectAcquisition(requestId, input())).toEqual(result());
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_authorize_snap_direct_acquisition", { p_request_id: requestId, p_expected_version: 3, p_snapshot_id: snapshotId, p_snapshot_hash: scope().snapshotHash,
      p_acquisition_id: acquisitionId, p_policy_version: input().policyVersion, p_retention_policy_version: input().retentionPolicyVersion, p_subject_ids: [owner], p_authority_declared: true, p_accepted_expires_at: "2026-11-05T20:05:00.000Z" });
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("accepts the existing equivalent grant rather than fabricating new consent or expiry", async () => {
    const value = { ...result(), acquisitionId: other, consentedAt: "2026-11-05T19:58:00.000Z", expiresAt: "2026-11-05T20:01:00.000Z" };
    mocks.rpc.mockResolvedValue({ data: value, error: null });
    expect(await authorizeSnapDirectAcquisition(requestId, input())).toEqual(value); expect(await authorizeSnapDirectAcquisition(requestId, input())).toEqual(value);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([now.toISOString(), "2026-11-05T19:59:59.999Z"])("rejects expired accepted bound %s before any session access", async acceptedExpiresAt => {
    await expect(authorizeSnapDirectAcquisition(requestId, { ...input(), acceptedExpiresAt })).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a provider reply extending the exact accepted expiry", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), expiresAt: "2026-11-05T20:05:00.001Z" }, error: null });
    await expect(authorizeSnapDirectAcquisition(requestId, input())).rejects.toThrow("CaseLink could not confirm"); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("normalizes input UUIDs and compares subject sets independently of ordering", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), subjectIds: [owner, other] }, error: null });
    const value = { ...input(), snapshotId: snapshotId.toUpperCase(), acquisitionId: acquisitionId.toUpperCase(), subjectIds: [other.toUpperCase(), owner] };
    expect(await authorizeSnapDirectAcquisition(requestId.toUpperCase(), value)).toEqual({ ...result(), subjectIds: [owner, other] });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_request_id: requestId, p_snapshot_id: snapshotId, p_acquisition_id: acquisitionId, p_subject_ids: [other, owner] });
  });
  it("copies posted metadata and subject IDs before awaiting the session", async () => {
    const value = input(), promise = authorizeSnapDirectAcquisition(requestId, value); value.expectedVersion = 99; value.subjectIds.push(other);
    expect(await promise).toEqual(result()); expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_expected_version: 3, p_subject_ids: [owner] });
    const query = scope(), get = getSnapDirectAcquisition(requestId, query); query.snapshotHash = "b".repeat(64); expect(await get).toEqual(result());
  });
  it.each([{ expectedVersion: 0 }, { expectedVersion: 2147483648 }, { snapshotId: "bad" }, { snapshotHash: "B".repeat(64) }, { acquisitionId: null }, { subjectIds: [] }, { subjectIds: [owner, owner] }, { authorityDeclared: false }, { policyVersion: "unpublished policy" }, { ssn: "PRIVATE-CANARY" }, { strokes: [] }, { packetId: other }])("rejects invalid/extra input before session access %#", async changes => {
    await expect(authorizeSnapDirectAcquisition(requestId, { ...input(), ...changes })).rejects.toThrow("parent_invalid_input"); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed paths, unknown GET fields and extra withdrawal fields before any Auth access", async () => {
    await expect(getSnapDirectAcquisition("bad", scope())).rejects.toThrow("parent_invalid_input");
    await expect(getSnapDirectAcquisition(requestId, { ...scope(), rawFile: "PRIVATE-CANARY" })).rejects.toThrow("parent_invalid_input");
    await expect(revokeSnapDirectAcquisition(requestId, { acquisitionId, ssn: "PRIVATE-CANARY" })).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["ownerId", "requestId", "requestVersion", "snapshotId", "snapshotHash"] as const)("checks both GET and authorization against current %s", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), [field]: field === "requestVersion" ? 4 : field === "snapshotHash" ? "b".repeat(64) : other }, error: null });
    await expect(getSnapDirectAcquisition(requestId, scope())).rejects.toThrow("CaseLink could not confirm");
    await expect(authorizeSnapDirectAcquisition(requestId, input())).rejects.toThrow("CaseLink could not confirm");
  });
  it.each(Object.keys(SNAP_APPLICATION_SOURCE))("rejects changed pinned source %s", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), source: { ...SNAP_APPLICATION_SOURCE, [field]: "PRIVATE-CANARY" } }, error: null });
    await expect(getSnapDirectAcquisition(requestId, scope())).rejects.toThrow("CaseLink could not confirm");
  });
  it.each(["policyVersion", "retentionPolicyVersion", "subjectIds"] as const)("matches authorized %s to the posted permission", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), [field]: field === "subjectIds" ? [other] : "different-policy" }, error: null });
    await expect(authorizeSnapDirectAcquisition(requestId, input())).rejects.toThrow("CaseLink could not confirm");
  });
  it.each([null, {}, { ...result(), state: "stored" }, { ...result(), rawFile: "PRIVATE-CANARY" }, { ...result(), source: { ...SNAP_APPLICATION_SOURCE, rawValue: "PRIVATE-CANARY" } },
    { ...result(), expiresAt: now.toISOString() }, { ...result(), expiresAt: "2026-11-05T19:59:59.999Z" }, { ...result(), expiresAt: "2027-01-01T00:00:00.000Z" },
    { ...result(), consentedAt: "2026-11-05T20:01:00.000Z" }, { ...result(), fieldScope: [...SNAP_DIRECT_ACQUISITION_FIELDS].reverse() }])("keeps malformed, private or stale replies generic %#", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const error = await getSnapDirectAcquisition(requestId, scope()).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toContain("CaseLink could not confirm"); expect((error as Error).message).not.toContain("PRIVATE-CANARY");
  });
  it("does not mistake permission_needed for successful authorization", async () => {
    mocks.rpc.mockResolvedValue({ data: permissionNeeded(), error: null }); await expect(authorizeSnapDirectAcquisition(requestId, input())).rejects.toThrow("CaseLink could not confirm");
  });
  it("rechecks expiry after an awaited provider response", async () => {
    mocks.rpc.mockImplementation(async () => { vi.setSystemTime(new Date("2026-11-05T20:06:00.000Z")); return { data: result(), error: null }; });
    await expect(getSnapDirectAcquisition(requestId, scope())).rejects.toThrow("CaseLink could not confirm");
  });
  it.each([["42501", "This request is unavailable"], ["23514", "parent_invalid_input"], ["08006", "CaseLink could not confirm"]])("keeps provider %s details private without retrying", async (code, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-ERROR-CANARY" } });
    const error = await authorizeSnapDirectAcquisition(requestId, input()).catch(error => error as Error);
    expect((error as Error).message).toContain(message); expect((error as Error).message).not.toContain("PRIVATE-ERROR-CANARY"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not retry an uncertain permission write or expose a thrown transport error", async () => {
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY")); await expect(authorizeSnapDirectAcquisition(requestId, input())).rejects.toThrow("CaseLink could not confirm"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("keeps a malformed RPC envelope generic", async () => {
    mocks.rpc.mockResolvedValue(null); await expect(getSnapDirectAcquisition(requestId, scope())).rejects.toThrow("CaseLink could not confirm"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([getSnapDirectAcquisition, authorizeSnapDirectAcquisition])("preserves genuine session denial and sanitizes session-service failures", async operation => {
    mocks.session.mockRejectedValue(new AuthenticationRequiredError());
    const denied = await operation(requestId, operation === getSnapDirectAcquisition ? scope() : input()).catch(error => error);
    expect(parentError(denied).status).toBe(401);
    mocks.session.mockRejectedValue(new SessionUnavailableError());
    const unavailable = await operation(requestId, operation === getSnapDirectAcquisition ? scope() : input()).catch(error => error);
    expect(parentError(unavailable).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("withdrawal after processing closure", () => {
  beforeEach(() => { mocks.session.mockRejectedValue(new Error("processing closed PRIVATE-CANARY")); mocks.rpc.mockResolvedValue({ data: null, error: null }); });
  it("uses only live Auth verification and the withdrawal RPC even if normal processing ensure is unavailable", async () => {
    await expect(revokeSnapDirectAcquisition(requestId.toUpperCase(), { acquisitionId: acquisitionId.toUpperCase() })).resolves.toBeUndefined();
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith(); expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith(); expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_revoke_snap_direct_acquisition", { p_request_id: requestId, p_acquisition_id: acquisitionId });
  });
  it.each([null, { ...authUser(), email: null }, { ...authUser(), email_confirmed_at: null }, { ...authUser(), is_anonymous: true }, { ...authUser(), id: "bad" }])("denies unverified Auth identities without any RPC %#", async user => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null }); const error = await revokeSnapDirectAcquisition(requestId, { acquisitionId }).catch(error => error);
    expect(error).toBeInstanceOf(AuthenticationRequiredError); expect(parentError(error).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 429, 500, undefined])("maps Auth status %s to fixed safe denial/unavailability", async status => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status, message: "PRIVATE-AUTH-CANARY" } });
    const error = await revokeSnapDirectAcquisition(requestId, { acquisitionId }).catch(error => error);
    expect((error as Error).message).not.toContain("PRIVATE-AUTH-CANARY"); expect(parentError(error).status).toBe(status && [400, 401, 403].includes(status) ? 401 : 503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["client", "getUser"] as const)("keeps thrown %s setup/transport failures generic", async part => {
    mocks[part].mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY")); const error = await revokeSnapDirectAcquisition(requestId, { acquisitionId }).catch(error => error);
    expect((error as Error).message).toBe("Parent service is not available."); expect(parentError(error).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, { data: null, error: null }])("keeps malformed Auth responses unavailable without an RPC %#", async response => {
    mocks.getUser.mockResolvedValue(response); const error = await revokeSnapDirectAcquisition(requestId, { acquisitionId }).catch(error => error);
    expect((error as Error).message).toBe("Parent service is not available."); expect(parentError(error).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "This request is unavailable"], ["23514", "parent_invalid_input"], ["08006", "CaseLink could not confirm"]])("keeps withdrawal %s errors private", async (code, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-SQL-CANARY" } });
    const error = await revokeSnapDirectAcquisition(requestId, { acquisitionId }).catch(error => error);
    expect((error as Error).message).toContain(message); expect((error as Error).message).not.toContain("PRIVATE-SQL-CANARY"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not retry or falsely confirm an uncertain withdrawal", async () => {
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY")); await expect(revokeSnapDirectAcquisition(requestId, { acquisitionId })).rejects.toThrow("CaseLink could not confirm"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not accept an unexpected result payload as a confirmed withdrawal", async () => {
    mocks.rpc.mockResolvedValue({ data: { raw: "PRIVATE-CANARY" }, error: null }); await expect(revokeSnapDirectAcquisition(requestId, { acquisitionId })).rejects.toThrow("CaseLink could not confirm");
  });
});
