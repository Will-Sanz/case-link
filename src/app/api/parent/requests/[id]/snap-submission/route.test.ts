import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/parent/snap-submission-data", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/parent/snap-submission-data")>(), authorizeSnapSubmission: mocks.authorize, getSnapSubmissionReview: mocks.review,
}));
import { GET, POST } from "./route";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "@/lib/parent/snap-protected-operation";
const requestId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const input = () => ({ operationId, artifactId: "33333333-3333-4333-8333-333333333333", expectedVersion: 2, packetHash: "a".repeat(64), contentSha256: "b".repeat(64) });
function request(body: unknown = input(), origin = "https://caselink.test", contentType = "application/json") {
  return new Request(`https://caselink.test/api/parent/requests/${requestId}/snap-submission`, { method: "POST", headers: { origin, "content-type": contentType }, body: JSON.stringify(body) });
}
const context = (id = requestId) => ({ params: Promise.resolve({ id }) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://caselink.test"); mocks.authorize.mockResolvedValue(operationId); });

describe("exact parent SNAP Submit endpoint", () => {
  it("recovers current owned review metadata privately without recording Submit", async () => {
    mocks.review.mockResolvedValue(null);
    const response = await GET(new Request(`https://caselink.test/api/parent/requests/${requestId}/snap-submission?expectedVersion=2`), context());
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, review: null });
    expect(mocks.review).toHaveBeenCalledExactlyOnceWith(requestId, { expectedVersion: 2 }); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it.each(["expectedVersion=2&expectedVersion=3", "expectedVersion=02", "expectedVersion=2&ssn=PRIVATE-CANARY", "expectedVersion=2147483648"])("rejects ambiguous review scope %#", async query => {
    expect((await GET(new Request(`https://caselink.test/?${query}`), context())).status).toBe(400); expect(mocks.review).not.toHaveBeenCalled();
  });
  it.each(["origin", "sec-fetch-site"])("denies cross-origin review before the owned lookup: %s", async name => {
    expect((await GET(new Request("https://caselink.test/?expectedVersion=2", { headers: { [name]: name === "origin" ? "https://other.test" : "same-site" } }), context())).status).toBe(403);
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("accepts the additive protected tuple without changing the decision-only response", async () => {
    const { artifactId: packetId, ...common } = input(), body = { ...common, packetId, completedActs: [...SNAP_PARENT_CERTIFICATION_ACTS] };
    const response = await POST(request(body), context());
    expect(response.status).toBe(202); expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(requestId, body);
    expect(await response.json()).toEqual({ ok: true, operationId, state: "authorization_recorded" });
  });
  it("rejects mixed tuples and raw signature fields without recording a decision", async () => {
    for (const body of [{ ...input(), packetId: operationId, completedActs: [...SNAP_PARENT_CERTIFICATION_ACTS] },
      { ...input(), signature: "PRIVATE_SYNTHETIC_CANARY" }]) {
      const response = await POST(request(body), context()); expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_SYNTHETIC_CANARY");
    }
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("records the exact decision privately without claiming a filing or agency confirmation", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(202); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(requestId, input());
    expect(await response.json()).toEqual({ ok: true, operationId, state: "authorization_recorded" });
  });
  it("rejects a foreign origin before reading the body or recording a decision", async () => {
    const incoming = request(input(), "https://other.test"); const read = vi.spyOn(incoming, "body", "get");
    expect((await POST(incoming, context())).status).toBe(403); expect(read).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it.each([
    { ...input(), expectedVersion: 0 }, { ...input(), contentSha256: "unknown" },
    { ...input(), signature: "PRIVATE-CANARY" }, { ...input(), ssn: "123-45-6789" },
    { ...input(), extra: "x".repeat(3000) },
  ])("keeps invalid input and unexpected private values out of errors", async body => {
    const response = await POST(request(body), context());
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("requires the exact path and a bounded JSON body", async () => {
    expect((await POST(request(), context("invalid"))).status).toBe(400);
    expect((await POST(request(input(), "https://caselink.test", "text/plain"), context())).status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it.each([
    ["This request is unavailable, or its permission has changed.", 403],
    ["Sign in again", 401], ["parent_snap_submission_not_ready", 409],
  ])("reports authority or execution issues without a false success: %s", async (message, status) => {
    mocks.authorize.mockRejectedValue(new Error(message));
    const response = await POST(request(), context()); expect(response.status).toBe(status);
    expect((await response.json()).ok).toBe(false);
  });
});
