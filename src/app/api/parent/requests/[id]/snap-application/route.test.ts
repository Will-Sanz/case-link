import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), window: vi.fn() }));
vi.mock("@/lib/parent/authorization-window", () => ({ getParentAuthorizationWindow: mocks.window }));
vi.mock("@/lib/parent/snap-application-data", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/parent/snap-application-data")>(), getSnapApplicationDetails: mocks.get, saveSnapApplicationDetails: mocks.save,
}));
import { SNAP_APPLICATION_NOTICE_VERSION } from "@/lib/parent/snap-application-data";
import { GET, POST } from "./route";
const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const context = () => ({ params: Promise.resolve({ id: requestId }) });
const value = () => ({ expectedVersion: 2, details: { applicant: { firstName: "Maria" }, income: { month: "2026-10", hasIncome: false } }, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION });
function request(body: unknown = value(), origin = "https://caselink.test") {
  return new Request(`https://caselink.test/api/parent/requests/${requestId}/snap-application`, { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://caselink.test"); mocks.save.mockResolvedValue(snapshotId);
  mocks.window.mockResolvedValue({ snapApplication: { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION } });
});

describe("private owned SNAP details endpoint", () => {
  it("reads the exact revision privately without changing saved facts", async () => {
    const snapshot = { id: snapshotId, ...value() }; mocks.get.mockResolvedValue(snapshot);
    const response = await GET(new Request(`https://caselink.test/path?revision=${snapshotId}`), context());
    expect(mocks.get).toHaveBeenCalledWith(requestId, snapshotId);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, snapshot });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns a generic missing response when ownership hides a revision", async () => {
    mocks.get.mockResolvedValue(null);
    const response = await GET(new Request("https://caselink.test/path"), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "This saved application is unavailable." });
  });
  it("keeps owned history readable while new collection is closed", async () => {
    mocks.window.mockResolvedValue({ snapApplication: { collectionEnabled: false, noticeVersion: null } });
    const snapshot = { id: snapshotId, ...value() }; mocks.get.mockResolvedValue(snapshot);
    expect((await GET(new Request("https://caselink.test/path"), context())).status).toBe(200);
    expect(mocks.window).not.toHaveBeenCalled();
  });
  it("rejects closed collection before reading the body or invoking the save", async () => {
    mocks.window.mockResolvedValue({ snapApplication: { collectionEnabled: false, noticeVersion: null } });
    const input = request();
    const body = vi.spyOn(input, "body", "get");
    expect((await POST(input, context())).status).toBe(403);
    expect(body).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("saves full details once and returns a reference without private values", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(requestId, value(), key);
    expect(await response.json()).toEqual({ ok: true, snapshotId });
  });
  it("passes explicit stable fact confirmations to the owned save without adding a review approval", async () => {
    const input = { ...value(), details: { ...value().details, address: { street: "1 Synthetic Street" } }, confirmedPaths: ["address.street"] };
    expect((await POST(request(input), context())).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(requestId, input, key);
  });
  it("accepts the supported bounded household and income rows beyond the ordinary JSON limit", async () => {
    const rowId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const details = {
      household: Array.from({ length: 30 }, (_, index) => ({ id: rowId(index + 1), firstName: "a".repeat(80), lastName: "b".repeat(80), dateOfBirth: "1980-01-01", relationship: index === 0 ? "SELF" : "relative", requestingSnap: true, citizen: true })),
      income: { month: "2026-11", hasIncome: true, entries: Array.from({ length: 100 }, (_, index) => ({ id: rowId(index + 101), personId: rowId(1), source: "a".repeat(100), frequency: "b".repeat(60), amount: 1000000, status: "received", date: "2026-11-01" })) },
    };
    const body = { ...value(), details };
    expect(JSON.stringify(body).length).toBeGreaterThan(40000);
    expect(JSON.stringify(body).length).toBeLessThan(65536);
    expect((await POST(request(body), context())).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(requestId, body, key);
  });
  it.each([{ details: { "123-45-6789": true } }, { details: { ssn: "123-45-6789" } }, { noticeVersion: "not-accepted" }, { source: "client-invented" }])("rejects private malformed input with a fixed message: %j", async override => {
    const response = await POST(request({ ...value(), ...override }), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects a foreign origin before reading or saving private input", async () => {
    expect((await POST(request(value(), "https://other.test"), context())).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("keeps closed collection and changed-revision errors private", async () => {
    mocks.save.mockRejectedValueOnce(new Error("This request is unavailable, or its permission has changed."));
    expect((await POST(request(), context())).status).toBe(403);
    mocks.save.mockRejectedValueOnce(new Error("This request changed. Reload it before saving your update."));
    expect((await POST(request(), context())).status).toBe(409);
  });
});
