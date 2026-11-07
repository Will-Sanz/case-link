import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationRequiredError, SessionUnavailableError } from "@/lib/auth/session-errors";
import { SNAP_APPLICATION_SOURCE } from "@/lib/parent/snap-application-fields";
import { SNAP_DIRECT_ACQUISITION_FIELDS, SNAP_DIRECT_ACQUISITION_METHOD } from "@/lib/parent/snap-direct-acquisition-contract";
const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session, createParentClient: mocks.client }));
import { DELETE, GET, POST } from "./route";

const site = "https://caselink.test", owner = "11111111-1111-4111-8111-111111111111";
const requestId = "abcdefab-cdef-4abc-8def-abcdefabcdef", snapshotId = "bbcdefab-cdef-4abc-8def-abcdefabcdef", acquisitionId = "cccdefab-cdef-4abc-8def-abcdefabcdef";
const path = `${site}/api/parent/requests/${requestId}/snap-acquisition`;
const scope = () => ({ expectedVersion: 3, snapshotId, snapshotHash: "a".repeat(64) });
const input = () => ({ ...scope(), acquisitionId, policyVersion: "synthetic-policy", retentionPolicyVersion: "synthetic-retention", subjectIds: [owner], acceptedExpiresAt: "2026-11-05T20:05:00.000Z", authorityDeclared: true });
const context = (id = requestId) => ({ params: Promise.resolve({ id }) });
const query = `expectedVersion=3&snapshotId=${snapshotId}&snapshotHash=${scope().snapshotHash}`;
const get = (search = query, headers: Record<string, string> = {}) => new Request(`${path}?${search}`, { headers });
function send(method: "POST" | "DELETE", body: unknown = method === "POST" ? input() : { acquisitionId }, headers: Record<string, string> = { origin: site, "content-type": "application/json" }, url = path) {
  return new Request(url, { method, headers, body: JSON.stringify(body) });
}
function result() {
  return { state: "authorized", acquisitionId, ownerId: owner, requestId, requestVersion: 3, snapshotId, snapshotHash: scope().snapshotHash,
    recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", method: SNAP_DIRECT_ACQUISITION_METHOD,
    fieldScope: [...SNAP_DIRECT_ACQUISITION_FIELDS], source: { ...SNAP_APPLICATION_SOURCE }, subjectIds: [owner],
    policyVersion: input().policyVersion, retentionPolicyVersion: input().retentionPolicyVersion,
    authorityDeclaration: "parent_declared_household_data_authority", consentedAt: "2026-11-05T19:59:00.000Z", expiresAt: "2026-11-05T20:05:00.000Z" };
}
const mutations = [["POST", POST], ["DELETE", DELETE]] as const;
const foreignReadHeaders: Record<string, string>[] = [{ origin: "https://other.test" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T20:00:00.000Z")); vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const client = { rpc: mocks.rpc, auth: { getUser: mocks.getUser } };
  mocks.session.mockResolvedValue({ supabase: client, user: { id: owner, email: "synthetic@example.invalid" } }); mocks.client.mockResolvedValue(client);
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner, email: "synthetic@example.invalid", email_confirmed_at: "2026-11-01T00:00:00.000Z", is_anonymous: false } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "parent_revoke_snap_direct_acquisition" ? null : result(), error: null }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("owned SNAP acquisition metadata HTTP routes", () => {
  it("returns current metadata and preserves permission_needed as a non-authorizing state", async () => {
    const acquisition = { ...result(), state: "permission_needed", acquisitionId: null, authorityDeclaration: null, consentedAt: null };
    mocks.rpc.mockResolvedValue({ data: acquisition, error: null });
    const response = await GET(get(), context()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, acquisition });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_direct_acquisition", { p_request_id: requestId, p_expected_version: 3, p_snapshot_id: snapshotId, p_snapshot_hash: scope().snapshotHash });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await POST(send("POST"), context())).status).toBe(500);
  });
  it("records declared metadata only and returns the original grant on equivalent replay", async () => {
    const acquisition = { ...result(), acquisitionId: snapshotId };
    mocks.rpc.mockResolvedValue({ data: acquisition, error: null });
    const first = await POST(send("POST"), context()), second = await POST(send("POST"), context());
    expect(first.status).toBe(201); expect(second.status).toBe(201); expect(await first.json()).toEqual({ ok: true, acquisition }); expect(await second.json()).toEqual({ ok: true, acquisition });
    expect(mocks.rpc).toHaveBeenCalledWith("parent_authorize_snap_direct_acquisition", { p_request_id: requestId, p_expected_version: 3, p_snapshot_id: snapshotId, p_snapshot_hash: scope().snapshotHash,
      p_acquisition_id: acquisitionId, p_policy_version: input().policyVersion, p_retention_policy_version: input().retentionPolicyVersion, p_subject_ids: [owner], p_authority_declared: true, p_accepted_expires_at: "2026-11-05T20:05:00.000Z" });
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(first.headers.get("Cache-Control")).toBe("private, no-store"); expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("withdraws idempotently through the real data wrapper after ordinary processing session checks close", async () => {
    mocks.session.mockRejectedValue(new Error("processing closed PRIVATE-CANARY"));
    for (let count = 0; count < 2; count++) {
      const response = await DELETE(send("DELETE"), context()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).toHaveBeenCalledTimes(2); expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_revoke_snap_direct_acquisition", { p_request_id: requestId, p_acquisition_id: acquisitionId }); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("normalizes path, snapshot, acquisition and subject UUID input before the exact RPC", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "parent_revoke_snap_direct_acquisition" ? null : { ...result(), subjectIds: [acquisitionId] }, error: null }));
    expect((await POST(send("POST", { ...input(), snapshotId: snapshotId.toUpperCase(), acquisitionId: acquisitionId.toUpperCase(), subjectIds: [acquisitionId.toUpperCase()] }), context(requestId.toUpperCase()))).status).toBe(201);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_request_id: requestId, p_snapshot_id: snapshotId, p_acquisition_id: acquisitionId, p_subject_ids: [acquisitionId] });
    expect((await GET(get(query.replace(snapshotId, snapshotId.toUpperCase())), context(requestId.toUpperCase()))).status).toBe(200); expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_request_id: requestId, p_snapshot_id: snapshotId });
    expect((await DELETE(send("DELETE", { acquisitionId: acquisitionId.toUpperCase() }), context(requestId.toUpperCase()))).status).toBe(200); expect(mocks.rpc.mock.calls[2][1]).toEqual({ p_request_id: requestId, p_acquisition_id: acquisitionId });
  });
  it.each([undefined, "https://other.test"])("rejects missing/foreign write origin before body or Auth: %s", async origin => {
    for (const [method, handler] of mutations) {
      const incoming = send(method, undefined, { "content-type": "application/json", ...(origin ? { origin } : {}) }), body = vi.spyOn(incoming, "body", "get");
      expect((await handler(incoming, context())).status).toBe(403); expect(body).not.toHaveBeenCalled();
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(foreignReadHeaders)("denies foreign metadata reads before Auth: %j", async headers => {
    expect((await GET(get(query, headers), context())).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("allows explicit same-origin GET and JSON charset parameters", async () => {
    expect((await GET(get(query, { origin: site, "sec-fetch-site": "same-origin" }), context())).status).toBe(200);
    for (const [method, handler] of mutations) expect((await handler(send(method, undefined, { origin: site, "content-type": "application/json; charset=utf-8" }), context())).status).toBe(method === "POST" ? 201 : 200);
  });
  it.each(["application/pdf", "multipart/form-data; boundary=synthetic", "image/png", "text/plain", "application/jsonp", ""])("rejects non-JSON media before reading bytes: %s", async media => {
    for (const [method, handler] of mutations) {
      const incoming = send(method, undefined, { origin: site, ...(media ? { "content-type": media } : {}) }), body = vi.spyOn(incoming, "body", "get"), form = vi.spyOn(incoming, "formData");
      expect((await handler(incoming, context())).status).toBe(400); expect(body).not.toHaveBeenCalled(); expect(form).not.toHaveBeenCalled();
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["ssn", "identifiers", "strokes", "file", "ownerId", "details", "packetId"])("rejects private or out-of-scope body key %s with a fixed error", async key => {
    for (const [method, handler] of mutations) {
      const response = await handler(send(method, { ...(method === "POST" ? input() : { acquisitionId }), [key]: "PRIVATE-CANARY" }), context());
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ expectedVersion: 0 }, { expectedVersion: 2147483648 }, { snapshotId: "bad" }, { snapshotHash: "B".repeat(64) }, { subjectIds: [owner, owner] }, { authorityDeclared: false }])("rejects invalid authorization fields before Auth: %j", async change => {
    expect((await POST(send("POST", { ...input(), ...change }), context())).status).toBe(400); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("accepts exactly 4KiB JSON while rejecting larger received or declared bodies and malformed JSON", async () => {
    for (const [method, handler] of mutations) {
      const text = JSON.stringify(method === "POST" ? input() : { acquisitionId });
      expect((await handler(new Request(path, { method, headers: { origin: site, "content-type": "application/json" }, body: text.padEnd(4096) }), context())).status).toBe(method === "POST" ? 201 : 200);
      for (const body of [text.padEnd(4097), "{"]) expect((await handler(new Request(path, { method, headers: { origin: site, "content-type": "application/json" }, body }), context())).status).toBe(400);
      const incoming = new Request(path, { method, headers: { origin: site, "content-type": "application/json", "content-length": "4097" }, body: text }), read = vi.spyOn(incoming, "body", "get");
      expect((await handler(incoming, context())).status).toBe(400); expect(read).not.toHaveBeenCalled();
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("rejects write query shadowing and malformed paths before Auth", async () => {
    for (const [method, handler] of mutations) {
      expect((await handler(send(method, undefined, undefined, `${path}?acquisitionId=${acquisitionId}`), context())).status).toBe(400);
      expect((await handler(send(method), context("invalid"))).status).toBe(400);
    }
    expect((await GET(get(), context("invalid"))).status).toBe(400); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([`${query}&expectedVersion=4`, `${query}&__proto__=PRIVATE-CANARY`, `${query}&ssn=PRIVATE-CANARY`, query.replace("Version=3", "Version=03"), query.replace("Version=3", "Version=1e3"),
    query.replace("Version=3", "Version=2147483648"), query.replace(scope().snapshotHash, "bad"), "expectedVersion=3", `x=${"a".repeat(1100)}`])("rejects duplicate, unknown, missing or noncanonical query fields %#", async search => {
    const response = await GET(get(search), context()); expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." }); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("preserves authentication denial and safe service failure across the method-specific paths", async () => {
    mocks.session.mockRejectedValue(new AuthenticationRequiredError()); mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect((await GET(get(), context())).status).toBe(401); expect((await POST(send("POST"), context())).status).toBe(401); expect((await DELETE(send("DELETE"), context())).status).toBe(401);
    mocks.session.mockRejectedValue(new SessionUnavailableError()); mocks.getUser.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY"));
    for (const response of [await GET(get(), context()), await POST(send("POST"), context()), await DELETE(send("DELETE"), context())]) { expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-"); }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["23514", 400], ["08006", 500]] as const)("keeps SQL %s details private for all methods", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-SQL-CANARY" } });
    for (const response of [await GET(get(), context()), await POST(send("POST"), context()), await DELETE(send("DELETE"), context())]) { expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-"); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); }
    expect(mocks.rpc).toHaveBeenCalledTimes(3); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-");
  });
  it("never echoes unexpected private replies or retries uncertain changes", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), rawFile: "PRIVATE-REPLY-CANARY" }, error: null });
    for (const response of [await GET(get(), context()), await POST(send("POST"), context()), await DELETE(send("DELETE"), context())]) { expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-"); }
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY"));
    for (const response of [await POST(send("POST"), context()), await DELETE(send("DELETE"), context())]) { expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-"); }
    expect(mocks.rpc).toHaveBeenCalledTimes(5); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-");
  });
});
