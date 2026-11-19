import { describe, expect, it } from "vitest";
import { resolveActionTargetDate } from "@/lib/domain/plan/action-target-date";

describe("resolveActionTargetDate", () => {
  it("preserves a valid proposed date within the plan window", () => {
    expect(
      resolveActionTargetDate({
        planStartDate: "2026-08-03T16:00:00Z",
        weekIndex: 2,
        proposedTargetDate: "2026-08-12",
      }),
    ).toBe("2026-08-12");
  });

  it("derives a concrete weekday date when the model omits one", () => {
    expect(
      resolveActionTargetDate({
        planStartDate: "2026-08-03",
        weekIndex: 1,
      }),
    ).toBe("2026-08-05");
  });

  it("moves deterministic weekend dates to Monday", () => {
    expect(
      resolveActionTargetDate({
        planStartDate: "2026-08-06",
        weekIndex: 1,
      }),
    ).toBe("2026-08-10");
  });

  it("rejects proposed dates outside the 90-day plan window", () => {
    expect(
      resolveActionTargetDate({
        planStartDate: "2026-08-03",
        weekIndex: 5,
        proposedTargetDate: "2027-01-01",
      }),
    ).toBe("2026-09-02");
  });
  it("anchors a timestamp to the school's day and crosses DST without shifting the chosen date", () => {
    expect(resolveActionTargetDate({ planStartDate: "2026-10-14T02:00:00Z", weekIndex: 1 })).toBe("2026-10-15");
    expect(resolveActionTargetDate({ planStartDate: "2026-03-07T23:00:00Z", weekIndex: 1 })).toBe("2026-03-09");
  });

});
