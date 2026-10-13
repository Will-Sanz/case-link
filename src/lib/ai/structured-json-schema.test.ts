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
  it("requires explicit nullable output and rejects optional or open object contracts", () => {
    expect(() => toStructuredJsonSchema(z.strictObject({ optional: z.string().optional() }))).toThrow(/require every property/);
    expect(() => toStructuredJsonSchema(z.looseObject({ name: z.string() }))).toThrow(/reject extra fields/);
    expect(() => toStructuredJsonSchema(z.array(z.string()))).toThrow(/object root/);
    expect(() => toStructuredJsonSchema(z.strictObject({ value: z.string().nullable() }))).not.toThrow();
    expect(() => toStructuredJsonSchema(z.strictObject({ nested: z.array(z.strictObject({ optional: z.string().optional() })) }))).toThrow(/require every property/);
  });
  it("rejects unsupported composition instead of silently weakening it", () => {
    expect(() => toStructuredJsonSchema(z.strictObject({
      value: z.intersection(z.strictObject({ one: z.string() }), z.strictObject({ two: z.string() })),
    }))).toThrow(/Unsupported.*allOf/);
  });

});
