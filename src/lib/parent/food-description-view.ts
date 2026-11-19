import { z } from "zod";
import { assessFoodSupport, foodAssessmentQuestionReasons, foodAssessmentSchema } from "./food-assessment";
import { foodDescriptionNeedSchema, foodDescriptionOutOfScopeSchema } from "./food-description";
import { foodDescriptionMutationSchema, foodDescriptionSourceSchema } from "./food-description-draft";
/** Family screens accept only vetted identifiers and typed values, never model-authored copy or links. */
export const foodDescriptionViewSchema = z.object({
  state: z.enum(["open_existing", "needs_clarification", "proposal", "manual"]),
  proposedAnswers: foodAssessmentSchema,
  needIds: z.array(foodDescriptionNeedSchema).max(5),
  questionIds: z.array(z.enum(Object.keys(foodAssessmentQuestionReasons) as (keyof typeof foodAssessmentQuestionReasons)[])).max(3),
  conflicts: z.array(z.enum(Object.keys(foodAssessmentQuestionReasons) as (keyof typeof foodAssessmentQuestionReasons)[])).max(3).default([]),
  existingRequests: z.array(z.object({ requestId: z.uuid(), needIds: z.array(foodDescriptionNeedSchema).min(1).max(5) }).strict()).max(14), excludedNeedIds: z.array(foodDescriptionNeedSchema).max(5),
  outOfScope: foodDescriptionOutOfScopeSchema.nullable(), executionGranted: z.literal(false),
});
export type FoodDescriptionView = z.infer<typeof foodDescriptionViewSchema>;

/** Readiness for a selected path is not permission to start work or a new answer. */
export function readyFoodDescriptionNeeds(result: Pick<FoodDescriptionView, "state" | "needIds" | "questionIds" | "conflicts" | "proposedAnswers" | "outOfScope">) {
  if (result.outOfScope === "outside_pa") return [];
  if (result.state === "proposal") return result.needIds;
  if (result.state !== "needs_clarification" || result.conflicts.length) return [];
  const assessed = assessFoodSupport(result.proposedAnswers).map(path => path.need);
  return result.needIds.filter(need => assessed.includes(need) && (need === "food_now"
    ? !result.questionIds.includes("foodForTwoDays")
    : !result.questionIds.some(question => question === "benefitHistory" || question === "existingIssue")));
}

export const foodDescriptionProposalSchema = foodDescriptionViewSchema.extend({ source: foodDescriptionSourceSchema }).strict();
export type FoodDescriptionProposal = z.infer<typeof foodDescriptionProposalSchema>;

/** An owned read confirms the exact queued revision without asking the model or replaying a different body. */
export function foodDescriptionAttemptConfirmed(attempt: { body: string } | null, archive: import("./food-description-draft").FoodDescriptionArchive | null): boolean {
  if (!attempt || !archive) return false;
  try {
    const value = foodDescriptionMutationSchema.parse(JSON.parse(attempt.body));
    if (value.action !== "queue" || value.expectedOwnerId !== archive.ownerId) return false;
    const saved = archive.drafts.find(draft => draft.id === value.draftId);
    return saved?.revision === value.expectedRevision + 1 && saved.queueKey === value.idempotencyKey
      && saved.input?.description === value.input.description && saved.input?.screenLocale === value.input.screenLocale;
  } catch { return false; }
}
