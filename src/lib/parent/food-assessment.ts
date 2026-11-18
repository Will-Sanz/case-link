import { z } from "zod";
import type { SupportNeed } from "./domain";

// Reviewed routing questions; these answers make no eligibility or award decision.
export const foodAssessmentQuestionReasons = {
  foodForTwoDays: "Determine whether immediate food help should be offered before benefit paperwork.",
  benefitHistory: "Avoid creating a new application for an existing or pending benefit.",
  existingIssue: "Distinguish renewal, a benefit problem and an unresolved existing case.",
} as const;

export const foodAssessmentSchema = z.object({
  foodForTwoDays: z.enum(["yes", "no", "not_sure"]),
  benefitHistory: z.enum(["never", "applied", "receiving", "not_sure"]),
  existingIssue: z.enum(["renewal", "stopped", "card", "none", "not_sure"]).nullable(),
}).strict().superRefine((answers, context) => {
  if (answers.benefitHistory === "receiving" ? answers.existingIssue === null : answers.existingIssue !== null)
    context.addIssue({ code: "custom", path: ["existingIssue"], message: "Choose the question for your current benefit history." });
});
export type FoodAssessmentAnswers = z.infer<typeof foodAssessmentSchema>;
export type FoodRecommendation = { need: SupportNeed; reason: "immediate" | "new" | "pending" | "renewal" | "problem" };

/** Proposed paths only. Exact facts and the existing named mandate still precede any start. */
export function assessFoodSupport(input: unknown): FoodRecommendation[] {
  const answers = foodAssessmentSchema.parse(input);
  const paths: FoodRecommendation[] = [];
  if (answers.foodForTwoDays !== "yes") paths.push({ need: "food_now", reason: "immediate" });
  if (answers.benefitHistory === "never") paths.push({ need: "snap_new", reason: "new" });
  else if (answers.benefitHistory === "applied") paths.push({ need: "snap_pending", reason: "pending" });
  else if (answers.benefitHistory === "receiving") {
    if (answers.existingIssue === "renewal") paths.push({ need: "snap_renewal", reason: "renewal" });
    else if (["stopped", "card", "not_sure"].includes(answers.existingIssue!)) paths.push({ need: "snap_problem", reason: "problem" });
  }
  return paths;
}
