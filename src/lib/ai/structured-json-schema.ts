import { z } from "zod";

/** Build the strict JSON Schema sent to OpenAI while keeping Zod as the source of truth. */
export function toStructuredJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}
