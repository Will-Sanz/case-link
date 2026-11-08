import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationRequiredError, SessionUnavailableError } from "@/lib/auth/session-errors";
import { fixtureSnapCaptureIntent } from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session }));
import { GET, POST } from "./route";

const site = "https://caselink.test", intent = fixtureSnapCaptureIntent(), { ownerId: owner, requestId, packetId, snapshotId } = intent;
const acquisitionId = "abcdefab-cdef-4abc-8def-abcdefabcdef", path = `${site}/api/parent/requests/${requestId}/snap-direct-packet`;
const input = () => ({ packetId, expectedVersion: intent.requestVersion, snapshotId, snapshotHash: intent.snapshotHash, contentSha256: intent.contentSha256, byteLength: intent.byteLength, acquisitionId });
const result = () => ({ intent: { ...intent }, authorizationExpiresAt: "2026-11-05T20:05:00.000Z", consentedAt: "2026-11-05T19:59:00.000Z", subjectIds: [owner], authorityDeclaration: "parent_declared_household_data_authority", state: "authorized" });
const query = `packetId=${packetId}&expectedVersion=${intent.requestVersion}&snapshotId=${snapshotId}&snapshotHash=${intent.snapshotHash}`;
const currentQuery = query.slice(query.indexOf("&") + 1);
const context = (id = requestId) => ({ params: Promise.resolve({ id }) });
const get = (search = query, headers: Record<string, string> = {}) => new Request(`${path}?${search}`, { headers });
const post = (body: unknown = input(), headers: Record<string, string> = { origin: site, "content-type": "application/json" }, url = path) => new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
const foreignReadHeaders: Record<string, string>[] = [{ origin: "https://other.test" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T20:00:00.000Z")); vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", site); vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc }, user: { id: owner, email: "synthetic@example.invalid" } }); mocks.rpc.mockResolvedValue({ data: result(), error: null });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("linked direct SNAP packet metadata HTTP route", () => {
  it("authorizes metadata only through the linked eight-argument RPC without another declaration", async () => {
    const response = await POST(post(), context()); expect(response.status).toBe(201); expect(await response.json()).toEqual({ ok: true, authorization: result() });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_authorize_snap_direct_packet", { p_request_id: requestId, p_expected_version: intent.requestVersion, p_snapshot_id: snapshotId, p_snapshot_hash: intent.snapshotHash,
      p_packet_id: packetId, p_content_sha256: intent.contentSha256, p_byte_length: intent.byteLength, p_acquisition_id: acquisitionId });
  });
  it("recovers a known exact packet using the linked getter and preserves authorized/stored metadata honestly", async () => {
    for (const state of ["authorized", "stored"]) {
      const authorization = { ...result(), state }; mocks.rpc.mockResolvedValue({ data: authorization, error: null });
      const response = await GET(get(), context()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, authorization });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    expect(mocks.rpc).toHaveBeenCalledWith("parent_get_snap_direct_packet_authorization", { p_request_id: requestId, p_packet_id: packetId, p_expected_version: intent.requestVersion }); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("normalizes input UUIDs and replays exact metadata without new consent/expiry", async () => {
    const first = await POST(post({ ...input(), acquisitionId: acquisitionId.toUpperCase() }), context(requestId.toUpperCase())), second = await POST(post(), context());
    expect(await first.json()).toEqual(await second.json()); expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_request_id: requestId, p_acquisition_id: acquisitionId }); expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, "https://other.test"])("rejects absent/foreign write origin before body or Auth: %s", async origin => {
    const incoming = post(input(), { "content-type": "application/json", ...(origin ? { origin } : {}) }), body = vi.spyOn(incoming, "body", "get");
    expect((await POST(incoming, context())).status).toBe(403); expect(body).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(foreignReadHeaders)("denies foreign reads before Auth: %j", async headers => {
    expect((await GET(get(query, headers), context())).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("permits explicit same-origin reads and JSON media parameters", async () => {
    expect((await GET(get(query, { origin: site, "sec-fetch-site": "same-origin" }), context())).status).toBe(200);
    expect((await POST(post(input(), { origin: site, "content-type": "application/json; charset=utf-8" }), context())).status).toBe(201);
  });
  it.each(["application/pdf", "image/png", "multipart/form-data; boundary=synthetic", "text/plain", "application/jsonp", ""])("never reads private bytes or fake JSON media: %s", async type => {
    const incoming = post(input(), { origin: site, ...(type ? { "content-type": type } : {}) }), body = vi.spyOn(incoming, "body", "get"), form = vi.spyOn(incoming, "formData");
    expect((await POST(incoming, context())).status).toBe(400); expect(body).not.toHaveBeenCalled(); expect(form).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(["ssn", "identifiers", "strokes", "file", "ownerId", "policyVersion", "retentionPolicyVersion", "subjectIds", "authorityDeclared"])("rejects private or repeated-authority body key %s with fixed error", async key => {
    const response = await POST(post({ ...input(), [key]: "PRIVATE-CANARY" }), context()); expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." }); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([{ acquisitionId: null }, { packetId: "bad" }, { expectedVersion: 2147483648 }, { contentSha256: "B".repeat(64) }, { byteLength: 0 }])("rejects malformed exact metadata before Auth: %j", async change => {
    expect((await POST(post({ ...input(), ...change }), context())).status).toBe(400); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("accepts exactly 4KiB JSON and rejects oversized declared/received bodies or malformed JSON", async () => {
    const text = JSON.stringify(input()), headers = { origin: site, "content-type": "application/json" };
    expect((await POST(new Request(path, { method: "POST", headers, body: text.padEnd(4096) }), context())).status).toBe(201);
    for (const body of [text.padEnd(4097), "{"]) expect((await POST(new Request(path, { method: "POST", headers, body }), context())).status).toBe(400);
    const incoming = new Request(path, { method: "POST", headers: { ...headers, "content-length": "4097" }, body: text }), read = vi.spyOn(incoming, "body", "get");
    expect((await POST(incoming, context())).status).toBe(400); expect(read).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects write query shadowing and invalid path IDs before Auth", async () => {
    expect((await POST(post(input(), undefined, `${path}?packetId=${packetId}`), context())).status).toBe(400);
    expect((await POST(post(), context("bad"))).status).toBe(400); expect((await GET(get(), context("bad"))).status).toBe(400); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([`${query}&packetId=${packetId}`, `${query}&__proto__=PRIVATE-CANARY`, `${query}&ssn=PRIVATE-CANARY`, query.replace("Version=1", "Version=01"), query.replace("Version=1", "Version=1e3"),
    query.replace("Version=1", "Version=2147483648"), query.replace(intent.snapshotHash, "bad"), "expectedVersion=1", `x=${"a".repeat(1100)}`])("rejects duplicate, unknown, missing or noncanonical query fields %#", async search => {
    const response = await GET(get(search), context()); expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." }); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("requires the actual current session and sanitizes session-service failures", async () => {
    mocks.session.mockRejectedValue(new AuthenticationRequiredError()); expect((await GET(get(), context())).status).toBe(401); expect((await POST(post(), context())).status).toBe(401);
    mocks.session.mockRejectedValue(new SessionUnavailableError()); expect((await GET(get(), context())).status).toBe(503); expect((await POST(post(), context())).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["23514", 400], ["08006", 500]] as const)("keeps SQL %s denial/private details generic", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-SQL-CANARY" } });
    for (const response of [await GET(get(), context()), await POST(post(), context())]) { expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-"); }
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-");
  });
  it("never echoes private replies or retries an uncertain metadata write", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), rawFile: "PRIVATE-REPLY-CANARY" }, error: null }); expect((await GET(get(), context())).status).toBe(500);
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY")); const response = await POST(post(), context()); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-");
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-");
  });
  it("uses packetId-omitted GET for exact current discovery, preserving the known-ID route", async () => {
    const current = await GET(get(currentQuery), context()); expect(current.status).toBe(200); expect(await current.json()).toEqual({ ok: true, authorization: result() });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_current_direct_packet", { p_request_id: requestId, p_expected_version: intent.requestVersion, p_snapshot_id: snapshotId, p_snapshot_hash: intent.snapshotHash });
    expect(current.headers.get("Cache-Control")).toBe("private, no-store"); expect(current.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await GET(get(), context()); expect(mocks.rpc.mock.calls[1][0]).toBe("parent_get_snap_direct_packet_authorization");
  });
  it("returns authorization:null only from an actual successful current-discovery SQL NULL", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); const response = await GET(get(currentQuery), context());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, authorization: null });
    expect((await GET(get(), context())).status).toBe(500);
  });
  it.each([`${currentQuery}&packetId=`, `${currentQuery}&expectedVersion=2`, `${currentQuery}&ownerId=${owner}`, currentQuery.replace(intent.snapshotHash, "bad"), "expectedVersion=1"])("keeps all other discovery query fields strict %#", async search => {
    const response = await GET(get(search), context()); expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." }); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([undefined, false, {}, { ...result(), intent: { ...intent, ownerId: acquisitionId } }, { ...result(), privateValue: "PRIVATE-REPLY-CANARY" }])("never converts malformed/unowned discovery results to successful NULL %#", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null }); const response = await GET(get(currentQuery), context()); expect(response.status).toBe(500); expect((await response.json()).ok).toBe(false);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-");
  });
  it.each([["42501", 403], ["40001", 409], ["08006", 500]] as const)("keeps discovery %s failures distinct from no registered intent", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-SQL-CANARY" } }); const response = await GET(get(currentQuery), context()); expect(response.status).toBe(status); expect((await response.json()).ok).toBe(false); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("returns 409 for a competing write and allows only an explicit metadata reload afterward", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "PRIVATE-COMPETITOR-CANARY" } });
    const conflict = await POST(post({ ...input(), packetId: acquisitionId }), context()); expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ ok: false, error: "This request changed. Reload it before saving your correction so newer information stays safe." }); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValue({ data: result(), error: null }); expect((await GET(get(currentQuery), context())).status).toBe(200);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["parent_authorize_snap_direct_packet", "parent_get_snap_current_direct_packet"]);
  });
});
