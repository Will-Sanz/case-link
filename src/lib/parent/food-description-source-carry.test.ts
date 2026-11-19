import { describe, expect, it } from "vitest";
import { buildFoodDescriptionProjection, carryFoodDescriptionFacts, validateFoodDescriptionSelection, type FoodDescriptionContext } from "./food-description";
const now = new Date("2026-11-18T12:00:00Z"), owner = "00000000-0000-4000-8000-000000000001";
const context = (facts: FoodDescriptionContext["facts"] = {}): FoodDescriptionContext => ({ ownerId: owner, expectedOwnerId: owner, revision: 1, expectedRevision: 1,
  catalogVersion: "synthetic", capabilityVersion: "synthetic", facts, history: [], programIds: ["philly-food", "snap-pa"], capabilities: [], excludedNeedIds: [] });
const source = { description: "🙂 There is enough food for two days. This would be my first SNAP application.", screenLocale: "en" as const };
const quote = (text: string) => ({ start: source.description.indexOf(text), end: source.description.indexOf(text) + text.length, text });
const selection = { needIds: ["snap_new"], selections: [], assertions: [
  { questionId: "foodForTwoDays", value: "yes", span: quote("enough food for two days") },
  { questionId: "benefitHistory", value: "never", span: quote("my first SNAP application") },
], exclusions: [], questionIds: [], outOfScope: null };
const sourceAttemptCreatedAt = "2026-11-18T11:00:00Z", contentExpiresAt = "2026-11-19T10:00:00Z";
function carry(facts = context().facts, original = context().facts) { return carryFoodDescriptionFacts({ projection: buildFoodDescriptionProjection(source, context(original), now), selection, facts, sourceAttemptCreatedAt, contentExpiresAt, now }); }
describe("same-description source-backed ordinary fact carry", () => {
  it("retains source attempt provenance, fixed original expiry and earlier clear food through an edited description", () => {
    const facts = carry();
    expect(facts.foodForTwoDays).toEqual({ value: "yes", source: "parent_description", sourceRevision: 1, sourceAttemptCreatedAt, expiresAt: new Date(contentExpiresAt).toISOString() });
    expect(JSON.stringify(facts)).not.toMatch(/confirmedAt|🙂|SNAP application|ownerId|draftId/);
    const input = { description: "I checked: I already submitted a SNAP application and am waiting.", screenLocale: "en" };
    const current = context(facts), projection = buildFoodDescriptionProjection(input, current, now), text = "already submitted a SNAP application";
    const result = validateFoodDescriptionSelection({ projection, currentContext: current, now, selection: { ...selection, needIds: ["snap_pending"], assertions: [{ questionId: "benefitHistory", value: "applied", span: { start: input.description.indexOf(text), end: input.description.indexOf(text) + text.length, text } }] } });
    expect(result).toMatchObject({ proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "applied" }, needIds: ["snap_pending"], questionIds: [], conflicts: [], executionGranted: false });
  });
  it("lets an explicit current Not sure correct earlier description evidence without a typed-fact conflict", () => {
    const facts = carry(), input = { description: "I am not sure whether there is enough food.", screenLocale: "en" }, current = context(facts);
    const result = validateFoodDescriptionSelection({ projection: buildFoodDescriptionProjection(input, current, now), currentContext: current, now,
      selection: { ...selection, needIds: ["food_now", "snap_new"], assertions: [{ questionId: "foodForTwoDays", value: "not_sure", span: { start: 0, end: input.description.length, text: input.description } }] } });
    expect(result.proposedAnswers.foodForTwoDays).toBe("not_sure"); expect(result.conflicts).toEqual([]);
  });
  it("never revives an originally shadowed assertion, even after the original definite typed source expires", () => {
    const typed = { foodForTwoDays: { value: "no" as const, source: "parent_typed" as const, confirmedAt: "2026-11-18T10:00:00Z", expiresAt: "2026-11-18T13:00:00Z" } };
    expect(carry({}, typed).foodForTwoDays).toBeUndefined();
    expect(carry(typed).foodForTwoDays).toEqual(typed.foodForTwoDays);
  });
  it("does not refresh unchanged evidence or reuse expired, future, forged or oversized source periods", () => {
    const facts = carry(); expect(carry(facts)).toEqual(facts);
    const projection = buildFoodDescriptionProjection(source, context(), now);
    for (const overrides of [{ sourceAttemptCreatedAt: "2026-11-18T13:00:00Z" }, { contentExpiresAt: now.toISOString() }, { selection: { ...selection, assertions: [{ ...selection.assertions[0], span: { start: 1, end: 3, text: "🙂" } }] } }]) {
      const run = () => carryFoodDescriptionFacts({ projection, selection, facts: {}, sourceAttemptCreatedAt, contentExpiresAt, now, ...overrides });
      if ("selection" in overrides) expect(run).toThrow(); else expect(run()).toEqual({});
    }
    const overlong = context({ foodForTwoDays: { ...facts.foodForTwoDays!, expiresAt: "2026-11-20T11:00:00Z" } });
    expect(buildFoodDescriptionProjection(source, overlong, now).routingFacts).toEqual({});
  });
  it("conservatively omits overlapping repeated source quotes rather than inventing an origin", () => {
    const input = { description: "aaaa", screenLocale: "en" };
    expect(carryFoodDescriptionFacts({ projection: buildFoodDescriptionProjection(input, context(), now), selection: { ...selection, assertions: [{ questionId: "foodForTwoDays", value: "no", span: { start: 0, end: 3, text: "aaa" } }] }, facts: {}, sourceAttemptCreatedAt, contentExpiresAt, now })).toEqual({});
  });

  it("preserves the existing permitted family-profile freshness period instead of imposing the new description TTL on it", () => {
    const fact = { value: "yes" as const, source: "family_profile" as const, confirmedAt: "2026-11-18T10:00:00Z", expiresAt: "2026-11-20T10:00:00Z", descriptionUsePermitted: true };
    expect(buildFoodDescriptionProjection(source, context({ foodForTwoDays: fact }), now).routingFacts.foodForTwoDays).toEqual(fact);
  });

});
