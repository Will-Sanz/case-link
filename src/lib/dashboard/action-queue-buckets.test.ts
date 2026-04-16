import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UPCOMING_WINDOW_DAYS,
  addCalendarDaysUtc,
  bucketActionableItems,
  extractDueDateKey,
} from "@/lib/dashboard/action-queue-buckets";
import type { ActionableItem } from "@/lib/services/workflow";

function item(overrides: Partial<ActionableItem>): ActionableItem {
  return {
    family_id: "family-1",
    family_name: "Alpha Family",
    step_id: "step-1",
    step_title: "Keep paperwork moving",
    step_phase: "30",
    action: "Call office",
    type: "follow_up_today",
    ...overrides,
  };
}

describe("action queue buckets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extracts a YYYY-MM-DD prefix from ISO strings", () => {
    expect(extractDueDateKey("2026-04-20T10:45:00.000Z")).toBe("2026-04-20");
    expect(extractDueDateKey("bad-date")).toBeNull();
  });

  it("adds calendar days in UTC across month boundaries", () => {
    expect(addCalendarDaysUtc("2026-01-30", 5)).toBe("2026-02-04");
  });

  it("buckets overdue, today, upcoming, and undated items while dropping distant dates", () => {
    const today = "2026-04-16";
    const upcomingEdge = addCalendarDaysUtc(today, UPCOMING_WINDOW_DAYS);

    const buckets = bucketActionableItems([
      item({ family_name: "Zulu Family", due_date: "2026-04-14", days_overdue: 2, type: "overdue" }),
      item({ family_id: "family-2", family_name: "Alpha Family", due_date: "2026-04-14", days_overdue: 5, type: "overdue" }),
      item({ family_id: "family-3", family_name: "Bravo Family", due_date: today, type: "follow_up_today" }),
      item({ family_id: "family-4", family_name: "Charlie Family", due_date: upcomingEdge, type: "follow_up_soon" }),
      item({ family_id: "family-5", family_name: "Delta Family", due_date: addCalendarDaysUtc(today, 8), type: "follow_up_soon" }),
      item({ family_id: "family-6", family_name: "Echo Family", due_date: null, type: "blocked" }),
      item({ family_id: "family-7", family_name: "Foxtrot Family", due_date: "not-a-date", type: "new_plan" }),
    ]);

    expect(buckets.overdue.map((entry) => entry.family_name)).toEqual([
      "Alpha Family",
      "Zulu Family",
    ]);
    expect(buckets.today.map((entry) => entry.family_name)).toEqual(["Bravo Family"]);
    expect(buckets.upcoming.map((entry) => entry.family_name)).toEqual(["Charlie Family"]);
    expect(buckets.undated.map((entry) => entry.family_name)).toEqual([
      "Echo Family",
      "Foxtrot Family",
    ]);
  });
});
