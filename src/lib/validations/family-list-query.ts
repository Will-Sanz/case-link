import { z } from "zod";

export const familyListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  status: z.enum(["active", "on_hold", "closed"]).optional(),
  urgency: z.enum(["low", "medium", "high", "crisis"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
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
    urgency: first("urgency"),
    page: first("page"),
    pageSize: first("pageSize"),
  });

  if (parsed.success) return parsed.data;

  return familyListQuerySchema.parse({
    q: "",
    page: 1,
    pageSize: 20,
  });
}
