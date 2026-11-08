import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({ start: vi.fn(), startSnap: vi.fn(), get: vi.fn(), list: vi.fn(), getProgress: vi.fn(), listProgress: vi.fn(), window: vi.fn() }));
vi.mock("@/lib/parent/data", () => ({ startSupportRequest: mocks.start, getSupportRequest: mocks.get, listSupportRequests: mocks.list }));
vi.mock("@/lib/parent/snap-application-data", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/parent/snap-application-data")>(), startSnapApplication: mocks.startSnap }));
vi.mock("@/lib/parent/progress-data", () => ({ getSupportProgress: mocks.getProgress, listSupportProgress: mocks.listProgress }));
vi.mock("@/lib/parent/authorization-window", () => ({ getParentAuthorizationWindow: mocks.window }));
import { SNAP_APPLICATION_NOTICE_VERSION } from "@/lib/parent/snap-application-data";
import { POST } from "./route";
const key = "33333333-3333-4333-8333-333333333333";
const legacy = () => ({ intake: fixtureIntake(), mandate: fixtureMandate() });
const snap = () => ({ kind: "snap_application", intake: fixtureIntake({ needs: ["snap_new"] }), mandate: fixtureMandate({ recipientIds: ["snap-pa"] }), details: { zip: "19104", applicant: { firstName: "Maria" } }, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION });
function request(value: unknown, origin = "https://caselink.test") {
  return new Request("https://caselink.test/api/parent/requests", { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://caselink.test");
  mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", expiresAt: "2026-11-24T16:00:00Z", snapApplication: { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION } });
  mocks.start.mockResolvedValue(fixtureRequest().id); mocks.startSnap.mockResolvedValue(fixtureRequest().id);
  mocks.get.mockResolvedValue(fixtureRequest()); mocks.getProgress.mockResolvedValue(null);
});

describe("existing request creation and atomic SNAP variant", () => {
  it("preserves ordinary request creation", async () => {
    mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", expiresAt: "2026-11-24T16:00:00Z", snapApplication: { collectionEnabled: false, noticeVersion: null } });
    expect((await POST(request(legacy()))).status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith(legacy().intake, legacy().mandate, key);
    expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("blocks a closed initial SNAP form before private schema parsing or request creation", async () => {
    mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", expiresAt: "2026-11-24T16:00:00Z", snapApplication: { collectionEnabled: false, noticeVersion: null } });
    const response = await POST(request({ ...snap(), details: { "123-45-6789": true } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "This support request is unavailable, or its permission has changed." });
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("keeps malformed JSON generic before identifying the initial flow", async () => {
    const response = await POST(new Request("https://caselink.test/api/parent/requests", { method: "POST", headers: { origin: "https://caselink.test", "content-type": "application/json" }, body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("creates and saves initial SNAP answers through the atomic wrapper only", async () => {
    const value = snap();
    const response = await POST(request(value));
    expect(response.status).toBe(201);
    expect(mocks.startSnap).toHaveBeenCalledWith(value.intake, value.mandate, value.details, value.noticeVersion, key);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, request: fixtureRequest(), progress: null });
  });
  it.each([{ details: { "123-45-6789": "private" } }, { details: { signature: "private" } }, { noticeVersion: "wrong-purpose" }])("rejects malformed private creation without echoing it: %j", async override => {
    const response = await POST(request({ ...snap(), ...override }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(mocks.startSnap).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("keeps closed collection unavailable and never falls back to ordinary creation", async () => {
    mocks.startSnap.mockRejectedValue(new Error("This request is unavailable, or its permission has changed."));
    expect((await POST(request(snap()))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("preserves relevant recipient and same-origin checks before creation", async () => {
    expect((await POST(request({ ...snap(), mandate: fixtureMandate({ recipientIds: ["peco-cap"] }) }))).status).toBe(400);
    expect((await POST(request(snap(), "https://other.test"))).status).toBe(403);
    expect(mocks.startSnap).not.toHaveBeenCalled();
  });
});
