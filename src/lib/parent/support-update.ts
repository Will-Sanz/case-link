import { z } from "zod";
import { factAnswerSchema, factAnswerBundleSchema } from "./answers";
import { mandateSchema } from "./domain";

export const supportUpdateSchema = z.discriminatedUnion("action", [
  factAnswerSchema.safeExtend({ action: z.literal("answer_fact") }),
  factAnswerBundleSchema.safeExtend({ action: z.literal("answer_facts") }),
  z.object({ action: z.literal("replace_mandate"), mandate: mandateSchema, version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("booking_preference"), preference: mandateSchema.shape.bookingPreference, version: z.number().int().positive() }).strict(),
]);
export type SupportUpdate = z.infer<typeof supportUpdateSchema>;
export const supportUpdateReceiptSchema = z.object({
  id: z.uuid(), key: z.uuid(), requestId: z.uuid(),
  action: z.enum(["answer_fact", "answer_facts", "replace_mandate", "booking_preference"]),
  baseVersion: z.number().int().positive(), resultVersion: z.number().int().positive(),
  recordedAt: z.iso.datetime({ offset: true }),
}).strict().refine(value => value.resultVersion > value.baseVersion);
export type SupportUpdateReceipt = z.infer<typeof supportUpdateReceiptSchema>;
