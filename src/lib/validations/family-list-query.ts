import { z } from "zod";

const emptyToUndef = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

export const familyListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  status: z.preprocess(
    emptyToUndef,
    z.enum(["active", "on_hold", "closed"]).optional(),
  ),
  /** When "active", show active+on_hold; when "legacy", show closed only */
  tab: z.preprocess(emptyToUndef, z.enum(["active", "legacy"]).optional()),
  statusIn: z.array(z.enum(["active", "on_hold", "closed"])).optional(),
  urgency: z.preprocess(
    emptyToUndef,
    z.enum(["low", "medium", "high", "crisis"]).optional(),
  ),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
});

export type FamilyListQuery = z.infer<typeof familyListQuerySchema>;

export function parseFamilyListQuery(
  raw: Record<string, string | string[] | undefined>,
): FamilyListQuery {
  const first = (k: string) => {
    const v = raw[k];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const parsed = familyListQuerySchema.safeParse({
    q: first("q"),
    status: first("status"),
    tab: first("tab"),
    urgency: first("urgency"),
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
    pageSize: 20,
  };
}
