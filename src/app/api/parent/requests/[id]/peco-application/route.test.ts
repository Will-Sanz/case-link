import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ collection: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/parent/peco-application-data", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/parent/peco-application-data")>(), getPecoApplicationCollection: mocks.collection, getPecoApplicationDetails: mocks.get, savePecoApplicationDetails: mocks.save,
}));
import { PECO_APPLICATION_NOTICE_VERSION as notice } from "@/lib/parent/peco-application-fields";
import { GET, POST } from "./route";
const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const context = () => ({ params: Promise.resolve({ id: requestId }) });
const value = () => ({ expectedVersion: 2, details: { journey: "unknown" }, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true });
function request(body: unknown = value(), origin = "https://caselink.test") {
  return new Request(`https://caselink.test/api/parent/requests/${requestId}/peco-application`, { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://caselink.test"); mocks.save.mockResolvedValue(snapshotId); mocks.collection.mockResolvedValue({ collectionEnabled: true, noticeVersion: notice, expiresAt: "2026-11-20T20:06:00Z" }); });
describe("owned private PECO preparation endpoint", () => {
  it("returns private owned history without requiring collection to remain open", async () => {
    const snapshot = { id: snapshotId }; mocks.get.mockResolvedValue(snapshot);
    const response = await GET(new Request(`https://caselink.test/path?revision=${snapshotId}`), context());
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(await response.json()).toEqual({ ok: true, snapshot });
    expect(mocks.get).toHaveBeenCalledWith(requestId, snapshotId); expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("hides unavailable revisions with the same missing response", async () => {
    mocks.get.mockResolvedValue(null); const response = await GET(new Request("https://caselink.test/path"), context());
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ ok: false, error: "This saved application is unavailable." });
  });
  it("rejects closed collection before reading a private body", async () => {
    mocks.collection.mockResolvedValue({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
    const input = request({ details: { ssn: "123-45-6789" } }), body = vi.spyOn(input, "body", "get");
    expect((await POST(input, context())).status).toBe(403); expect(body).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns only the saved reference after the exact bounded write", async () => {
    const response = await POST(request(), context()); expect(response.status).toBe(201); expect(await response.json()).toEqual({ ok: true, snapshotId });
    expect(mocks.save).toHaveBeenCalledWith(requestId, value(), key);
  });
  it("rejects an oversized body before saving otherwise valid private input", async () => {
    const input = request(); input.headers.set("content-length", "65537");
    expect((await POST(input, context())).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([{ details: { ssn: "123-45-6789" } }, { noticeVersion: "wic-application-details-2026-11-13.v1" }, { subjectAuthorityDeclared: false }, { accountAuthorityDeclared: undefined }])("rejects cross-purpose or missing authority input safely", async override => {
    const response = await POST(request({ ...value(), ...override }), context()); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." }); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects foreign origins before collecting anything", async () => {
    expect((await POST(request(value(), "https://other.test"), context())).status).toBe(403); expect(mocks.collection).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not echo private values when a commit becomes unknown", async () => {
    mocks.save.mockRejectedValue(new Error("database PecoPrivateCanary")); const response = await POST(request(), context());
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("PecoPrivateCanary");
  });
});
