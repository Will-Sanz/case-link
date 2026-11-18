import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bindFoodAccessReport, buildFoodAccessPlanBody, foodAccessPlanBodySchema, foodAccessPlanSchema,
  foodAccessReportInputSchema, foodAccessReportSchema, SHARE_FOOD_ACCESS_PROGRAM, SHARE_FOOD_ACCESS_SITE,
  hasPublicFoodAccessSubpath, isPublicFoodAccessRequest,
} from "./food-access";

const requestId = "abcdefab-cdef-4abc-8def-abcdefabcdef", reportKey = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222", at = "2026-11-18T12:00:00Z";
const scope = () => ({ requestId, requestVersion: 2, generatedAt: at, sourceReviewCurrent: true });
function plan() {
  const body = buildFoodAccessPlanBody(scope());
  return foodAccessPlanSchema.parse({ ...body, planHash: createHash("sha256").update(JSON.stringify(body)).digest("hex") });
}
const report = () => ({ expectedVersion: 2, siteId: SHARE_FOOD_ACCESS_SITE.id, planHash: plan().planHash,
  reportKey, result: "received_enough_food" as const });
const metadata = () => ({ eventId, reportedAt: "2026-11-18T12:05:00Z" });

describe("bounded public food subpath dispatch",()=>{
  const mandate={ recipientIds:[SHARE_FOOD_ACCESS_PROGRAM,"snap-pa"],allowedActions:["research","prepare"],allowedData:["household"] };
  it.each(["snap_new","snap_renewal","snap_pending","snap_problem"])("accepts one %s companion without treating the whole request as public-only",need=>{
    const request={ intake:{ needs:["food_now",need] },mandate };
    expect(hasPublicFoodAccessSubpath(request)).toBe(true);expect(isPublicFoodAccessRequest(request)).toBe(false);
    expect(isPublicFoodAccessRequest({ ...request,intake:{ needs:["food_now"] } })).toBe(true);
  });
  it.each([["snap_new"],["food_now","wic_new"],["food_now","electricity"],["food_now","snap_new","snap_pending"],["food_now","food_now"]].map(needs=>({ needs })))("does not expand the selected scope to $needs",({ needs })=>{
    expect(hasPublicFoodAccessSubpath({ intake:{ needs },mandate })).toBe(false);
  });
  it.each([{ recipientIds:["philly-food"] },{ allowedActions:["research"] },{ allowedData:["income"] }])("keeps the original named preparation/data gates %#",change=>{
    expect(hasPublicFoodAccessSubpath({ intake:{ needs:["food_now","snap_new"] },mandate:{ ...mandate,...change } })).toBe(false);
  });
});

describe("source-bound Share public food access contract", () => {
  it("prepares only dated public walk-up instructions, distinct from the City check, stock or a reservation", () => {
    const value = buildFoodAccessPlanBody({ ...scope(), cityObservation: { recordId: 122, state: "listed_unconfirmed", checkedAt: at } });
    expect(value).toMatchObject({ programId: SHARE_FOOD_ACCESS_PROGRAM, need: "food_now", state: "prepared", blockedReason: null,
      source: { reviewedOn: "2026-11-17", cityRecordId: 122, operatorUrl: "https://www.sharefoodprogram.org/community-fridges/",
        locationUrl: "https://www.sharefoodprogram.org/features/community-fridges-in-philadelphia/", cityUrl: "https://www.phila.gov/food/" },
      site: { address: "2901 W Hunting Park Ave, Philadelphia, PA 19129", access: "walk_up", stock: "unknown", reservation: "none",
        delivery: "not_verified", languageService: "not_verified", physicalAccessibility: "not_verified" },
      cityObservation: { recordId: 122, checkedAt: at, state: "listed_unconfirmed" } });
    expect(value.site.publishedHours).toContain("according to Share's reviewed public guidance");
    expect(value.site.paperwork).toContain("No paperwork");
    expect(value).not.toHaveProperty("packet"); expect(value).not.toHaveProperty("receipt");
    expect(value).not.toHaveProperty("householdSize"); expect(value).not.toHaveProperty("income");
  });
  it.each([null, "not_returned", "unavailable"] as const)("does not infer a closure or empty stock from a %s City lookup", state => {
    const value = buildFoodAccessPlanBody({ ...scope(), cityObservation: state ? { recordId: 122, checkedAt: at, state } : null });
    expect(value.state).toBe("prepared"); expect(value.site.stock).toBe("unknown");
    expect(value.source.reviewedOn).toBe("2026-11-17");
  });
  it.each(["closed", "delivery_only", "conflicting_hours", "identity_conflict"] as const)("excludes a walk-up recommendation when the current record reports %s", state => {
    const value = buildFoodAccessPlanBody({ ...scope(), cityObservation: { recordId: 122, checkedAt: at, state } });
    expect(value).toMatchObject({ state: "unresolved", blockedReason: "source_conflict" });
    expect(foodAccessPlanBodySchema.safeParse({ ...value, state: "prepared", blockedReason: null }).success).toBe(false);
  });
  it("uses the existing review decision without inventing a new elapsed-time rule or refreshing the source date", () => {
    const value = buildFoodAccessPlanBody({ ...scope(), sourceReviewCurrent: false });
    expect(value).toMatchObject({ state: "unresolved", blockedReason: "source_review_required", source: { reviewedOn: "2026-11-17" } });
    expect(buildFoodAccessPlanBody({ ...scope(), generatedAt: "2027-01-01T12:00:00Z" }).source.reviewedOn).toBe("2026-11-17");
  });
  it.each([
    ["2026-11-17T00:30:00+14:00", false],
    ["2026-11-16T23:30:00-02:00", true],
  ])("checks the actual UTC source-review day for %s", (generatedAt, valid) => {
    expect(foodAccessPlanBodySchema.safeParse({ ...buildFoodAccessPlanBody(scope()), generatedAt }).success).toBe(valid);
  });
  it.each([
    { programId: "philly-food" }, { need: "snap_new" }, { source: { ...plan().source, reviewedOn: "2026-11-18" } },
    { source: { ...plan().source, operatorUrl: "https://untrusted.example/" } },
    { site: { ...plan().site, stock: "available" } }, { site: { ...plan().site, reservation: "confirmed" } },
    { site: { ...plan().site, id: "east-falls-fridge" } }, { privateAnswer: "PRIVATE-CANARY" },
    { cityObservation: { recordId: 123, checkedAt: at, state: "listed_unconfirmed" } },
    { cityObservation: { recordId: 122, checkedAt: "2026-11-18T13:00:00Z", state: "listed_unconfirmed" } },
    { planHash: "ABC" }, { requestVersion: 0 }, { generatedAt: "2026-11-16T12:00:00Z" }, { generatedAt: "invalid" },
  ])("rejects changed sources, private fields or unsupported plan claims %#", change => {
    expect(foodAccessPlanSchema.safeParse({ ...plan(), ...change }).success).toBe(false);
  });
  it("returns independent validated copies without allowing a caller to rewrite the source contract", () => {
    const first = buildFoodAccessPlanBody(scope()); first.site.address = "Changed" as typeof first.site.address;
    expect(buildFoodAccessPlanBody(scope()).site.address).toBe("2901 W Hunting Park Ave, Philadelphia, PA 19129");
  });
});

describe("site-bound family food reports", () => {
  it("binds received-enough food to this request, site, source and exact plan with honest attribution", () => {
    const value = bindFoodAccessReport(plan(), report(), metadata());
    expect(value).toMatchObject({ requestId, expectedVersion: 2, siteId: SHARE_FOOD_ACCESS_SITE.id, reportKey, eventId,
      sourceVersion: "share-hunting-park-fridge-2026-11-17", reportedAt: metadata().reportedAt,
      need: "food_now", attribution: "parent_reported", outcome: "support_received" });
    expect(bindFoodAccessReport(plan(), report(), metadata())).toEqual(value);
    expect(value).not.toHaveProperty("providerConfirmed"); expect(value).not.toHaveProperty("agencyStatus");
  });
  it.each(["some_food_still_needed", "no_food", "could_not_access", "need_another_way"] as const)("retains the unmet need after %s without inventing a second service contract", result => {
    const value = bindFoodAccessReport(plan(), { ...report(), result }, metadata());
    expect(value.outcome).toBe("unresolved"); expect(value.attribution).toBe("parent_reported");
    expect(value).not.toHaveProperty("alternativeSite");
    expect(foodAccessReportSchema.safeParse({ ...value, outcome: "support_received" }).success).toBe(false);
  });
  it.each([
    { expectedVersion: 1 }, { planHash: "f".repeat(64) }, { siteId: "city-123" }, { reportKey: "invalid" },
    { need: "snap_new" }, { attribution: "provider_api" }, { sourceVersion: "current" },
    { providerConfirmed: true }, { reference: "PRIVATE-CANARY" }, { result: "reserved" },
  ])("rejects another plan/site or a forged report claim %#", change => {
    expect(() => bindFoodAccessReport(plan(), { ...report(), ...change }, metadata())).toThrow();
  });
  it("rejects reports predating the prepared instructions and normalizes UUID retry keys", () => {
    expect(() => bindFoodAccessReport(plan(), report(), { ...metadata(), reportedAt: "2026-11-18T11:00:00Z" })).toThrow("parent_food_access_plan_changed");
    expect(foodAccessReportInputSchema.parse({ ...report(), reportKey: requestId.toUpperCase() }).reportKey).toBe(requestId);
  });
});
