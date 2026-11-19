import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/parent/family-profile-data", () => ({ getFamilyProfile: mocks.get, saveFamilyProfile: mocks.save, clearFamilyProfile: mocks.clear }));
import { GET, POST, DELETE } from "./route";
import { FAMILY_PROFILE_NOTICE_VERSION } from "@/lib/parent/family-profile";
const owner = "00000000-0000-4000-8000-000000000001", key = "00000000-0000-4000-8000-000000000002";
const details = { primaryPerson: { id: key, firstName: "Pat" } };
const value = { expectedOwnerId: owner, expectedRevision: 0, details, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true };
const request = (method: string, body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/parent/family-profile", { method, headers: { Origin: "http://localhost", "Content-Type": "application/json", "Idempotency-Key": key, ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost"); mocks.get.mockResolvedValue({ ownerId: owner, revision: 0, profile: null, lastMutationKey: null, collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: "2026-12-01T00:00:00Z", retentionDays: 45 } }); mocks.save.mockResolvedValue(1); mocks.clear.mockResolvedValue(2); });
describe("family profile boundary", () => {
  it("reads without caching and uses one exact typed save with its retry key", async () => {
    expect((await GET()).headers.get("cache-control")).toBe("private, no-store");
    const result = await POST(request("POST", value)); expect(result.status).toBe(201); expect(await result.json()).toEqual({ ok: true, revision: 1 }); expect(mocks.save).toHaveBeenCalledWith(value, key);
  });
  it("checks the separate collection gate before reading the write body", async () => {
    mocks.get.mockResolvedValue({ collection: { collectionEnabled: false } }); const input = request("POST", value), read = vi.spyOn(input, "body", "get");
    expect((await POST(input)).status).toBe(403); expect(read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, raw identifier fields and missing exact retry keys", async () => {
    expect((await POST(request("POST", value, { Origin: "https://elsewhere.invalid" }))).status).toBe(403);
    expect((await POST(request("POST", { ...value, details: { ...details, ssn: "private canary" } }))).status).toBe(400);
    expect((await POST(request("POST", value, { "Idempotency-Key": "invalid" }))).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("clears with exact owner/revision/key even when collection closes", async () => {
    mocks.get.mockResolvedValue({ collection: { collectionEnabled: false } }); const clear = { expectedOwnerId: owner, expectedRevision: 1 };
    expect((await DELETE(request("DELETE", clear))).status).toBe(200); expect(mocks.clear).toHaveBeenCalledWith(clear, key); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("reports a concurrent change without echoing private input", async () => {
    mocks.save.mockRejectedValue(new Error("This request changed. Reload it.")); const result = await POST(request("POST", value)); expect(result.status).toBe(409); expect(await result.text()).not.toContain("Pat");
  });
});
