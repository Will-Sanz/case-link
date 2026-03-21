import { z } from "zod";

/** Checkbox GET params: only "true" enables the filter; anything else is ignored. */
const optionalFlag = z.preprocess((val: unknown) => {
  if (val === undefined || val === null || val === "") return undefined;
  if (val === "true") return true;
  return undefined;
}, z.boolean().optional());

const emptyCategoryToUndef = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
};

export const resourceListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  category: z.preprocess(
    emptyCategoryToUndef,
    z.string().max(200).optional(),
  ),
  tabling: optionalFlag,
  promotional: optionalFlag,
  educational: optionalFlag,
  volunteer: optionalFlag,
  grocery: optionalFlag,
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25),
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

  const parsed = resourceListQuerySchema.safeParse({
    q: first("q"),
    category: first("category"),
    tabling: first("tabling"),
    promotional: first("promotional"),
    educational: first("educational"),
    volunteer: first("volunteer"),
    grocery: first("grocery"),
    page: first("page"),
    pageSize: first("pageSize"),
  });

  if (parsed.success) {
    return parsed.data;
  }

  const qRaw = first("q");
  return {
    q: typeof qRaw === "string" ? qRaw.slice(0, 200) : "",
    page: 1,
    pageSize: 25,
  };
}
