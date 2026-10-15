import { z } from "zod";
import { toStructuredJsonSchema } from "@/lib/ai/structured-json-schema";

export const assistantResponseSchema = z.strictObject({
  answer: z.string().trim().min(1).max(12_000),
  resource_ids: z.array(z.string().uuid()).max(10),
});
export const ASSISTANT_RESPONSE_JSON_SCHEMA = toStructuredJsonSchema(assistantResponseSchema);
