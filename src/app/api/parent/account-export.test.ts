import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ export: vi.fn() }));
vi.mock("@/lib/parent/data", () => ({ exportParentInformation: mocks.export }));
import { GET } from "./account/export/route";
beforeEach(() => vi.clearAllMocks());
describe("complete parent information export", () => {
  it("returns the complete paginated snapshot as a private attachment", async () => {
    const information = {
      exportedAt: "2026-10-26T12:00:00Z",
      household: { id: "own-household" },
      requests: Array.from({ length: 105 }, (_, id) => ({
        id,
        events: Array.from({ length: 205 }, (_, event) => ({ id: event })),
      })),
    };
    mocks.export.mockResolvedValue(information);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(information);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toContain(
      "attachment;",
    );
    expect(mocks.export).toHaveBeenCalledTimes(1);
  });
  it("does not return a partial attachment after a data page fails", async () => {
    mocks.export.mockRejectedValue(new Error("database sensitive detail"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).not.toContain("sensitive detail");
  });
});
