import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/auth/safe-internal-path";

describe("safeInternalPath", () => {
  it("keeps same-origin paths with query strings", () => {
    expect(safeInternalPath("/families/123?tab=plan#review")).toBe(
      "/families/123?tab=plan#review",
    );
  });

  it.each([
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example/path",
    "/%2f%2fevil.example/path",
    "/%255c%255cevil.example/path",
    "/families\nLocation:%20https://evil.example",
    "%2f%2fevil.example",
  ])("rejects unsafe redirect %s", (value) => {
    expect(safeInternalPath(value)).toBe("/families");
  });
});
