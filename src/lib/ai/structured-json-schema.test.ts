import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toStructuredJsonSchema } from "@/lib/ai/structured-json-schema";

describe("toStructuredJsonSchema", () => {
  it("creates a strict object schema without the unused dialect marker", () => {
    const schema = toStructuredJsonSchema(
      z.object({
        label: z.string().min(1).max(200),
        status: z.enum(["ready", "review"]),
      }),
    );

    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["label", "status"],
      properties: {
        label: { type: "string", minLength: 1, maxLength: 200 },
        status: { type: "string", enum: ["ready", "review"] },
      },
    });
  });
});
