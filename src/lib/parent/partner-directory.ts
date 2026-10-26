import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";

export const parentPartnerSchema = z
  .object({
    legacyResourceId: z.uuid(),
    name: z.string().min(1).max(100),
    officialUrl: z.enum([
      "https://uesfacts.org/check-your-eligibility/",
      "https://www.peco.com/my-account/customer-support/assistance-programs",
      "https://cap.phila.gov/",
    ]),
    programIds: z
      .array(z.enum(["uesf-benefits", "uesf-utilities", "peco-cap", "pwd-tap"]))
      .min(1)
      .max(2),
    directoryUpdatedAt: z.iso.datetime({ offset: true }),
    sourceCheckedAt: z.iso.date(),
    relationship: z.literal("existing_partner"),
    execution: z.literal("not_connected"),
  })
  .strict();
export type ParentPartner = z.infer<typeof parentPartnerSchema>;

export async function getParentPartnerDirectory(): Promise<ParentPartner[]> {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_partner_directory");
  if (error) throw new Error("Partner information is not available right now.");
  return z.array(parentPartnerSchema).max(4).parse(data);
}
