import { z } from "zod";

/** Zod defines both provider shape and runtime validation; optional output uses explicit nulls. */
export function toStructuredJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema) as Record<string, unknown>;
  delete generated.$schema;
  if (generated.type !== "object" || generated.anyOf) throw new Error("Structured output requires an object root.");
  function check(node: Record<string, unknown>): void {
    for (const key of ["allOf", "not", "dependentRequired", "dependentSchemas", "if", "then", "else", "patternProperties"]) {
      if (key in node) throw new Error(`Unsupported structured-output schema keyword: ${key}`);
    }
    if (node.type === "object") {
      const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
      const required = node.required as string[] | undefined;
      if (node.additionalProperties !== false || Object.keys(properties ?? {}).some(key => !required?.includes(key))) {
        throw new Error("Structured output objects must reject extra fields and require every property; use null for optional values.");
      }
      Object.values(properties ?? {}).forEach(check);
    }
    if (node.items && typeof node.items === "object") check(node.items as Record<string, unknown>);
    if (Array.isArray(node.anyOf)) node.anyOf.forEach(check);
    if (node.$defs && typeof node.$defs === "object") Object.values(node.$defs).forEach(check);
  }
  check(generated);
  return generated;
}
