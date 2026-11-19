import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ directory: vi.fn() }));
vi.mock("@/lib/parent/partner-directory", () => ({
  getParentPartnerDirectory: mocks.directory,
}));
import { GET } from "./partners/route";

beforeEach(() => vi.clearAllMocks());
describe("parent partner directory API", () => {
  it("returns only the safe directory and disables caching", async () => {
    mocks.directory.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, partners: [] });
  });
  it("rejects a missing parent session", async () => {
    mocks.directory.mockRejectedValue(new Error("authentication required"));
    const response = await GET();
    expect(response.status).toBe(401);
    expect((await response.json()).ok).toBe(false);
  });
});
