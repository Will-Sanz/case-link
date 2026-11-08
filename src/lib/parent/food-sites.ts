import "server-only";
import { z } from "zod";
import { readBoundedBody } from "./http";

export const FOOD_SOURCE_URL = "https://www.phila.gov/food/";
const endpoint =
  "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/free_meal_sites/FeatureServer/0/query";
const days = ["mon", "tues", "wed", "thurs", "fri", "sat", "sun"] as const;
const optionalText = z.string().trim().max(500).nullish();
const sourceSite = z.object({
  objectid: z.number().int().positive(),
  site_name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  zip_code: z.string().regex(/^191\d{2}$/),
  status: z.string().max(50),
  temporary_closure: optionalText,
  seasonally_closed: optionalText,
  category_type: optionalText,
  website: optionalText,
  phone_number: optionalText,
  zip_code_exceptions: optionalText,
});
export type FoodSite = {
  id: number;
  name: string;
  address: string;
  zip: string;
  category: string | null;
  phoneNumber: string | null;
  website: string | null;
  hours: {
    day: (typeof days)[number];
    windows: string[];
    notes: string | null;
  }[];
  serviceAreaNotes: string | null;
};
export type FoodSiteResult = {
  sites: FoodSite[];
  sourceUrl: string;
  checkedAt: string;
  availability: "city_listed_unconfirmed";
  moreSitesAvailable: boolean;
};

/** Public ZIP-level discovery only: no account, family information or application is sent. */
export async function findFoodSites(zip: string): Promise<FoodSiteResult> {
  z.string()
    .regex(/^191\d{2}$/)
    .parse(zip);
  const hoursFields = days.flatMap((day) =>
    ["start1", "end1", "start2", "end2", "exceptions"].map(
      (field) => `hours_${day}_${field}`,
    ),
  );
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    where: `zip_code='${zip}' AND status='Active'`,
    outFields: [
      "objectid",
      "site_name",
      "address",
      "zip_code",
      "status",
      "temporary_closure",
      "seasonally_closed",
      "category_type",
      "website",
      "phone_number",
      "zip_code_exceptions",
      ...hoursFields,
    ].join(","),
    orderByFields: "site_name,objectid",
    resultRecordCount: "50",
    returnGeometry: "false",
    f: "json",
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error("food_directory_unavailable");
  const data = z
    .object({
      features: z
        .array(z.object({ attributes: z.record(z.string(), z.unknown()) }))
        .max(50),
      exceededTransferLimit: z.boolean().optional(),
    })
    .parse(
      JSON.parse(
        new TextDecoder().decode(await readBoundedBody(response, 512000)),
      ),
    );
  const sites: FoodSite[] = [];
  for (const { attributes } of data.features) {
    const parsed = sourceSite.safeParse(attributes);
    if (!parsed.success) continue;
    const site = parsed.data;
    if (
      site.zip_code !== zip ||
      site.status !== "Active" ||
      (site.temporary_closure &&
        site.temporary_closure.toLowerCase() !== "no") ||
      (site.seasonally_closed && site.seasonally_closed.toLowerCase() !== "no")
    )
      continue;
    const hours = days.flatMap((day) => {
      const windows: string[] = [];
      for (const index of [1, 2]) {
        const start = optionalText.safeParse(
          attributes[`hours_${day}_start${index}`],
        );
        const end = optionalText.safeParse(
          attributes[`hours_${day}_end${index}`],
        );
        if (start.success && end.success && start.data && end.data)
          windows.push(`${start.data}–${end.data}`);
      }
      const notes = optionalText.safeParse(
        attributes[`hours_${day}_exceptions`],
      );
      if (!windows.length && (!notes.success || !notes.data)) return [];
      return [
        { day, windows, notes: notes.success ? notes.data || null : null },
      ];
    });
    let website: string | null = null;
    if (site.website) {
      try {
        const link = new URL(site.website);
        if (link.protocol === "https:" && !link.username && !link.password)
          website = link.href;
      } catch {
        // Malformed source links are omitted; the City finder remains available.
      }
    }
    sites.push({
      id: site.objectid,
      name: site.site_name,
      address: site.address,
      zip: site.zip_code,
      category: site.category_type || null,
      phoneNumber:
        site.phone_number && /^[+\d(). -]{7,30}$/.test(site.phone_number)
          ? site.phone_number
          : null,
      website,
      hours,
      serviceAreaNotes: site.zip_code_exceptions || null,
    });
  }
  return {
    sites,
    sourceUrl: FOOD_SOURCE_URL,
    checkedAt: new Date().toISOString(),
    availability: "city_listed_unconfirmed",
    moreSitesAvailable: data.exceededTransferLimit === true,
  };
}
