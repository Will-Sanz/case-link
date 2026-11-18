import { z } from "zod";
import type { SupportRequest } from "./domain";

export const SHARE_FOOD_ACCESS_PROGRAM = "share-community-fridge-19129";
export const SHARE_FOOD_ACCESS_SOURCE = {
  version: "share-hunting-park-fridge-2026-11-17",
  reviewedOn: "2026-11-17",
  operatorUrl: "https://www.sharefoodprogram.org/community-fridges/",
  locationUrl: "https://www.sharefoodprogram.org/features/community-fridges-in-philadelphia/",
  cityUrl: "https://www.phila.gov/food/",
  cityRecordId: 122,
} as const;
export const SHARE_FOOD_ACCESS_SITE = {
  id: "share-hunting-park-fridge",
  name: "Share Food Program Community Fridge & Pantry",
  address: "2901 W Hunting Park Ave, Philadelphia, PA 19129",
  zip: "19129",
  location: "Between Lots A and B, across from Mercy Tech High School.",
  service: "community_fridge",
  access: "walk_up",
  publishedHours: "24-hour access, according to Share's reviewed public guidance.",
  paperwork: "No paperwork, according to Share's reviewed public guidance.",
  stock: "unknown",
  reservation: "none",
  delivery: "not_verified",
  languageService: "not_verified",
  physicalAccessibility: "not_verified",
} as const;

const version = z.number().int().positive().max(2147483647);
const uuid = z.uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const sourceSchema = z.object({
  version: z.literal(SHARE_FOOD_ACCESS_SOURCE.version),
  reviewedOn: z.literal(SHARE_FOOD_ACCESS_SOURCE.reviewedOn),
  operatorUrl: z.literal(SHARE_FOOD_ACCESS_SOURCE.operatorUrl),
  locationUrl: z.literal(SHARE_FOOD_ACCESS_SOURCE.locationUrl),
  cityUrl: z.literal(SHARE_FOOD_ACCESS_SOURCE.cityUrl),
  cityRecordId: z.literal(SHARE_FOOD_ACCESS_SOURCE.cityRecordId),
}).strict();
const siteSchema = z.object({
  id: z.literal(SHARE_FOOD_ACCESS_SITE.id),
  name: z.literal(SHARE_FOOD_ACCESS_SITE.name),
  address: z.literal(SHARE_FOOD_ACCESS_SITE.address),
  zip: z.literal(SHARE_FOOD_ACCESS_SITE.zip),
  location: z.literal(SHARE_FOOD_ACCESS_SITE.location),
  service: z.literal(SHARE_FOOD_ACCESS_SITE.service),
  access: z.literal(SHARE_FOOD_ACCESS_SITE.access),
  publishedHours: z.literal(SHARE_FOOD_ACCESS_SITE.publishedHours),
  paperwork: z.literal(SHARE_FOOD_ACCESS_SITE.paperwork),
  stock: z.literal("unknown"),
  reservation: z.literal("none"),
  delivery: z.literal("not_verified"),
  languageService: z.literal("not_verified"),
  physicalAccessibility: z.literal("not_verified"),
}).strict();
const cityObservationSchema = z.object({
  recordId: z.literal(122),
  checkedAt: timestamp,
  state: z.enum(["listed_unconfirmed", "not_returned", "unavailable", "closed", "delivery_only", "conflicting_hours", "identity_conflict"]),
}).strict();
export type FoodAccessCityObservation = z.infer<typeof cityObservationSchema>;

function blockedReason(reviewCurrent: boolean, city: FoodAccessCityObservation | null) {
  if (!reviewCurrent) return "source_review_required" as const;
  if (city && ["closed", "delivery_only", "conflicting_hours", "identity_conflict"].includes(city.state)) return "source_conflict" as const;
  return null;
}
const planShape = z.object({
  version: z.literal(1),
  kind: z.literal("public_food_access_plan"),
  need: z.literal("food_now"),
  programId: z.literal(SHARE_FOOD_ACCESS_PROGRAM),
  requestId: uuid,
  requestVersion: version,
  generatedAt: timestamp,
  source: sourceSchema,
  sourceReviewCurrent: z.boolean(),
  site: siteSchema,
  cityObservation: cityObservationSchema.nullable(),
  state: z.enum(["prepared", "unresolved"]),
  blockedReason: z.enum(["source_review_required", "source_conflict"]).nullable(),
}).strict();
function validPlan(plan: z.infer<typeof planShape>) {
  const reason = blockedReason(plan.sourceReviewCurrent, plan.cityObservation);
  const generatedAt = Date.parse(plan.generatedAt);
  return Number.isFinite(generatedAt) && plan.blockedReason === reason && plan.state === (reason ? "unresolved" : "prepared")
    && (!plan.cityObservation || Date.parse(plan.cityObservation.checkedAt) <= generatedAt)
    && new Date(generatedAt).toISOString().slice(0, 10) >= plan.source.reviewedOn;
}
export const foodAccessPlanBodySchema = planShape.refine(validPlan, "parent_invalid_food_access_plan");
export const foodAccessPlanSchema = planShape.extend({ planHash: hash }).refine(validPlan, "parent_invalid_food_access_plan");
export type FoodAccessPlan = z.infer<typeof foodAccessPlanSchema>;

export function hasTypedFoodAccessPath(request: Pick<SupportRequest,"id"|"intake"|"mandate"|"plan">, currentZip: string | undefined): boolean {
  if (!request.intake.needs.includes("food_now") || !request.mandate.recipientIds.includes(SHARE_FOOD_ACCESS_PROGRAM)) return false;
  const route=request.plan?.routes.find(route=>route.need==="food_now");
  return route ? route.programId===SHARE_FOOD_ACCESS_PROGRAM
    : !request.mandate.recipientIds.includes("philly-food") || currentZip==="19129";
}

export function isPublicFoodAccessRequest(request: {
  intake: { needs: readonly string[] };
  mandate: { recipientIds: readonly string[]; allowedActions: readonly string[]; allowedData: readonly string[] };
}): boolean {
  return request.intake.needs.length === 1 && request.intake.needs[0] === "food_now"
    && request.mandate.recipientIds.includes(SHARE_FOOD_ACCESS_PROGRAM)
    && request.mandate.allowedActions.includes("prepare") && request.mandate.allowedData.includes("household");
}

/** The server applies the existing program review rule and hashes this validated body; no new freshness policy is introduced here. */
export function buildFoodAccessPlanBody(input: {
  requestId: string; requestVersion: number; generatedAt: string; sourceReviewCurrent: boolean;
  cityObservation?: FoodAccessCityObservation | null;
}) {
  const city = input.cityObservation ?? null, reason = blockedReason(input.sourceReviewCurrent, city);
  return foodAccessPlanBodySchema.parse({
    version: 1, kind: "public_food_access_plan", need: "food_now", programId: SHARE_FOOD_ACCESS_PROGRAM,
    requestId: input.requestId, requestVersion: input.requestVersion, generatedAt: input.generatedAt,
    source: SHARE_FOOD_ACCESS_SOURCE, sourceReviewCurrent: input.sourceReviewCurrent,
    site: SHARE_FOOD_ACCESS_SITE, cityObservation: city,
    state: reason ? "unresolved" : "prepared", blockedReason: reason,
  });
}

export const foodAccessReportInputSchema = z.object({
  expectedVersion: version,
  siteId: z.literal(SHARE_FOOD_ACCESS_SITE.id),
  planHash: hash,
  reportKey: uuid,
  result: z.enum(["received_enough_food", "some_food_still_needed", "no_food", "could_not_access", "need_another_way"]),
}).strict();
const outcomeFor = (result: z.infer<typeof foodAccessReportInputSchema>["result"]) =>
  result === "received_enough_food" ? "support_received" as const : "unresolved" as const;
export const foodAccessReportSchema = foodAccessReportInputSchema.extend({
  eventId: uuid,
  requestId: uuid,
  need: z.literal("food_now"),
  programId: z.literal(SHARE_FOOD_ACCESS_PROGRAM),
  sourceVersion: z.literal(SHARE_FOOD_ACCESS_SOURCE.version),
  reportedAt: timestamp,
  attribution: z.literal("parent_reported"),
  outcome: z.enum(["support_received", "unresolved"]),
}).strict().refine(report => report.outcome === outcomeFor(report.result), "parent_invalid_food_access_report");
export type FoodAccessReport = z.infer<typeof foodAccessReportSchema>;

/** Pure binding only: ownership, exact replay and the atomic job wake still require the database transaction. */
export function bindFoodAccessReport(planInput: unknown, reportInput: unknown, metadata: { eventId: string; reportedAt: string }): FoodAccessReport {
  const plan = foodAccessPlanSchema.parse(planInput), report = foodAccessReportInputSchema.parse(reportInput);
  if (report.expectedVersion !== plan.requestVersion || report.planHash !== plan.planHash || Date.parse(metadata.reportedAt) < Date.parse(plan.generatedAt))
    throw new Error("parent_food_access_plan_changed");
  return foodAccessReportSchema.parse({ ...report, ...metadata, requestId: plan.requestId, need: "food_now", programId: plan.programId,
    sourceVersion: plan.source.version, attribution: "parent_reported", outcome: outcomeFor(report.result) });
}
