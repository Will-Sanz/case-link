import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/parent/food-sites", () => ({ findFoodSites: mocks.find }));
import { GET } from "./food-sites/route";

beforeEach(() => vi.clearAllMocks());
describe("public urgent food discovery API", () => {
  it("allows real discovery without requiring a parent account", async () => {
    mocks.find.mockResolvedValue({
      sites: [],
      availability: "city_listed_unconfirmed",
    });
    const response = await GET(
      new Request("https://case.invalid/api/parent/food-sites?zip=19104"),
    );
    expect(response.status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith("19104");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("validates ZIP and returns official fallback access on source failure", async () => {
    const invalid = await GET(
      new Request("https://case.invalid/api/parent/food-sites?zip=10001"),
    );
    expect(invalid.status).toBe(400);
    expect(mocks.find).not.toHaveBeenCalled();
    mocks.find.mockRejectedValue(new Error("private upstream detail"));
    const response = await GET(
      new Request("https://case.invalid/api/parent/food-sites?zip=19104"),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private upstream");
  });
});
