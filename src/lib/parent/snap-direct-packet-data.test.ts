import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationRequiredError, SessionUnavailableError } from "@/lib/auth/session-errors";
import { fixtureSnapCaptureIntent } from "./test-fixtures";
import { parentError } from "./http";
import type { SnapPacketAuthorizationResult } from "./snap-packet-contract";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { authorizeSnapDirectPacket, getCurrentSnapDirectPacketAuthorization, getSnapDirectPacketAuthorization } from "./snap-direct-packet-data";

const intent = fixtureSnapCaptureIntent(), { ownerId: owner, requestId, snapshotId, packetId } = intent;
const acquisitionId = "abcdefab-cdef-4abc-8def-abcdefabcdef", now = new Date("2026-11-05T20:00:00.000Z");
const scope = () => ({ packetId, expectedVersion: intent.requestVersion, snapshotId, snapshotHash: intent.snapshotHash });
const input = () => ({ ...scope(), acquisitionId, contentSha256: intent.contentSha256, byteLength: intent.byteLength });
const currentScope = () => ({ expectedVersion: intent.requestVersion, snapshotId, snapshotHash: intent.snapshotHash });
const result = (): SnapPacketAuthorizationResult => ({ intent: { ...intent }, authorizationExpiresAt: "2026-11-05T20:05:00.000Z", subjectIds: [owner],
  authorityDeclaration: "parent_declared_household_data_authority", consentedAt: "2026-11-05T19:59:00.000Z", state: "authorized" });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc }, user: { id: owner, email: "synthetic@example.invalid" } }); mocks.rpc.mockResolvedValue({ data: result(), error: null });
});
afterEach(() => vi.useRealTimers());

describe("linked direct SNAP packet metadata SDK", () => {
  it("binds exact metadata through eight RPC arguments, deriving consent/policies/subjects in SQL", async () => {
    expect(await authorizeSnapDirectPacket(requestId, input())).toEqual(result());
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_authorize_snap_direct_packet", { p_request_id: requestId, p_expected_version: intent.requestVersion,
      p_snapshot_id: snapshotId, p_snapshot_hash: intent.snapshotHash, p_packet_id: packetId, p_content_sha256: intent.contentSha256, p_byte_length: intent.byteLength, p_acquisition_id: acquisitionId });
  });
  it("recovers only a known packet through the linked getter, without another construction or declaration", async () => {
    expect(await getSnapDirectPacketAuthorization(requestId, scope())).toEqual(result());
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_direct_packet_authorization", { p_request_id: requestId, p_packet_id: packetId, p_expected_version: intent.requestVersion });
  });
  it.each(["authorized", "stored"] as const)("preserves original consent/expiry and honest %s metadata on replay", async state => {
    const value = { ...result(), state }; mocks.rpc.mockResolvedValue({ data: value, error: null });
    expect(await authorizeSnapDirectPacket(requestId, input())).toEqual(value); expect(await authorizeSnapDirectPacket(requestId, input())).toEqual(value); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("normalizes input UUIDs and owns all scope before awaiting the session", async () => {
    const value = { ...input(), acquisitionId: acquisitionId.toUpperCase() }, pending = authorizeSnapDirectPacket(requestId.toUpperCase(), value);
    value.byteLength++; value.acquisitionId = requestId;
    expect(await pending).toEqual(result()); expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_request_id: requestId, p_acquisition_id: acquisitionId, p_byte_length: intent.byteLength });
    const query = scope(), read = getSnapDirectPacketAuthorization(requestId, query); query.snapshotHash = "c".repeat(64); expect(await read).toEqual(result());
  });
  it.each([{ expectedVersion: 0 }, { expectedVersion: 2147483648 }, { packetId: "bad" }, { acquisitionId: null }, { contentSha256: "B".repeat(64) }, { byteLength: 0 }, { byteLength: 10485761 },
    { policyVersion: "synthetic" }, { retentionPolicyVersion: "synthetic" }, { subjectIds: [owner] }, { authorityDeclared: true }, { ownerId: owner }, { identifiers: "PRIVATE-CANARY" }, { strokes: [] }, { file: "PRIVATE-CANARY" }])("rejects malformed/private/repeated-authority input before Auth: %j", async change => {
    await expect(authorizeSnapDirectPacket(requestId, { ...input(), ...change })).rejects.toThrow("parent_invalid_input"); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects unknown recovery fields and bad paths before Auth", async () => {
    await expect(getSnapDirectPacketAuthorization("bad", scope())).rejects.toThrow("parent_invalid_input");
    await expect(getSnapDirectPacketAuthorization(requestId, { ...scope(), acquisitionId })).rejects.toThrow("parent_invalid_input"); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(["ownerId", "requestId", "requestVersion", "packetId", "snapshotId", "snapshotHash"] as const)("binds both write/read replies to current %s", async field => {
    const changed = field === "requestVersion" ? 2 : field === "snapshotHash" ? "c".repeat(64) : acquisitionId;
    mocks.rpc.mockResolvedValue({ data: { ...result(), intent: { ...intent, [field]: changed } }, error: null });
    await expect(authorizeSnapDirectPacket(requestId, input())).rejects.toThrow("CaseLink could not confirm"); await expect(getSnapDirectPacketAuthorization(requestId, scope())).rejects.toThrow("CaseLink could not confirm");
  });
  it.each(["contentSha256", "byteLength"] as const)("matches posted %s instead of silently accepting another packet", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), intent: { ...intent, [field]: field === "byteLength" ? intent.byteLength + 1 : "c".repeat(64) } }, error: null });
    await expect(authorizeSnapDirectPacket(requestId, input())).rejects.toThrow("CaseLink could not confirm");
  });
  it.each([null, {}, { ...result(), state: "ready" }, { ...result(), subjectIds: [] }, { ...result(), rawFile: "PRIVATE-CANARY" }, { ...result(), intent: { ...intent, ssn: "PRIVATE-CANARY" } },
    { ...result(), intent: { ...intent, templateSha256: "c".repeat(64) } }, { ...result(), authorizationExpiresAt: now.toISOString() }, { ...result(), consentedAt: "2026-11-05T20:01:00.000Z" },
    { ...result(), authorizationExpiresAt: "2027-01-01T00:00:00.000Z" }])("rejects invalid, private or stale replies without echoing data %#", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    for (const operation of [authorizeSnapDirectPacket(requestId, input()), getSnapDirectPacketAuthorization(requestId, scope())]) {
      const error = await operation.catch(error => error as Error); expect(error).toBeInstanceOf(Error); expect((error as Error).message).toContain("CaseLink could not confirm"); expect((error as Error).message).not.toContain("PRIVATE-");
    }
  });
  it("checks expiry after the awaited RPC", async () => {
    mocks.rpc.mockImplementation(async () => { vi.setSystemTime(new Date("2026-11-05T20:06:00.000Z")); return { data: result(), error: null }; });
    await expect(getSnapDirectPacketAuthorization(requestId, scope())).rejects.toThrow("CaseLink could not confirm");
  });
  it("keeps actual authentication denial separate from unavailable session service", async () => {
    mocks.session.mockRejectedValue(new AuthenticationRequiredError()); const denied = await authorizeSnapDirectPacket(requestId, input()).catch(error => error); expect(parentError(denied).status).toBe(401);
    mocks.session.mockRejectedValue(new SessionUnavailableError()); const error = await getSnapDirectPacketAuthorization(requestId, scope()).catch(error => error); expect(parentError(error).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "This request is unavailable"], ["23514", "parent_invalid_input"], ["08006", "CaseLink could not confirm"]])("keeps SQL %s details private", async (code, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-SQL-CANARY" } });
    const error = await authorizeSnapDirectPacket(requestId, input()).catch(error => error as Error); expect((error as Error).message).toContain(message); expect((error as Error).message).not.toContain("PRIVATE-"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not retry uncertain writes or infer absence from a null/malformed response", async () => {
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY")); await expect(authorizeSnapDirectPacket(requestId, input())).rejects.toThrow("CaseLink could not confirm"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValue(null); await expect(getSnapDirectPacketAuthorization(requestId, scope())).rejects.toThrow("CaseLink could not confirm"); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("discovers server-selected current metadata through four exact scope arguments, without inventing a packet ID", async () => {
    const value = { ...result(), intent: { ...intent, packetId: acquisitionId } }; mocks.rpc.mockResolvedValue({ data: value, error: null });
    const query = currentScope(), pending = getCurrentSnapDirectPacketAuthorization(requestId.toUpperCase(), query); query.snapshotHash = "c".repeat(64);
    expect(await pending).toEqual(value);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_current_direct_packet", { p_request_id: requestId, p_expected_version: intent.requestVersion, p_snapshot_id: snapshotId, p_snapshot_hash: intent.snapshotHash });
  });
  it("preserves actual SQL NULL only for current discovery; a known-ID NULL stays unconfirmed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getCurrentSnapDirectPacketAuthorization(requestId, currentScope())).toBeNull();
    await expect(getSnapDirectPacketAuthorization(requestId, scope())).rejects.toThrow("CaseLink could not confirm"); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, false, 0, "", {}, { ...result(), rawFile: "PRIVATE-CANARY" }])("does not treat malformed discovery data as no registered intent %#", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const error = await getCurrentSnapDirectPacketAuthorization(requestId, currentScope()).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toContain("CaseLink could not confirm"); expect((error as Error).message).not.toContain("PRIVATE-");
  });
  it.each(["ownerId", "requestId", "requestVersion", "snapshotId", "snapshotHash"] as const)("binds discovered metadata to current %s", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), intent: { ...intent, [field]: field === "requestVersion" ? 2 : field === "snapshotHash" ? "c".repeat(64) : acquisitionId } }, error: null });
    await expect(getCurrentSnapDirectPacketAuthorization(requestId, currentScope())).rejects.toThrow("CaseLink could not confirm");
  });
  it("rejects missing/current-discovery extras before Auth and does not reveal NULL without a current session", async () => {
    await expect(getCurrentSnapDirectPacketAuthorization(requestId, { ...currentScope(), packetId })).rejects.toThrow("parent_invalid_input");
    await expect(getCurrentSnapDirectPacketAuthorization(requestId, { expectedVersion: 1 })).rejects.toThrow("parent_invalid_input"); expect(mocks.session).not.toHaveBeenCalled();
    mocks.session.mockRejectedValue(new AuthenticationRequiredError()); mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getCurrentSnapDirectPacketAuthorization(requestId, currentScope())).rejects.toBeInstanceOf(AuthenticationRequiredError); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps a competing candidate conflict to reload, never retrying or constructing a fresh intent", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "PRIVATE-COMPETITOR-CANARY" } });
    const error = await authorizeSnapDirectPacket(requestId, { ...input(), packetId: acquisitionId }).catch(error => error as Error);
    expect((error as Error).message).toMatch(/^This request changed/); expect((error as Error).message).not.toContain("PRIVATE-"); expect(parentError(error).status).toBe(409); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValue({ data: result(), error: null }); expect(await getCurrentSnapDirectPacketAuthorization(requestId, currentScope())).toEqual(result());
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["parent_authorize_snap_direct_packet", "parent_get_snap_current_direct_packet"]);
  });
  it.each(["42501", "40001", "08006"])("does not turn discovery SQL %s denial or uncertainty into NULL", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-SQL-CANARY" } });
    await expect(getCurrentSnapDirectPacketAuthorization(requestId, currentScope())).rejects.toBeInstanceOf(Error); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
