import { describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/parent/data", () => ({ getReusableZip: read }));
import { GET } from "./route";
describe("owned intake defaults", () => {
  it("returns only the source projection with private no-store caching", async () => {
    read.mockResolvedValue(null);
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, zip: null });
  });
  it("does not expose saved information after session or permission denial", async () => {
    read.mockRejectedValue(new Error("This request is unavailable, or its permission has changed."));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("zip");
  });
});
