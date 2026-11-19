import { afterEach, describe, expect, it } from "vitest";
import { addCalendarDays, formatDateOnly, formatSchoolTimestamp, parseDateOnly, schoolDate } from "./dates";

const originalTimezone = process.env.TZ;
afterEach(() => { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; });

describe("school calendar dates", () => {
  it.each(["UTC", "America/Los_Angeles", "Pacific/Auckland"])("keeps exact dates and school midnight stable on a device in %s", timezone => {
    process.env.TZ = timezone;
    expect(schoolDate(new Date("2026-10-14T02:00:00Z"))).toBe("2026-10-13");
    expect(schoolDate(new Date("2026-10-14T04:00:00Z"))).toBe("2026-10-14");
    expect(formatDateOnly("2028-02-29")).toBe("Feb 29, 2028");
    expect(formatDateOnly("2026-11-01T00:00:00+00:00")).toBe("Nov 1, 2026");
    expect(formatSchoolTimestamp("2026-10-19T03:30:00Z")).toBe("Oct 18, 2026, 11:30 PM");
  });
  it("handles leap days and daylight saving changes as calendar arithmetic", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addCalendarDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(schoolDate(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(schoolDate(new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
  });
  it.each(["0000-01-01", "2026-02-29", "2026-02-31", "2026-13-01", "2026-10-1", "2026-10-01T00:00:00Z", ""])("rejects invalid date-only input %s", value => {
    expect(parseDateOnly(value)).toBeNull();
    expect(() => addCalendarDays(value, 1)).toThrow();
  });
});
