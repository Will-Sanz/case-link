import { z } from "zod";

const optionalFlag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) =>
    v === "true" ? true : v === "false" ? false : undefined,
  );

export const resourceListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  category: z.string().max(200).optional(),
  tabling: optionalFlag,
  promotional: optionalFlag,
  educational: optionalFlag,
  volunteer: optionalFlag,
  grocery: optionalFlag,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

export function parseResourceListQuery(
  raw: Record<string, string | string[] | undefined>,
): ResourceListQuery {
  const first = (k: string) => {
    const v = raw[k];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const candidate = {
    q: first("q"),
    category: first("category"),
    tabling: first("tabling"),
    promotional: first("promotional"),
    educational: first("educational"),
    volunteer: first("volunteer"),
    grocery: first("grocery"),
    page: first("page"),
    pageSize: first("pageSize"),
  };

  const parsed = resourceListQuerySchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  return resourceListQuerySchema.parse({
    q: "",
    page: 1,
    pageSize: 25,
  });
}
