import { z } from "zod";
import { foodDescriptionInputSchema, foodDescriptionProjectionSchema, foodDescriptionSelectionSchema } from "./food-description";
export const FOOD_DESCRIPTION_NOTICE_VERSION = "food-description-2026-11-18.v1";
export const foodDescriptionSourceSchema = z.object({ draftId: z.uuid(), revision: z.number().int().positive() }).strict();
const owner = z.uuid(), key = z.uuid(), revision = z.number().int().nonnegative().max(2147483646);
export const foodDescriptionMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), expectedOwnerId: owner, idempotencyKey: key, noticeVersion: z.literal(FOOD_DESCRIPTION_NOTICE_VERSION), consentAccepted: z.literal(true) }).strict(),
  z.object({ action: z.literal("queue"), expectedOwnerId: owner, draftId: key, expectedRevision: revision, idempotencyKey: key, input: foodDescriptionInputSchema }).strict(),
  z.object({ action: z.literal("cancel"), expectedOwnerId: owner, draftId: key }).strict(),
]);
export const foodDescriptionArchiveSchema = z.object({ ownerId: owner, available: z.boolean(), drafts: z.array(z.object({
  id: key, revision, state: z.enum(["empty", "queued", "running", "result", "failed", "unknown", "cancelled", "expired"]), noticeVersion: z.literal(FOOD_DESCRIPTION_NOTICE_VERSION),
  consentedAt: z.iso.datetime({ offset: true }), createdAt: z.iso.datetime({ offset: true }), contentExpiresAt: z.iso.datetime({ offset: true }), metadataExpiresAt: z.iso.datetime({ offset: true }),
  input: foodDescriptionInputSchema.nullable(), projection: foodDescriptionProjectionSchema.nullable(), selection: foodDescriptionSelectionSchema.nullable(), queueKey: key.nullable(),
  usage: z.array(z.object({ revision: revision.positive(), chargedAt: z.iso.datetime({ offset: true }), usage: z.object({ complete: z.boolean(),
    inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), cachedInputTokens: z.number().int().nonnegative().optional(), reasoningTokens: z.number().int().nonnegative().optional(),
    responseId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(), requestId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
  }).strict().nullable() }).strict()).max(3),
}).strict()).max(12) }).strict();
export type FoodDescriptionArchive = z.infer<typeof foodDescriptionArchiveSchema>;
export class FoodDescriptionError extends Error {
  constructor(readonly status: number, readonly code: "unavailable" | "changed" | "invalid" | "resource_limit" | "service") { super(code); }
}
