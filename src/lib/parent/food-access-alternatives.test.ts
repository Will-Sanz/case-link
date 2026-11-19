import { describe, expect, it } from "vitest";
import { buildFoodAccessAlternatives, currentFoodAccessAlternatives, foodAccessAlternativesSchema, reusableFoodAccessAlternatives } from "./food-access-alternatives";
import { bindFoodAccessReport, buildFoodAccessPlanBody, SHARE_FOOD_ACCESS_PROGRAM, type FoodAccessReport } from "./food-access";
import type { FoodSite, FoodSiteResult } from "./food-sites-core";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "./test-fixtures";

const at = "2026-11-18T12:00:00Z", now = new Date(at);
function fixture() {
  const request = fixtureRequest({ created_at: at, intake_confirmed_at: { zip: at },
    intake: fixtureIntake({ needs: ["food_now"], zip: "19129" }), mandate: fixtureMandate({ recipientIds: [SHARE_FOOD_ACCESS_PROGRAM],
      mode: "prepare_only", allowedActions: ["research", "prepare"], allowedData: ["household"], expiresAt: "2026-12-15T12:00:00Z" }) });
  const body = buildFoodAccessPlanBody({ requestId: request.id, requestVersion: request.version, generatedAt: at, sourceReviewCurrent: true });
  const plan = { ...body, planHash: "a".repeat(64) };
  const report = bindFoodAccessReport(plan, { expectedVersion: request.version, siteId: plan.site.id, planHash: plan.planHash, reportKey: request.id, result: "no_food" },
    { eventId: request.id, reportedAt: at });
  return { request, report };
}
const site = (id = 148, extra: Partial<FoodSite> = {}): FoodSite => ({ id, name: "Original source name ñ", address: "Original City address", zip: "19129", category: "Food Site",
  phoneNumber: "+1 (215) 555-0101", website: "https://example.invalid/public-food", hours: [{ day: "mon", windows: ["9am–2pm"], notes: "Original source restriction" }], serviceAreaNotes: "Original source area notes", ...extra });
const directory = (sites = [site()], extra: Partial<FoodSiteResult> = {}): FoodSiteResult => ({ sites, sourceUrl: "https://www.phila.gov/food/", checkedAt: at, availability: "city_listed_unconfirmed", moreSitesAvailable: false, ...extra });
function build(result: FoodSiteResult | null = directory()) { return buildFoodAccessAlternatives({ ...fixture(), zip: "19129", result, now }); }

describe("current report-bound public directory observations", () => {
  it("preserves original public fields, timestamps and the entire immutable report", () => {
    const result = directory(), { request, report } = fixture(), before = structuredClone({ result, report });
    const observation = buildFoodAccessAlternatives({ request, report, zip: "19129", result, now });
    expect(observation).toMatchObject({ sourceReport: report, checkedAt: at, sourceUrl: "https://www.phila.gov/food/", availability: "city_listed_unconfirmed", state: "listed", sites: result.sites });
    expect({ result, report }).toEqual(before); expect(observation).not.toHaveProperty("reservation");
  });
  it("excludes the failed, closed, seasonal, delivery-only, identity-conflicting, mismatched and restricted-service entries", () => {
    const observation = build(directory([site(122), site(1), site(2), site(3, { category: "Delivery Only" }), site(4), site(5, { zip: "19104" }), site(6, { category: "School Meal Site" }), site()],
      { sourceObservations: [{ id: 1, state: "closed" }, { id: 2, state: "closed" }, { id: 3, state: "delivery_only" }, { id: 4, state: "identity_conflict" }] }));
    expect(observation.sites.map(value => value.id)).toEqual([148]);
  });
  it("keeps the existing first-three presentation bound and reports additional City results", () => {
    const observation = build(directory([1, 2, 3, 4].map(id => site(id))));
    expect(observation.sites.map(value => value.id)).toEqual([1, 2, 3]); expect(observation.moreSitesAvailable).toBe(true);
  });
  it.each([null, directory([])])("distinguishes unavailable from a successful empty check: %s", result => {
    const observation = build(result); expect(observation.state).toBe(result ? "empty" : "unavailable"); expect(observation.sites).toEqual([]);
  });
  it.each(["javascript:alert(1)", "http://example.invalid", "https://user:password@example.invalid"])("omits unsafe source links: %s", website => {
    expect(build(directory([site(1, { website })])).sites).toEqual([]);
  });
  it.each(["requestId", "eventId", "reportKey", "planHash", "result", "reportedAt"])("requires the exact owned source report %s", field => {
    const observation = build(), { request, report } = fixture();
    const changed = { ...report, [field]: field === "planHash" ? "b".repeat(64) : field === "reportedAt" ? "2026-11-18T12:00:01Z" : field === "result" ? "some_food_still_needed" : "11111111-1111-4111-8111-111111111111" };
    expect(currentFoodAccessAlternatives(observation, request, changed, now)).toBeNull();
  });
  it.each(["closed", "cancelled", "paused"] as const)("hides current suggestions when the request is %s", status => {
    const { request, report } = fixture(); expect(currentFoodAccessAlternatives(build(), { ...request, status }, report, now)).toBeNull();
  });
  it("hides a positive correction, stale version, expired ZIP, removed permission and expired source review", () => {
    const { request, report } = fixture(), observation = build();
    expect(currentFoodAccessAlternatives(observation, request, { ...report, result: "received_enough_food", outcome: "support_received" }, now)).toBeNull();
    expect(currentFoodAccessAlternatives(observation, { ...request, version: 2 }, report, now)).toBeNull();
    expect(currentFoodAccessAlternatives(observation, { ...request, intake_confirmed_at: { zip: "2026-09-01T00:00:00Z" } }, report, now)).toBeNull();
    expect(currentFoodAccessAlternatives(observation, { ...request, mandate: { ...request.mandate, allowedData: [] } }, report, now)).toBeNull();
    const later = new Date("2026-12-18T12:00:00Z");
    expect(currentFoodAccessAlternatives(observation, { ...request, intake_confirmed_at: { zip: later.toISOString() }, mandate: { ...request.mandate, expiresAt: "2027-01-01T00:00:00Z" } }, report, later)).toBeNull();
  });
  it("reuses an independent SNAP wrapper-version change without renewing the directory check", () => {
    const { request, report } = fixture(), observation = build();
    expect(reusableFoodAccessAlternatives(observation, { ...request, version: 2 }, report, now)).toEqual({ ...observation, requestVersion: 2 });
    expect(reusableFoodAccessAlternatives(build(null), request, report, now)).toBeNull();
  });
  it("keeps another-way constraints in the exact report without inventing verified delivery", () => {
    const { request, report } = fixture(), constrained: FoodAccessReport = { ...report, result: "need_another_way" };
    const observation = buildFoodAccessAlternatives({ request, report: constrained, zip: "19129", result: directory(), now });
    expect(observation.sourceReport.result).toBe("need_another_way"); expect(JSON.stringify(observation)).not.toContain("delivery_verified");
  });
  it.each([{ sites: [site(122)] }, { sourceUrl: "https://example.invalid" }, { unexpected: "external instruction" }, { state: "listed", sites: [] }, { sites: [site(), site()] }])("rejects malformed stored observations: %s", change => {
    expect(foodAccessAlternativesSchema.safeParse({ ...build(), ...change }).success).toBe(false);
  });
});
