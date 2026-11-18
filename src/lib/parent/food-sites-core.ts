import { z } from "zod";
import { readBoundedBody } from "./http";
import { SHARE_FOOD_ACCESS_SOURCE, type FoodAccessCityObservation } from "./food-access";

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
const normalizeShareText = (value: string) => value.toLowerCase().replace(/&/g, " and ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
function matchesKnownShareSite(site: z.infer<typeof sourceSite>): boolean {
  const name = normalizeShareText(site.site_name), category = normalizeShareText(site.category_type ?? "");
  return site.zip_code === "19129"
    && (name === "share community fridge" || name === "share food program community fridge and pantry")
    && /^2901 (?:w|west) hunting park (?:ave|avenue)(?: philadelphia(?: pa)?(?: 19129)?)?$/.test(normalizeShareText(site.address))
    && (category === "food site" || category === "community fridge");
}
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
  sourceObservations?: { id: number; state: "closed" | "delivery_only" | "identity_conflict" | "conflicting_hours" }[];
};

/** Public ZIP-level discovery only: no account, family information or application is sent. */
async function readFoodSites(zip: string, fetcher: typeof fetch, selectedRecordId?: number): Promise<FoodSiteResult> {
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
    where: selectedRecordId === undefined ? `zip_code='${zip}' AND status='Active'` : `objectid=${selectedRecordId}`,
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
    resultRecordCount: selectedRecordId === undefined ? "50" : "1",
    returnGeometry: "false",
    f: "json",
  }).toString();
  const response = await fetcher(url, {
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
  const sourceObservations: NonNullable<FoodSiteResult["sourceObservations"]> = [];
  for (const { attributes } of data.features) {
    const parsed = sourceSite.safeParse(attributes);
    if (!parsed.success) {
      if (selectedRecordId === SHARE_FOOD_ACCESS_SOURCE.cityRecordId && (attributes.objectid === selectedRecordId || attributes.objectid === String(selectedRecordId)))
        sourceObservations.push({ id: selectedRecordId, state: "identity_conflict" });
      continue;
    }
    const site = parsed.data;
    if (site.zip_code !== zip) {
      if (selectedRecordId === SHARE_FOOD_ACCESS_SOURCE.cityRecordId && site.objectid === selectedRecordId)
        sourceObservations.push({ id: site.objectid, state: "identity_conflict" });
      continue;
    }
    if (
      site.status !== "Active" ||
      (site.temporary_closure &&
        site.temporary_closure.toLowerCase() !== "no") ||
      (site.seasonally_closed && site.seasonally_closed.toLowerCase() !== "no")
    ) {
      sourceObservations.push({ id: site.objectid, state: "closed" });
      continue;
    }
    const deliveryOnly = /delivery[\s-]*only/i.test(site.category_type ?? "");
    if (deliveryOnly)
      sourceObservations.push({ id: site.objectid, state: "delivery_only" });
    if (!deliveryOnly && selectedRecordId === SHARE_FOOD_ACCESS_SOURCE.cityRecordId && site.objectid === selectedRecordId && !matchesKnownShareSite(site)) {
      sourceObservations.push({ id: site.objectid, state: "identity_conflict" });
      continue;
    }
    if (selectedRecordId === SHARE_FOOD_ACCESS_SOURCE.cityRecordId && site.objectid === selectedRecordId && days.some(day => {
      if (["start1","end1","start2","end2"].some(field => {
        const value=attributes[`hours_${day}_${field}`];
        return value != null && (typeof value !== "string" || value.trim() !== "");
      })) return true;
      const note=optionalText.safeParse(attributes[`hours_${day}_exceptions`]);
      return !note.success || (!!note.data && !/^(?:open\s+)?(?:24\s+hours|24\s*\/\s*7)[.!]?$/i.test(note.data));
    })) sourceObservations.push({ id:site.objectid,state:"conflicting_hours" });
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
    sourceObservations,
  };
}

export async function findFoodSites(zip: string, fetcher: typeof fetch = fetch): Promise<FoodSiteResult> {
  return readFoodSites(zip, fetcher);
}

/** Classify only the selected source record; callers cannot supply a public site's status. */
export async function findShareFoodAccessObservation(fetcher: typeof fetch = fetch): Promise<FoodAccessCityObservation> {
  try {
    const id = SHARE_FOOD_ACCESS_SOURCE.cityRecordId, result = await readFoodSites("19129", fetcher, id);
    const excluded = result.sourceObservations?.find(item => item.id === id);
    const site = result.sites.find(item => item.id === id);
    return { recordId: id, checkedAt: result.checkedAt, state: excluded?.state
      ?? (site ? "listed_unconfirmed" : "not_returned") };
  } catch {
    return { recordId: SHARE_FOOD_ACCESS_SOURCE.cityRecordId, checkedAt: new Date().toISOString(), state: "unavailable" };
  }
}
