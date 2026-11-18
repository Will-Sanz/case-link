import { z } from "zod";
import { foodAssessmentQuestionReasons, foodAssessmentSchema } from "./food-assessment";
import { foodDescriptionInputSchema, foodDescriptionProjectionSchema, foodDescriptionSelectionSchema } from "./food-description";
export const FOOD_DESCRIPTION_NOTICE_VERSION = "food-description-2026-11-18.v1";
export { foodDescriptionSourceSchema } from "./food-assessment";
export const foodDescriptionRoutingAnswersSchema = z.object({
  foodForTwoDays: z.object({ value: foodAssessmentSchema.shape.foodForTwoDays, confirmedAt: z.iso.datetime({ offset: true }) }).strict().optional(),
  benefitHistory: z.object({ value: foodAssessmentSchema.shape.benefitHistory, confirmedAt: z.iso.datetime({ offset: true }) }).strict().optional(),
  existingIssue: z.object({ value: foodAssessmentSchema.shape.existingIssue.unwrap(), confirmedAt: z.iso.datetime({ offset: true }) }).strict().optional(),
}).strict();
export type FoodDescriptionRoutingAnswers = z.infer<typeof foodDescriptionRoutingAnswersSchema>;
const owner = z.uuid(), key = z.uuid(), revision = z.number().int().nonnegative().max(2147483646);
export const foodDescriptionMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), expectedOwnerId: owner, idempotencyKey: key, noticeVersion: z.literal(FOOD_DESCRIPTION_NOTICE_VERSION), consentAccepted: z.literal(true) }).strict(),
  z.object({ action: z.literal("queue"), expectedOwnerId: owner, draftId: key, expectedRevision: revision, idempotencyKey: key, input: foodDescriptionInputSchema, routingAnswers: foodDescriptionRoutingAnswersSchema.optional() }).strict(),
  z.object({ action: z.literal("resolve"), expectedOwnerId: owner, draftId: key, expectedRevision: revision, idempotencyKey: key, answers: foodAssessmentSchema, changedQuestionIds: z.array(z.enum(Object.keys(foodAssessmentQuestionReasons) as (keyof typeof foodAssessmentQuestionReasons)[])).max(3).refine(values => new Set(values).size === values.length) }).strict(),
  z.object({ action: z.literal("cancel"), expectedOwnerId: owner, draftId: key }).strict(),
]);
export const foodDescriptionArchiveSchema = z.object({ ownerId: owner, available: z.boolean(), drafts: z.array(z.object({
  id: key, revision, state: z.enum(["empty", "queued", "running", "result", "failed", "unknown", "cancelled", "expired"]), noticeVersion: z.literal(FOOD_DESCRIPTION_NOTICE_VERSION),
  consentedAt: z.iso.datetime({ offset: true }), createdAt: z.iso.datetime({ offset: true }), contentExpiresAt: z.iso.datetime({ offset: true }), metadataExpiresAt: z.iso.datetime({ offset: true }),
  input: foodDescriptionInputSchema.nullable(), projection: foodDescriptionProjectionSchema.nullable(), selection: foodDescriptionSelectionSchema.nullable(), queueKey: key.nullable(), sameChargedContext: z.boolean(),
  usage: z.array(z.object({ revision: revision.positive(), projectId: z.string().regex(/^proj_[A-Za-z0-9_-]{1,100}$/), modelProjection: foodDescriptionProjectionSchema.nullable(), selection: foodDescriptionSelectionSchema.nullable(), chargedAt: z.iso.datetime({ offset: true }), usage: z.object({ complete: z.boolean(),
    inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), cachedInputTokens: z.number().int().nonnegative().optional(), cacheWriteInputTokens: z.number().int().nonnegative().optional(), cacheWrite30mInputTokens: z.number().int().nonnegative().optional(), cacheWrite12hInputTokens: z.number().int().nonnegative().optional(), reasoningTokens: z.number().int().nonnegative().optional(),
    responseId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(), requestId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
  }).strict().nullable() }).strict()).max(3),
}).strict()).max(12) }).strict();
export type FoodDescriptionArchive = z.infer<typeof foodDescriptionArchiveSchema>;
export class FoodDescriptionError extends Error {
  constructor(readonly status: number, readonly code: "unavailable" | "changed" | "invalid" | "resource_limit" | "service") { super(code); }
}
