import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  getVisibleRange,
  navigate,
  parseCurrentDate,
  startOfMonth,
  today,
  toKey,
  toSearchParams,
} from "@/lib/utils/calendar-date";

describe("calendar date utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T09:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses month, week, and agenda current dates", () => {
    expect(toKey(parseCurrentDate("month", "2026-07", null))).toBe("2026-07-15");
    expect(toKey(parseCurrentDate("week", null, "2026-04-16"))).toBe("2026-04-13");
    expect(toKey(parseCurrentDate("agenda", null, "2026-04-16"))).toBe("2026-04-16");
  });

  it("computes visible ranges and navigation", () => {
    expect(getVisibleRange("month", new Date("2026-04-16T12:00:00.000Z"))).toEqual({
      start: "2026-04-01",
      end: "2026-04-30",
      monthLabel: "April 2026",
    });
    expect(getVisibleRange("week", new Date("2026-04-16T12:00:00.000Z"))).toEqual({
      start: "2026-04-13",
      end: "2026-04-19",
      monthLabel: "Apr 13 to Apr 19, 2026",
    });
    expect(toKey(navigate("month", new Date("2026-04-16T12:00:00.000Z"), "next"))).toBe(
      "2026-05-16",
    );
    expect(toKey(navigate("week", new Date("2026-04-16T12:00:00.000Z"), "prev"))).toBe(
      "2026-04-09",
    );
  });

  it("supports basic helpers used by the calendar UI", () => {
    expect(toKey(addDays(new Date("2026-04-16T12:00:00.000Z"), 3))).toBe("2026-04-19");
    expect(toKey(addMonths(new Date("2026-01-31T12:00:00.000Z"), 1))).toBe("2026-03-03");
    expect(toKey(startOfMonth(new Date("2026-04-16T12:00:00.000Z")))).toBe("2026-04-01");
    expect(toKey(today())).toBe("2026-04-16");
    expect(toSearchParams("month", new Date("2026-04-16T12:00:00.000Z"))).toEqual({
      view: "month",
      month: "2026-04",
    });
  });
});
