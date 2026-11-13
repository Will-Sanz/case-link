import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest, fixtureIntake } from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), window: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/parent/authorization-window", () => ({ getParentAuthorizationWindow: mocks.window }));
vi.mock("@/lib/parent/data", () => ({ getSupportRequest: mocks.request }));
vi.mock("@/lib/parent/wic-application-data", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/parent/wic-application-data")>(), getWicApplicationDetails: mocks.get, saveWicApplicationDetails: mocks.save,
}));
import { WIC_APPLICATION_NOTICE_VERSION as notice } from "@/lib/parent/wic-application-data";
import { GET, POST } from "./route";
const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const context = () => ({ params: Promise.resolve({ id: requestId }) });
const value = () => ({ expectedVersion: 2, details: { contact: { firstName: "WicPrivateCanary" } }, noticeVersion: notice, subjectAuthorityDeclared: true });
function request(body: unknown = value(), origin = "https://caselink.test") {
  return new Request(`https://caselink.test/api/parent/requests/${requestId}/wic-application`, { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://caselink.test"); mocks.save.mockResolvedValue(snapshotId);
  mocks.window.mockResolvedValue({ wicApplication: { collectionEnabled: true, noticeVersion: notice } });
  mocks.request.mockResolvedValue(fixtureRequest({ intake: fixtureIntake({ needs: ["wic_new"] }), created_at: new Date().toISOString() }));
});
describe("private owned WIC details endpoint", () => {
  it("returns private history plus separate household-routing context without inferring a contact postal ZIP", async () => {
    const snapshot = { id: snapshotId, ...value() }; mocks.get.mockResolvedValue(snapshot);
    const response = await GET(new Request(`https://caselink.test/path?revision=${snapshotId}`), context());
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith(requestId, snapshotId);
    expect(await response.json()).toEqual({ ok: true, snapshot, routingContext: {
      label: "Household routing ZIP only; this does not establish the contact's postal address.", zip: "19104",
    } });
    expect(mocks.window).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not assert current routing context when its evidence is stale", async () => {
    mocks.get.mockResolvedValue({ id: snapshotId, ...value() });
    mocks.request.mockResolvedValue(fixtureRequest({ intake: fixtureIntake({ needs: ["wic_new"] }), created_at: "2025-01-01T12:00:00Z" }));
    const response = await GET(new Request("https://caselink.test/path"), context());
    expect((await response.json()).routingContext.zip).toBeNull();
  });
  it("returns a generic missing response when ownership hides a revision", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await GET(new Request("https://caselink.test/path"), context());
    expect(response.status).toBe(404); expect(mocks.request).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: false, error: "This saved application is unavailable." });
  });
  it.each([{}, { snapApplication: { collectionEnabled: true } }, { wicApplication: { collectionEnabled: false, noticeVersion: null } }])("does not parse private input when WIC collection is unproved: %j", async gate => {
    mocks.window.mockResolvedValue(gate);
    const input = request({ details: { "123-45-6789": "private" } }), body = vi.spyOn(input, "body", "get");
    expect((await POST(input, context())).status).toBe(403);
    expect(body).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns only the saved reference after one bounded write", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ ok: true, snapshotId });
    expect(mocks.save).toHaveBeenCalledWith(requestId, value(), key);
  });
  it.each([{ details: { contact: { zip: "invalid" } } }, { details: { ssn: "123-45-6789" } }, { noticeVersion: "snap-application-details-2026-11-03.v1" }, { details: { kind: "synthetic_rehearsal" } }, { subjectAuthorityDeclared: false }, { subjectAuthorityDeclared: undefined }])("rejects cross-purpose input with a fixed message", async override => {
    const response = await POST(request({ ...value(), ...override }), context());
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects foreign origins before collecting private input", async () => {
    expect((await POST(request(value(), "https://other.test"), context())).status).toBe(403);
    expect(mocks.window).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("keeps service errors and unknown commits private", async () => {
    mocks.save.mockRejectedValue(new Error("database WicPrivateCanary"));
    const response = await POST(request(), context());
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("WicPrivateCanary");
  });
});
