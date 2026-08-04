import { describe, expect, it } from "vitest";
import {
  createManualStepSchema,
  markPlanReviewedSchema,
  updatePlanStepActionItemSchema,
  updatePlanStepSchema,
} from "@/lib/validations/plans";

const baseInput = {
  familyId: "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7",
  planId: "a7633b13-d74a-469d-80bd-40614f419e8c",
  goal: "Stabilize housing",
  title: "Call the housing intake line",
  target_date: "2026-08-10",
  details: { owner: "case_manager" as const, expected_outcome: "Intake is completed." },
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

describe("plan execution schemas", () => {
  it("accepts an explicit action owner", () => {
    expect(
      updatePlanStepSchema.safeParse({
        familyId: baseInput.familyId,
        stepId: "160e28d7-438d-4e85-844b-abb90b7e6ef4",
        details: { owner: "shared" },
      }).success,
    ).toBe(true);
  });

  it("accepts outcome, note, and follow-up updates without regenerating the plan", () => {
    expect(
      updatePlanStepActionItemSchema.safeParse({
        familyId: baseInput.familyId,
        actionItemId: "596a15f1-aa32-4371-b9c7-dfa081c85497",
        expectedUpdatedAt: "2026-08-03T20:30:00.000Z",
        status: "blocked",
        notes: "Waiting for the program to return the call.",
        follow_up_date: "2026-08-12",
        outcome: "Voicemail left.",
      }).success,
    ).toBe(true);
  });
});
