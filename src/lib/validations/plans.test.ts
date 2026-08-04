import { describe, expect, it } from "vitest";
import { createManualStepSchema, markPlanReviewedSchema } from "@/lib/validations/plans";

const baseInput = {
  familyId: "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7",
  planId: "a7633b13-d74a-469d-80bd-40614f419e8c",
  goal: "Stabilize housing",
  title: "Call the housing intake line",
  target_date: "2026-08-10",
};

describe("createManualStepSchema", () => {
  it("accepts a goal, concrete action, and exact target date", () => {
    expect(createManualStepSchema.safeParse(baseInput).success).toBe(true);
  });

  it("rejects an action without a goal", () => {
    const result = createManualStepSchema.safeParse({ ...baseInput, goal: " " });
    expect(result.success).toBe(false);
  });

  it("rejects an action without a date-shaped target", () => {
    const result = createManualStepSchema.safeParse({ ...baseInput, target_date: "next week" });
    expect(result.success).toBe(false);
  });
});

describe("markPlanReviewedSchema", () => {
  it("accepts only family and plan identifiers", () => {
    expect(
      markPlanReviewedSchema.safeParse({
        familyId: baseInput.familyId,
        planId: baseInput.planId,
      }).success,
    ).toBe(true);
    expect(markPlanReviewedSchema.safeParse({ familyId: "not-a-family", planId: baseInput.planId }).success).toBe(false);
  });
});
