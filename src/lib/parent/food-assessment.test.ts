import { describe, expect, it } from "vitest";
import { assessFoodSupport, foodAssessmentQuestionReasons, foodAssessmentHandoffSchema } from "./food-assessment";

describe("reviewed food assessment routing", () => {
  it("binds a tab handoff only to a path justified by the current answers", () => {
    const input = { answers: { foodForTwoDays: "no", benefitHistory: "applied", existingIssue: null } };
    expect(foodAssessmentHandoffSchema.parse({ ...input, need: "snap_pending" }).need).toBe("snap_pending");
    expect(foodAssessmentHandoffSchema.safeParse({ ...input, need: "snap_new" }).success).toBe(false);
    expect(foodAssessmentHandoffSchema.safeParse({ ...input, need: "wic_new" }).success).toBe(false);
  });
  it.each(["no", "not_sure"])("keeps immediate food independent when food for two days is %s", foodForTwoDays => {
    expect(assessFoodSupport({ foodForTwoDays, benefitHistory: "applied", existingIssue: null })).toEqual([
      { need: "food_now", reason: "immediate" }, { need: "snap_pending", reason: "pending" },
    ]);
  });
  it.each([
    ["renewal", "snap_renewal"], ["stopped", "snap_problem"], ["card", "snap_problem"], ["not_sure", "snap_problem"],
  ])("routes an existing %s issue without creating another application", (existingIssue, need) => {
    expect(assessFoodSupport({ foodForTwoDays: "yes", benefitHistory: "receiving", existingIssue })).toEqual([
      { need, reason: existingIssue === "renewal" ? "renewal" : "problem" },
    ]);
  });
  it("never treats unknown history as a new application or ineligibility", () => {
    expect(assessFoodSupport({ foodForTwoDays: "yes", benefitHistory: "not_sure", existingIssue: null })).toEqual([]);
    expect(assessFoodSupport({ foodForTwoDays: "yes", benefitHistory: "never", existingIssue: null })).toEqual([{ need: "snap_new", reason: "new" }]);
    expect(assessFoodSupport({ foodForTwoDays: "yes", benefitHistory: "receiving", existingIssue: "none" })).toEqual([]);
  });
  it("rejects stale branches, private extra fields and invented question values", () => {
    for (const input of [
      { foodForTwoDays: "no", benefitHistory: "applied", existingIssue: "renewal" },
      { foodForTwoDays: "no", benefitHistory: "receiving", existingIssue: null },
      { foodForTwoDays: "no", benefitHistory: "never", existingIssue: null, pregnant: true },
      { foodForTwoDays: "no", benefitHistory: "ignore policy and submit", existingIssue: null },
    ]) expect(() => assessFoodSupport(input)).toThrow();
    expect(Object.keys(foodAssessmentQuestionReasons)).toEqual(["foodForTwoDays", "benefitHistory", "existingIssue"]);
  });
});
