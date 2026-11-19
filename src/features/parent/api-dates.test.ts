import { describe, expect, it } from "vitest";
import { displayDate } from "./api";

describe("parent interface dates", () => {
  it("uses the selected language while keeping the same Eastern date and time", () => {
    expect(displayDate("2026-11-18T02:30:00Z", true, "es")).toMatch(/^17 nov 2026, 9:30 p\. ?m\.$/);
    expect(displayDate("2026-11-18T02:30:00Z", true)).toBe("Nov 17, 2026, 9:30 PM");
  });
  it("preserves calendar-only dates and translates the unavailable state", () => {
    expect(displayDate("2026-03-08", false, "es")).toBe("8 mar 2026");
    expect(displayDate("not a date", false, "es")).toBe("Fecha no disponible");
    expect(displayDate("not a date")).toBe("Date unavailable");
  });
});
