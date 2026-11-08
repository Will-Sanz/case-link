import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session }));
import { GET, POST } from "./route";

const site = "https://caselink.test", requestId = "abcdef12-3456-4789-abcd-123456789abc", packetId = "abcdef12-3456-4789-abcd-123456789def";
const path = `${site}/api/parent/requests/${requestId}/snap-application/capture`;
const context = (id = requestId) => ({ params: Promise.resolve({ id }) });
const progress = { packetId, requestVersion: 3, state: "pending", reason: null };
const input = { expectedVersion: 3, previousPacketId: packetId };
const deniedCorrectionOrigins: Record<string, string>[] = [{}, { origin: "https://other.test" }];
const deniedReadOrigins: Record<string, string>[] = [{ origin: "https://other.test" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
const get = (query = "expectedVersion=3", headers: Record<string, string> = {}) => new Request(`${path}?${query}`, { headers });
const post = (body: unknown = input, headers: Record<string, string> = { origin: site, "content-type": "application/json" }, url = path) => new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", site); vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } }); mocks.rpc.mockResolvedValue({ data: progress, error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("owned SNAP private file continuation HTTP bridge", () => {
  it.each([
    progress, { ...progress, state: "checked" },
    { ...progress, state: "needs_parent", reason: "page_1_unreadable" },
    { ...progress, state: "service_unavailable", reason: "check_unavailable" },
    { ...progress, state: "unavailable", reason: "permission_or_file_unavailable" }, null,
  ])("returns only the exact owned durable metadata: %j", async capture => {
    mocks.rpc.mockResolvedValue({ data: capture, error: null });
    const response = await GET(get(), context()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, capture });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_current_capture", { p_request: requestId, p_version: 3 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("normalizes valid uppercase IDs without selecting a different packet", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...progress, packetId: packetId.toUpperCase() }, error: null });
    expect(await (await GET(get(), context(requestId.toUpperCase()))).json()).toEqual({ ok: true, capture: progress });
    expect(mocks.rpc.mock.calls[0][1].p_request).toBe(requestId);
  });
  it("makes one explicit exact correction and permits read-only recovery through the original replay", async () => {
    mocks.rpc.mockResolvedValue({ data: 4, error: null });
    for (let i = 0; i < 2; i++) {
      const response = await POST(post(), context()); expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, requestVersion: 4 });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mocks.rpc.mock.calls).toEqual(Array.from({ length: 2 }, () => ["parent_replace_snap_personal_pages", { p_request: requestId, p_version: 3, p_previous_packet: packetId }]));
  });
  it.each(deniedCorrectionOrigins)("rejects a correction without exact origin before reading its body: %j", async headers => {
    const incoming = post(input, { ...headers, "content-type": "application/json" }), read = vi.spyOn(incoming, "body", "get");
    expect((await POST(incoming, context())).status).toBe(403); expect(read).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(deniedReadOrigins)("denies foreign metadata reads before Auth: %j", async headers => {
    expect((await GET(get(undefined, headers), context())).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(["", "expectedVersion=03", "expectedVersion=1e3", "expectedVersion=2147483648", "expectedVersion=3&expectedVersion=4", "expectedVersion=3&ssn=PRIVATE-CANARY", "expectedVersion=3&__proto__=PRIVATE-CANARY", `x=${"a".repeat(100)}`])("rejects ambiguous or private query input %#", async query => {
    const response = await GET(get(query), context()); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." }); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([{ expectedVersion: 0 }, { expectedVersion: 2147483647 }, { previousPacketId: "invalid" }, { ssn: "PRIVATE-CANARY" }, { signature: "PRIVATE-CANARY" }])("rejects invalid or private correction fields %#", async change => {
    const response = await POST(post({ ...input, ...change }), context()); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." }); expect(mocks.session).not.toHaveBeenCalled();
  });
  it("bounds metadata, rejects raw files and never permits query shadowing", async () => {
    expect((await POST(post({ ...input, extra: "x".repeat(300) }), context())).status).toBe(400);
    const incoming = post(input, { origin: site, "content-type": "application/pdf" }), read = vi.spyOn(incoming, "body", "get");
    expect((await POST(incoming, context())).status).toBe(400); expect(read).not.toHaveBeenCalled();
    expect((await POST(post(input, undefined, `${path}?expectedVersion=3`), context())).status).toBe(400);
    expect((await GET(get(), context("invalid"))).status).toBe(400); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([
    { requestVersion: 4 }, { state: "checked", reason: "page_1_unreadable" }, { state: "needs_parent", reason: "check_unavailable" },
    { state: "service_unavailable", reason: "PRIVATE-CANARY" }, { ciphertext: "PRIVATE-CANARY" }, { packetId: "invalid" },
  ])("rejects mismatched or private provider metadata %#", async change => {
    mocks.rpc.mockResolvedValue({ data: { ...progress, ...change }, error: null });
    const response = await GET(get(), context()); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-");
  });
  it.each([3, 5, "4", null, { version: 4 }])("never claims a confirmed correction from an invalid result %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null }); expect((await POST(post(), context())).status).toBe(500);
  });
  it("keeps unknown delivery recoverable, contains private errors, and preserves conflict and ownership denials", async () => {
    for (const [code, status] of [["40001", 409], ["42501", 403], ["XX000", 500]]) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-CANARY" } });
      const response = await POST(post(), context()); expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-");
    }
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-CANARY"));
    for (const response of [await POST(post(), context()), await GET(get(), context())]) expect(response.status).toBe(500);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-");
  });
  it("requires the current parent session for both methods", async () => {
    mocks.session.mockRejectedValue(new Error("Sign in again"));
    expect((await GET(get(), context())).status).toBe(401); expect((await POST(post(), context())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
