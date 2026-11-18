import { z } from "zod";
import type { SupportRequest } from "./domain";
import type { FoodSiteResult } from "./food-sites-core";
import { getProgram, programRoutingIssue } from "./programs";
import { currentIntakeFields } from "./current-intake-fields";
import { foodAccessReportSchema, hasPublicFoodAccessSubpath, SHARE_FOOD_ACCESS_PROGRAM, SHARE_FOOD_ACCESS_SOURCE, type FoodAccessReport } from "./food-access";

export const foodSiteDayLabels = { mon: "Monday", tues: "Tuesday", wed: "Wednesday", thurs: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;
const days = ["mon", "tues", "wed", "thurs", "fri", "sat", "sun"] as const;
const compatibleCategory = (category: string | null) => ["food site", "community fridge"].includes(category?.toLowerCase().replace(/\s+/g, " ").trim() ?? "");
const siteSchema = z.object({
  id: z.number().int().positive(), name: z.string().min(1).max(200), address: z.string().min(1).max(300), zip: z.string().regex(/^191\d{2}$/),
  category: z.string().max(500).nullable(), phoneNumber: z.string().regex(/^[+\d(). -]{7,30}$/).nullable(),
  website: z.string().max(4500).url().refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }).nullable(),
  hours: z.array(z.object({ day: z.enum(days), windows: z.array(z.string().min(1).max(1001)).max(2), notes: z.string().max(500).nullable() }).strict()).max(7)
    .refine(hours => new Set(hours.map(value => value.day)).size === hours.length),
  serviceAreaNotes: z.string().max(500).nullable(),
}).strict().refine(site => site.id !== SHARE_FOOD_ACCESS_SOURCE.cityRecordId && compatibleCategory(site.category));

/** Public directory observations only; the selected access plan and immutable report keep their original bytes. */
export const foodAccessAlternativesSchema = z.object({
  version: z.literal(1), kind: z.literal("public_food_directory_observation"), requestId: z.uuid(), requestVersion: z.number().int().positive(),
  sourceReport: foodAccessReportSchema, queriedZip: z.string().regex(/^191\d{2}$/), sourceUrl: z.literal(SHARE_FOOD_ACCESS_SOURCE.cityUrl),
  availability: z.literal("city_listed_unconfirmed"),
  checkedAt: z.iso.datetime({ offset: true }), state: z.enum(["listed", "empty", "unavailable"]),
  sites: z.array(siteSchema).max(3), moreSitesAvailable: z.boolean(),
}).strict().refine(value => value.sourceReport.requestId === value.requestId && value.sourceReport.outcome === "unresolved"
  && value.sites.every(site => site.zip === value.queriedZip) && new Set(value.sites.map(site => site.id)).size === value.sites.length
  && (value.state === "listed" ? value.sites.length > 0 : value.sites.length === 0));
export type FoodAccessAlternatives = z.infer<typeof foodAccessAlternativesSchema>;

export function sameFoodAccessReport(left: unknown, right: unknown): boolean {
  const a = foodAccessReportSchema.safeParse(left), b = foodAccessReportSchema.safeParse(right);
  return a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data);
}

function sourceMatches(value: unknown, request: SupportRequest, report: unknown, now: Date) {
  const parsed = foodAccessAlternativesSchema.safeParse(value), zip = currentIntakeFields(request, now, "food_now").zip;
  return parsed.success && request.status === "active" && Date.parse(request.mandate.expiresAt) > now.getTime() && hasPublicFoodAccessSubpath(request)
    && programRoutingIssue(getProgram(SHARE_FOOD_ACCESS_PROGRAM)!, zip, now) === null
    && parsed.data.requestId === request.id && parsed.data.requestVersion <= request.version && parsed.data.queriedZip === zip
    && sameFoodAccessReport(parsed.data.sourceReport, report) ? parsed.data : null;
}

export function currentFoodAccessAlternatives(value: unknown, request: SupportRequest, report: unknown, now = new Date()): FoodAccessAlternatives | null {
  const observation = sourceMatches(value, request, report, now);
  return observation?.requestVersion === request.version ? observation : null;
}

export function reusableFoodAccessAlternatives(value: unknown, request: SupportRequest, report: unknown, now: Date): FoodAccessAlternatives | null {
  const observation = sourceMatches(value, request, report, now);
  // An independent benefit correction can change the wrapper version; it does not renew the directory check.
  return observation && observation.state !== "unavailable" ? { ...observation, requestVersion: request.version } : null;
}

export function buildFoodAccessAlternatives(input: { request: SupportRequest; report: FoodAccessReport; zip: string; result: FoodSiteResult | null; now: Date }): FoodAccessAlternatives {
  const excluded = new Set(input.result?.sourceObservations?.map(value => value.id) ?? []);
  const sites = (input.result?.sites ?? []).filter(site => site.id !== SHARE_FOOD_ACCESS_SOURCE.cityRecordId && site.zip === input.zip && !excluded.has(site.id)
    && compatibleCategory(site.category) && siteSchema.safeParse(site).success);
  return foodAccessAlternativesSchema.parse({
    version: 1, kind: "public_food_directory_observation", requestId: input.request.id, requestVersion: input.request.version,
    sourceReport: input.report, queriedZip: input.zip, sourceUrl: SHARE_FOOD_ACCESS_SOURCE.cityUrl,
    availability: "city_listed_unconfirmed",
    checkedAt: input.result?.checkedAt ?? input.now.toISOString(), state: !input.result ? "unavailable" : sites.length ? "listed" : "empty",
    sites: sites.slice(0, 3), moreSitesAvailable: input.result?.moreSitesAvailable === true || sites.length > 3,
  });
}
